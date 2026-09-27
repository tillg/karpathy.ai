import './buffer-shim.js';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';
import { VFSFileSystem } from '@componentor/fs';
import { OpfsFs } from './opfs-fs.js';

const GIT = 'http://localhost:8788'; // local CORS-enabled smart-HTTP server
const PROXY = 'http://localhost:9999'; // @isomorphic-git/cors-proxy
const author = { name: 'Browser Spike', email: 'spike@example.invalid' };
const now = () => performance.now();
const ms = (t) => Math.round(now() - t);
const mb = (b) => +(b / 1e6).toFixed(2);
const err = (e) => ({ name: e?.name, code: e?.code, message: String(e?.message ?? e).slice(0, 400), data: e?.data, stack: e?.stack?.split('\n').slice(1, 5).join(' | ') });

async function estimate() {
  const { usage, quota } = await navigator.storage.estimate();
  return { usageMB: mb(usage), quotaMB: mb(quota) };
}

// Wipe OPFS + IndexedDB so each spike starts from zero.
async function clearAll() {
  const root = await navigator.storage.getDirectory();
  for await (const name of root.keys()) await root.removeEntry(name, { recursive: true });
  for (const db of (await indexedDB.databases?.()) ?? []) {
    await new Promise((r) => { const q = indexedDB.deleteDatabase(db.name); q.onsuccess = q.onerror = q.onblocked = r; });
  }
}

async function makeFs(kind, name) {
  if (kind === 'idb') return new LightningFS(name, { wipe: true });
  if (kind === 'opfs-shim') return new OpfsFs(name);
  const fs = new VFSFileSystem({ root: '/' + name, mode: kind === 'componentor-opfs' ? 'opfs' : 'hybrid' });
  await fs.init();
  return fs;
}

// ---------- S1: OPFS as vault store ----------
async function dirFor(root, path, cache, create) {
  let dir = root, key = '';
  for (const p of path.split('/').slice(0, -1)) {
    key += '/' + p;
    dir = cache.get(key) ?? (await dir.getDirectoryHandle(p, { create }));
    cache.set(key, dir);
  }
  return dir;
}

async function walk(dir) {
  let files = 0, dirs = 0;
  for await (const [, h] of dir.entries()) {
    if (h.kind === 'file') files++;
    else { dirs++; const r = await walk(h); files += r.files; dirs += r.dirs; }
  }
  return { files, dirs };
}

async function s1() {
  await clearAll();
  const files = await (await fetch('/vault.json')).json();
  const out = { files: files.length, sizeMB: mb(files.reduce((s, f) => s + new Blob([f.content]).size, 0)), before: await estimate() };
  const root = await navigator.storage.getDirectory();

  // (a) main thread, async API (createWritable)
  try {
    const base = await root.getDirectoryHandle('main', { create: true });
    let cache = new Map(), t = now();
    for (const f of files) {
      const dir = await dirFor(base, f.path, cache, true);
      const w = await (await dir.getFileHandle(f.path.split('/').pop(), { create: true })).createWritable();
      await w.write(f.content);
      await w.close();
    }
    out.mainWriteMs = ms(t);
  } catch (e) { out.mainWriteError = err(e); }
  try {
    const base = await root.getDirectoryHandle('main');
    let cache = new Map(), t = now(), chars = 0;
    for (const f of files) {
      const dir = await dirFor(base, f.path, cache, false);
      chars += (await (await (await dir.getFileHandle(f.path.split('/').pop())).getFile()).text()).length;
    }
    out.mainReadMs = ms(t);
    out.mainReadOk = chars === files.reduce((s, f) => s + f.content.length, 0);
    t = now();
    out.tree = await walk(base);
    out.listTreeMs = ms(t);
  } catch (e) { out.mainReadError = err(e); }

  // (b) dedicated worker, createSyncAccessHandle
  const worker = new Worker(new URL('./opfs-worker.js', import.meta.url), { type: 'module' });
  const r = await new Promise((res) => { worker.onmessage = (m) => res(m.data); worker.postMessage({ files, base: 'worker' }); });
  worker.terminate();
  Object.assign(out, { workerWriteMs: r.writeMs && Math.round(r.writeMs), workerReadMs: r.readMs && Math.round(r.readMs), workerError: r.error });

  // (c) comparison: lightning-fs (IndexedDB)
  const lfs = new LightningFS('s1', { wipe: true }).promises;
  let t = now();
  const made = new Set();
  for (const f of files) {
    const parts = f.path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const d = '/' + parts.slice(0, i).join('/');
      if (!made.has(d)) { made.add(d); await lfs.mkdir(d).catch(() => {}); }
    }
    await lfs.writeFile('/' + f.path, f.content, 'utf8');
  }
  out.idbWriteMs = ms(t);
  t = now();
  for (const f of files) await lfs.readFile('/' + f.path, 'utf8');
  out.idbReadMs = ms(t);

  out.after = await estimate();
  out.persistedBefore = await navigator.storage.persisted();
  out.persistResult = await navigator.storage.persist();
  return out;
}

