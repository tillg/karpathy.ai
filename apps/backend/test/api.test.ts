import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { VaultEvent } from '@karpathy/shared';
import { makeApp, TOKEN } from './app-helpers.js';
import { makeRemote, sh } from './helpers.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function vaultApp(files: Record<string, string> = { 'Home.md': '# Home\nSee [[Other]]\n', 'Other.md': 'other\n', 'notes/n1.md': 'alpha beta\n' }) {
  const remote = await makeRemote(files);
  const t = await makeApp(remote.remoteBase);
  cleanups.push(() => t.vaults.close());
  const id = await t.addVault(remote.repo);
  return { ...t, remote, id };
}

describe('auth', () => {
  it('401 without or with a wrong token, 200 with the right one', async () => {
    const { app } = await makeApp('file:///nowhere/');
    expect((await request(app).get('/api/vaults')).status).toBe(401);
    expect((await request(app).get('/api/vaults').set('Authorization', 'Bearer nope')).status).toBe(401);
    expect((await request(app).get('/api/vaults').set('Authorization', `Bearer ${TOKEN}`)).status).toBe(200);
    expect((await request(app).get('/api/nope')).status).toBe(401);
  });

  it('health reports backend + opencode', async () => {
    const { api } = await makeApp('file:///nowhere/', { opencodeHealthy: async () => true });
    expect((await api.get('/health')).body).toEqual({ backend: 'ok', opencode: 'ok' });
  });
});