// ---------- S2: isomorphic-git clone ----------
async function s2GithubDirect(url) {
  const out = {};
  try { await fetch(`${url}/info/refs?service=git-upload-pack`); out.fetch = 'ok (unexpected)'; }
  catch (e) { out.fetchError = err(e); }
  try {
    await git.clone({ fs: await makeFs('idb', 'gh-direct'), http, dir: '/r', url, depth: 1, singleBranch: true });
    out.clone = 'ok (unexpected)';
  } catch (e) { out.cloneError = err(e); }
  return out;
}

async function du(fs, path) {
  const st = await fs.promises.lstat(path);
  if (!st.isDirectory()) return st.size;
  let sum = 0;
  for (const name of await fs.promises.readdir(path)) sum += await du(fs, `${path}/${name}`);
  return sum;
}

async function cloneAndStatus({ url, fsKind, depth, corsProxy, token, verbose }) {
  await clearAll();
  const fs = await makeFs(fsKind, 'clone');
  const dir = '/repo', cache = {};
  const onAuth = token ? () => ({ username: 'x-access-token', password: token }) : undefined;
  let received = 0;
  let lastPhase = '';
  const onProgress = (p) => {
    if (p.phase === 'Receiving objects') received = p.loaded;
    if (verbose && (p.phase !== lastPhase || p.loaded % 500 === 0)) console.log(`${Math.round(now())} ${p.phase} ${p.loaded}/${p.total ?? '?'}`);
    lastPhase = p.phase;
  };
  const out = { url: url.replace(/\/\/[^@]*@/, '//'), fsKind, depth: depth ?? 'full' };
  let t = now();
  try {
    await git.clone({ fs, http, dir, url, depth, singleBranch: true, corsProxy, onAuth, cache, onProgress });
  } catch (e) { return { ...out, cloneMs: ms(t), cloneError: err(e) }; }
  out.cloneMs = ms(t);
  if (verbose) console.log("clone done", out.cloneMs);
  out.objectsReceived = received;
  const matrix = await (async () => { t = now(); const m = await git.statusMatrix({ fs, dir, cache }); out.status1Ms = ms(t); return m; })();
  out.files = matrix.length;
  t = now(); await git.statusMatrix({ fs, dir }); out.status2Ms = ms(t); // fresh cache, index stats warm
  const first = matrix.find(([f]) => f.endsWith('.md'))[0];
  await fs.promises.writeFile(`${dir}/${first}`, (await fs.promises.readFile(`${dir}/${first}`, 'utf8')) + '\nedit\n', 'utf8');
  t = now();
  const changed = (await git.statusMatrix({ fs, dir })).filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1));
  out.statusAfterEditMs = ms(t);
  out.changedDetected = changed.map(([f]) => f);
  t = now(); await git.log({ fs, dir, depth: 50 }); out.logMs = ms(t);
  t = now(); out.duMB = mb(await du(fs, dir)); out.duMs = ms(t);
  out.estimateAfter = await estimate();
  return out;
}

// ---------- S3: edit + commit + push + pull/merge ----------
const s3 = { fs: null, dir: '/repo', url: `${GIT}/push.git` };
async function s3Clone() {
  await clearAll();
  s3.fs = await makeFs('idb', 's3');
  const t = now();
  await git.clone({ fs: s3.fs, http, dir: s3.dir, url: s3.url, singleBranch: true });
  return { cloneMs: ms(t) };
}
async function editCommit(file, text, message) {
  const { fs, dir } = s3;
  const path = `${dir}/${file}`;
  const old = await fs.promises.readFile(path, 'utf8').catch(() => '');
  await fs.promises.writeFile(path, text(old), 'utf8');
  await git.add({ fs, dir, filepath: file });
  return git.commit({ fs, dir, message, author });
}
async function s3EditPush(file) {
  let t = now();
  const oid = await editCommit(file, (o) => o + '\nEdited in the browser.\n', 'browser: edit ' + file);
  const commitMs = ms(t);
  t = now();
  const res = await git.push({ fs: s3.fs, http, dir: s3.dir, url: s3.url, ref: 'main' });
  return { oid, commitMs, pushMs: ms(t), pushOk: res.ok, pushRefs: res.refs };
}
async function s3Pull({ file, line, expectConflict }) {
  const { fs, dir } = s3;
  const local = await editCommit(file, (o) => (line ? o.replace(/^.*$/m, line) : o + '\nLocal browser change.\n'), 'browser: local change ' + file);
  const out = { localCommit: local };
  let t = now();
  try {
    await git.pull({ fs, http, dir, url: s3.url, ref: 'main', singleBranch: true, author, fastForward: true });
    out.pullMs = ms(t);
    const [head] = await git.log({ fs, dir, depth: 1 });
    out.headParents = head.commit.parent.length;
    t = now();
    const res = await git.push({ fs, http, dir, url: s3.url, ref: 'main' });
    out.pushMs = ms(t); out.pushOk = res.ok; out.head = head.oid;
  } catch (e) {
    out.pullError = err(e);
    if (expectConflict) {
      // Retry the merge step leaving conflict markers in the worktree.
      try {
        await git.merge({ fs, dir, ours: 'main', theirs: 'origin/main', author, abortOnConflict: false });
        out.mergeNoAbort = 'no error (unexpected)';
      } catch (e2) { out.mergeNoAbortError = err(e2); }
      const text = await fs.promises.readFile(`${dir}/${file}`, 'utf8');
      out.markersInWorktree = /^<<<<<<< /m.test(text) && /^>>>>>>> /m.test(text);
      out.fileHead = text.split('\n').slice(0, 7).join('\n');
      out.statusOfFile = await git.status({ fs, dir, filepath: file });
    }
  }
  return out;
}

// ---------- S4: GitHub REST API ----------
async function gh(path, token, init = {}) {
  const t = now();
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${body.message}`), { name: 'GitHubError' });
  return { body, ms: ms(t), rateRemaining: res.headers.get('x-ratelimit-remaining') };
}
async function s4Read(repo, token) {
  const out = { repo, authenticated: !!token };
  try {
    const r = await gh(`/repos/${repo}`, token);
    const ref = await gh(`/repos/${repo}/git/ref/heads/${r.body.default_branch}`, token);
    const tree = await gh(`/repos/${repo}/git/trees/${ref.body.object.sha}?recursive=1`, token);
    const blobs = tree.body.tree.filter((e) => e.type === 'blob');
    const blob = await gh(`/repos/${repo}/git/blobs/${blobs[0].sha}`, token);
    Object.assign(out, { cors: 'ok', treeEntries: tree.body.tree.length, truncated: tree.body.truncated, treeMs: tree.ms, blobMs: blob.ms, blobBytes: blob.body.size, rateRemaining: blob.rateRemaining });
  } catch (e) { out.error = err(e); }
  return out;
}
async function s4Write(repo, token) {
  const t0 = now();
  const branch = (await gh(`/repos/${repo}`, token)).body.default_branch;
  const head = (await gh(`/repos/${repo}/git/ref/heads/${branch}`, token)).body.object.sha;
  const baseTree = (await gh(`/repos/${repo}/git/commits/${head}`, token)).body.tree.sha;
  const stamp = new Date().toISOString();
  const path = `spike-browser-only/${stamp.replace(/[:.]/g, '-')}.md`;
  const blob = (await gh(`/repos/${repo}/git/blobs`, token, { method: 'POST', body: JSON.stringify({ content: `# Browser-only spike\n\nWritten from ${navigator.userAgent} at ${stamp}\n`, encoding: 'utf-8' }) })).body.sha;
  const tree = (await gh(`/repos/${repo}/git/trees`, token, { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree: [{ path, mode: '100644', type: 'blob', sha: blob }] }) })).body.sha;
  const commit = (await gh(`/repos/${repo}/git/commits`, token, { method: 'POST', body: JSON.stringify({ message: `spike: browser-only REST commit ${stamp}`, tree, parents: [head] }) })).body.sha;
  await gh(`/repos/${repo}/git/refs/heads/${branch}`, token, { method: 'PATCH', body: JSON.stringify({ sha: commit }) });
  return { path, commit, totalMs: ms(t0), calls: 7 };
}

// ---------- S5: feature detection ----------
function s5() {
  return {
    showDirectoryPicker: typeof window.showDirectoryPicker === 'function',
    showOpenFilePicker: typeof window.showOpenFilePicker === 'function',
    opfsGetDirectory: typeof navigator.storage?.getDirectory === 'function',
    createWritable: typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype,
    createSyncAccessHandle: typeof FileSystemFileHandle !== 'undefined' && 'createSyncAccessHandle' in FileSystemFileHandle.prototype,
    FileSystemObserver: typeof window.FileSystemObserver === 'function',
    webkitdirectoryInput: 'webkitdirectory' in document.createElement('input'),
    crossOriginIsolated: window.crossOriginIsolated,
    userAgent: navigator.userAgent,
  };
}

async function probeFs(kind) {
  const log = [];
  let t = now();
  const fs = await makeFs(kind, 'probe'); log.push(['init', ms(t)]);
  t = now(); await fs.promises.mkdir('/probe/a', { recursive: true }).catch((e) => log.push(['mkdirErr', String(e)])); log.push(['mkdir', ms(t)]);
  t = now(); await fs.promises.writeFile('/probe/a/x.md', 'hello', 'utf8'); log.push(['write', ms(t)]);
  t = now(); log.push(['read', await fs.promises.readFile('/probe/a/x.md', 'utf8'), ms(t)]);
  t = now(); for (let i = 0; i < 200; i++) await fs.promises.writeFile(`/probe/a/f${i}.md`, 'x'.repeat(1800), 'utf8'); log.push(['write200', ms(t)]);
  return log;
}

async function opfsTiny() {
  try {
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle('tiny.txt', { create: true })).createWritable();
    await w.write('x'); await w.close();
    return { opfs: 'ok', estimate: await estimate() };
  } catch (e) { return { opfsError: err(e) }; }
}

window.spikes = { opfsTiny,  probeFs,  clearAll, estimate, s1, s2GithubDirect, cloneAndStatus, s3Clone, s3EditPush, s3Pull, s4Read, s4Write, s5 };
window.spikesReady = true;