describe('vault admin', () => {
  it('add → cloning → ready; appears in list; bad repo → clone-failed with the git error', async () => {
    const remote = await makeRemote({ 'a.md': 'a' });
    const t = await makeApp(remote.remoteBase);
    cleanups.push(() => t.vaults.close());
    const r = await t.api.post('/vaults', { name: 'My Vault', repo: remote.repo });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ id: 'my-vault', state: 'cloning', branch: 'main', root: '' });
    await t.vaults.whenCloned('my-vault');
    expect((await t.api.get('/vaults')).body).toEqual([expect.objectContaining({ id: 'my-vault', state: 'ready' })]);

    const bad = await t.api.post('/vaults', { name: 'bad', repo: 'o/does-not-exist' });
    await t.vaults.whenCloned(bad.body.id);
    const got = (await t.api.get(`/vaults/${bad.body.id}`)).body;
    expect(got.state).toBe('clone-failed');
    expect(got.error).toMatch(/does not exist|not found|Could not read/i);
    expect((await t.api.post('/vaults', { repo: 'not a repo' })).status).toBe(400);
  });

  it('subfolder root: files are scoped to it; missing root folder → clone-failed', async () => {
    const remote = await makeRemote({ 'wiki/a.md': 'inside needle', 'top.md': 'outside needle' });
    const t = await makeApp(remote.remoteBase);
    cleanups.push(() => t.vaults.close());
    const id = await t.addVault(remote.repo, { root: 'wiki' });
    expect((await t.api.get(`/vaults/${id}/files`)).body).toEqual([{ path: 'a.md', type: 'file' }]);
    expect((await t.api.get(`/vaults/${id}/search?q=needle`)).body).toEqual([{ path: 'a.md', line: 1, text: 'inside needle' }]);
    expect((await t.api.get(`/vaults/${id}/file?path=../top.md`)).status).toBe(400);
    const bad = await t.addVault(remote.repo, { name: 'x', root: 'nope' });
    expect((await t.api.get(`/vaults/${bad}`)).body.state).toBe('clone-failed');
  });

  it('PATCH: name always; repo/branch/root only on a clean tree', async () => {
    const t = await vaultApp();
    sh(t.remote.obsidian, 'checkout', '-q', '-b', 'other');
    await writeFile(join(t.remote.obsidian, 'branch-only.md'), 'b');
    sh(t.remote.obsidian, 'add', '-A');
    sh(t.remote.obsidian, 'commit', '-q', '-m', 'b');
    sh(t.remote.obsidian, 'push', '-q', '-u', 'origin', 'other');

    await t.api.put(`/vaults/${t.id}/file?path=Other.md`, { content: 'dirty', version: (await t.api.get(`/vaults/${t.id}/file?path=Other.md`)).body.version });
    expect((await t.api.patch(`/vaults/${t.id}`, { name: 'Renamed' })).body.name).toBe('Renamed');
    expect((await t.api.patch(`/vaults/${t.id}`, { branch: 'other' })).status).toBe(409);
    await t.api.post(`/vaults/${t.id}/discard?path=Other.md`);
    expect((await t.api.patch(`/vaults/${t.id}`, { root: 'missing' })).status).toBe(400);
    const r = await t.api.patch(`/vaults/${t.id}`, { branch: 'other' });
    expect(r.status).toBe(200);
    expect((await t.api.get(`/vaults/${t.id}/files`)).body.map((f: { path: string }) => f.path)).toContain('branch-only.md');
    expect((await t.api.patch(`/vaults/${t.id}`, { root: 'notes' })).status).toBe(200);
    expect((await t.api.get(`/vaults/${t.id}/files`)).body).toEqual([{ path: 'n1.md', type: 'file' }]);
  });

  it('PATCH branch + missing root together → 400 and nothing changed', async () => {
    const t = await vaultApp();
    sh(t.remote.obsidian, 'checkout', '-q', '-b', 'other');
    sh(t.remote.obsidian, 'push', '-q', '-u', 'origin', 'other');
    expect((await t.api.patch(`/vaults/${t.id}`, { branch: 'other', root: 'nope' })).status).toBe(400);
    expect((await t.api.get(`/vaults/${t.id}`)).body).toMatchObject({ branch: 'main', root: '' });
    expect(sh(t.vaults.vaultRootDir(t.id), 'branch', '--show-current').trim()).toBe('main');
  });

  it('PATCH repo re-clones', async () => {
    const t = await vaultApp();
    const other = await makeRemote({ 'x.md': 'x' }, { name: 'second' });
    // Same remote base dir layout differs per makeRemote; point the vault at the other bare repo via a symlink.
    await symlink(other.bare, join(t.remote.bare, '..', 'second.git'));
    const r = await t.api.patch(`/vaults/${t.id}`, { repo: 'o/second' });
    expect(r.body.state).toBe('cloning');
    await t.vaults.whenCloned(t.id);
    expect((await t.api.get(`/vaults/${t.id}/files`)).body).toEqual([{ path: 'x.md', type: 'file' }]);
  });

  it('DELETE is blocked while uncommitted changes exist, never touches the remote', async () => {
    const t = await vaultApp();
    const f = (await t.api.get(`/vaults/${t.id}/file?path=Home.md`)).body;
    await t.api.put(`/vaults/${t.id}/file?path=Home.md`, { content: 'x', version: f.version });
    expect((await t.api.delete(`/vaults/${t.id}`)).status).toBe(409);
    await t.api.post(`/vaults/${t.id}/discard?path=Home.md`);
    expect((await t.api.delete(`/vaults/${t.id}`)).status).toBe(204);
    expect((await t.api.get('/vaults')).body).toEqual([]);
    expect(t.remote.remoteFile('Home.md')).toContain('# Home');
  });
});

describe('files', () => {
  it('lists, reads with a version, PUT with stale version → 409, new file with null version', async () => {
    const t = await vaultApp();
    const files = (await t.api.get(`/vaults/${t.id}/files`)).body;
    expect(files).toEqual([
      { path: 'Home.md', type: 'file' },
      { path: 'notes', type: 'dir' },
      { path: 'notes/n1.md', type: 'file' },
      { path: 'Other.md', type: 'file' },
    ]);
    const f = (await t.api.get(`/vaults/${t.id}/file?path=Home.md`)).body;
    expect(f.content).toContain('[[Other]]');
    const ok = await t.api.put(`/vaults/${t.id}/file?path=Home.md`, { content: 'v2', version: f.version });
    expect(ok.status).toBe(200);
    expect(ok.body.version).not.toBe(f.version);
    const stale = await t.api.put(`/vaults/${t.id}/file?path=Home.md`, { content: 'v3', version: f.version });
    expect(stale.status).toBe(409);
    expect(stale.body.currentVersion).toBe(ok.body.version);
    // Changed on disk behind the backend's back (as the AI would).
    await writeFile(join(t.vaults.vaultRootDir(t.id), 'Home.md'), 'ai edit');
    expect((await t.api.put(`/vaults/${t.id}/file?path=Home.md`, { content: 'v3', version: ok.body.version })).status).toBe(409);
    expect((await t.api.put(`/vaults/${t.id}/file?path=Home.md`, { content: 'v3', version: ok.body.version, force: true })).status).toBe(200);
    expect((await t.api.put(`/vaults/${t.id}/file?path=new/Note.md`, { content: 'n', version: null })).status).toBe(200);
    expect((await t.api.put(`/vaults/${t.id}/file?path=new/Note.md`, { content: 'n', version: null })).status).toBe(409);
    expect((await t.api.get(`/vaults/${t.id}/file?path=missing.md`)).status).toBe(404);
  });

  it('rejects traversal and symlinks', async () => {
    const t = await vaultApp();
    await symlink('/etc/hosts', join(t.vaults.vaultRootDir(t.id), 'evil.md'));
    expect((await t.api.get(`/vaults/${t.id}/file?path=../../etc/hosts`)).status).toBe(400);
    expect((await t.api.get(`/vaults/${t.id}/file?path=evil.md`)).status).toBe(400);
    expect((await t.api.put(`/vaults/${t.id}/file?path=.git/config`, { content: 'x', version: null })).status).toBe(400);
  });

  it('DELETE file with version', async () => {
    const t = await vaultApp();
    const f = (await t.api.get(`/vaults/${t.id}/file?path=Other.md`)).body;
    expect((await t.api.delete(`/vaults/${t.id}/file?path=Other.md&version=wrong`)).status).toBe(409);
    expect((await t.api.delete(`/vaults/${t.id}/file?path=Other.md&version=${f.version}`)).status).toBe(204);
    expect((await t.api.get(`/vaults/${t.id}/changes`)).body).toEqual([{ path: 'Other.md', kind: 'deleted' }]);
  });

  it('search finds content and file names', async () => {
    const t = await vaultApp();
    const hits = (await t.api.get(`/vaults/${t.id}/search?q=ALPHA`)).body;
    expect(hits).toEqual([{ path: 'notes/n1.md', line: 1, text: 'alpha beta' }]);
    expect((await t.api.get(`/vaults/${t.id}/search?q=other`)).body[0]).toEqual({ path: 'Other.md', line: 0, text: 'Other.md' });
  });
});

describe('git API', () => {
  it('changes + diff + discard', async () => {
    const t = await vaultApp();
    for (const p of ['Home.md', 'Other.md']) {
      const f = (await t.api.get(`/vaults/${t.id}/file?path=${p}`)).body;
      await t.api.put(`/vaults/${t.id}/file?path=${p}`, { content: `changed ${p}\n`, version: f.version });
    }
    expect((await t.api.get(`/vaults/${t.id}/changes`)).body).toHaveLength(2);
    expect((await t.api.get(`/vaults/${t.id}/changes/diff?path=Home.md`)).body.diff).toContain('+changed Home.md');
    await t.api.post(`/vaults/${t.id}/discard?path=Home.md`);
    expect((await t.api.get(`/vaults/${t.id}/changes`)).body).toEqual([{ path: 'Other.md', kind: 'modified' }]);
    expect((await t.api.get(`/vaults/${t.id}/status`)).body).toMatchObject({ state: 'ready', changedCount: 1, unpushedCount: 0, busy: 'none' });
  });

  it('commit = pull → commit all → push; the remote has one new commit, tree clean', async () => {
    const t = await vaultApp();
    const f = (await t.api.get(`/vaults/${t.id}/file?path=Home.md`)).body;
    await t.api.put(`/vaults/${t.id}/file?path=Home.md`, { content: 'mine', version: f.version });
    await t.api.put(`/vaults/${t.id}/file?path=added.md`, { content: 'added', version: null });
    await t.remote.obsidianPush({ 'Other.md': 'from obsidian' });
    const r = await t.api.post(`/vaults/${t.id}/commit`, { message: 'Update 2 files' });
    expect(r.body).toMatchObject({ pushed: true });
    expect(t.remote.remoteLog().slice(0, 2)).toEqual(['Update 2 files', 'obsidian edit']);
    expect(t.remote.remoteFile('added.md')).toBe('added');
    expect((await t.api.get(`/vaults/${t.id}/status`)).body).toMatchObject({ changedCount: 0, unpushedCount: 0 });
    expect(sh(t.remote.bare, 'log', '-1', '--format=%B')).not.toContain('Co-authored-by');
  });

  it('commit message proposal falls back to "Update N files" without opencode', async () => {
    const t = await vaultApp();
    await t.api.put(`/vaults/${t.id}/file?path=x.md`, { content: 'x', version: null });
    expect((await t.api.post(`/vaults/${t.id}/commit-message`)).body).toEqual({ message: 'Update 1 file', fallback: true });
  });

  it('AI-touched set: trailer iff a touched path is committed; discard removes; survives restart; empty after commit', async () => {
    const t = await vaultApp();
    await writeFile(join(t.vaults.vaultRootDir(t.id), 'Other.md'), 'ai');
    await t.vaults.markAiTouched(t.id, ['Other.md']);
    await t.api.post(`/vaults/${t.id}/discard?path=Other.md`);
    await t.api.put(`/vaults/${t.id}/file?path=h.md`, { content: 'human', version: null });
    await t.api.post(`/vaults/${t.id}/commit`, { message: 'human only' });
    expect(sh(t.remote.bare, 'log', '-1', '--format=%B')).not.toContain('Co-authored-by');

    await writeFile(join(t.vaults.vaultRootDir(t.id), 'Other.md'), 'ai again');
    await t.vaults.markAiTouched(t.id, ['Other.md']);
    const t2 = await makeApp(t.remote.remoteBase, {}, t.dirs);
    cleanups.push(() => t2.vaults.close());
    expect(t2.vaults.aiTouched(t.id)).toEqual(['Other.md']);
    await t2.api.post(`/vaults/${t.id}/commit`, { message: 'with ai' });
    expect(sh(t.remote.bare, 'log', '-1', '--format=%B')).toContain('Co-authored-by: karpathy.ai agent');
    expect(t2.vaults.aiTouched(t.id)).toEqual([]);
  });

  it('pull on open brings Obsidian changes; skipped while a shared holder runs', async () => {
    const t = await vaultApp();
    await t.remote.obsidianPush({ 'Other.md': 'remote v2\n' });
    const release = await t.vaults.lock(t.id).acquireShared('turn');
    await t.api.post(`/vaults/${t.id}/open`);
    expect((await t.api.get(`/vaults/${t.id}/file?path=Other.md`)).body.content).toBe('other\n');
    release();
    await t.api.post(`/vaults/${t.id}/open`);
    expect((await t.api.get(`/vaults/${t.id}/file?path=Other.md`)).body.content).toBe('remote v2\n');
  });

  it('commit issued during a long save waits for it', async () => {
    const t = await vaultApp();
    const release = await t.vaults.lock(t.id).acquireShared('save');
    let committed = false;
    await writeFile(join(t.vaults.vaultRootDir(t.id), 'Other.md'), 'x');
    const c = t.api.post(`/vaults/${t.id}/commit`, { message: 'm' }).then((r) => {
      committed = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(committed).toBe(false);
    expect((await t.api.get(`/vaults/${t.id}/status`)).body.busy).toBe('sync');
    release();
    expect((await c).body.pushed).toBe(true);
  });

  it('push failure → unpushed; retry push later succeeds', async () => {
    const t = await vaultApp();
    const { rename } = await import('node:fs/promises');
    await rename(t.remote.bare, `${t.remote.bare}.away`);
    await writeFile(join(t.vaults.vaultRootDir(t.id), 'Other.md'), 'offline');
    const r = await t.api.post(`/vaults/${t.id}/commit`, { message: 'offline' });
    expect(r.body).toMatchObject({ pushed: false });
    expect((await t.api.get(`/vaults/${t.id}/status`)).body).toMatchObject({ changedCount: 0, unpushedCount: 1 });
    await rename(`${t.remote.bare}.away`, t.remote.bare);
    expect((await t.api.post(`/vaults/${t.id}/push`)).body).toMatchObject({ pushed: true });
    expect((await t.api.get(`/vaults/${t.id}/status`)).body.unpushedCount).toBe(0);
    expect(t.remote.remoteLog()[0]).toBe('offline');
  });

  it('conflict: 423 on writes, survives restart, resolution returns to normal', async () => {
    const t = await vaultApp();
    const f = (await t.api.get(`/vaults/${t.id}/file?path=Other.md`)).body;
    await t.api.put(`/vaults/${t.id}/file?path=Other.md`, { content: 'mine\n', version: f.version });
    await t.remote.obsidianPush({ 'Other.md': 'theirs\n' });
    const c = await t.api.post(`/vaults/${t.id}/commit`, { message: 'x' });
    expect(c.status).toBe(409);
    const st = (await t.api.get(`/vaults/${t.id}/status`)).body;
    expect(st).toMatchObject({ state: 'conflict', conflictPaths: ['Other.md'] });
    expect((await t.api.put(`/vaults/${t.id}/file?path=Home.md`, { content: 'x', version: null, force: true })).status).toBe(423);
    expect((await t.api.get(`/vaults/${t.id}/conflicts/sides?path=Other.md`)).body).toEqual({ mine: 'mine\n', theirs: 'theirs\n' });

    const t2 = await makeApp(t.remote.remoteBase, {}, t.dirs);
    cleanups.push(() => t2.vaults.close());
    expect((await t2.api.get(`/vaults/${t.id}`)).body.state).toBe('conflict');
    const res = await t2.api.post(`/vaults/${t.id}/conflicts/resolve`, { path: 'Other.md', choice: 'both' });
    expect(res.body).toMatchObject({ state: 'ready', conflictPaths: [] });
    expect(await readFile(join(t2.vaults.vaultRootDir(t.id), 'Other.md'), 'utf8')).toBe('mine\n');
    const names = (await t2.api.get(`/vaults/${t.id}/changes`)).body.map((x: { path: string }) => x.path);
    expect(names).toEqual(expect.arrayContaining(['Other.md', expect.stringMatching(/^Other\.conflict-\d{4}-\d{2}-\d{2}\.md$/)]));
    expect((await t2.api.post(`/vaults/${t.id}/commit`, { message: 'resolved' })).body.pushed).toBe(true);
  });
});

describe('event stream', () => {
  it('snapshot first; a file written behind the back → files-changed + status within 1 s', async () => {
    const t = await vaultApp();
    const server = http.createServer(t.app).listen(0);
    cleanups.push(() => void server.close());
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    const ctrl = new AbortController();
    cleanups.push(() => ctrl.abort());
    const res = await fetch(`http://127.0.0.1:${port}/api/vaults/${t.id}/events`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: ctrl.signal });
    const reader = res.body!.getReader();
    const events: VaultEvent[] = [];
    let buf = '';
    const pump = (async () => {
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) events.push(JSON.parse(line));
        }
      }
    })();
    const waitFor = async (pred: () => boolean, ms: number) => {
      const end = Date.now() + ms;
      while (!pred()) {
        if (Date.now() > end) throw new Error(`timeout; events: ${JSON.stringify(events)}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    await waitFor(() => events.length > 0, 2000);
    expect(events[0]).toMatchObject({ type: 'status', status: { changedCount: 0 } });
    await new Promise((r) => setTimeout(r, 300)); // watcher ready
    const t0 = Date.now();
    await writeFile(join(t.vaults.vaultRootDir(t.id), 'Other.md'), 'written by the AI');
    await waitFor(() => events.some((e) => e.type === 'files-changed'), 1500);
    await waitFor(() => events.some((e) => e.type === 'status' && e.status.changedCount === 1), 1500);
    expect(Date.now() - t0).toBeLessThan(1500);
    const fc = events.find((e) => e.type === 'files-changed');
    expect(fc).toMatchObject({ type: 'files-changed', files: [{ path: 'Other.md', version: expect.any(String) }] });
    ctrl.abort();
    await pump;
  });
});
