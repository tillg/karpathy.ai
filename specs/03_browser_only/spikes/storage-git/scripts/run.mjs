// Runs all storage+git spikes in headless Chromium and WebKit and writes results/<engine>.json.
// Usage: npm run spike [-- --engines=chromium,webkit] [--big] [--no-write]
//   --big       ONLY clone the full 1.7 GB mylife.git (slow; may crash the tab) -> results/<engine>-big.json
//   --no-write  skip the one GitHub REST write commit (S4)
import { chromium, webkit } from '@playwright/test';
import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServers } from './servers.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}`));
const engines = (arg('engines')?.split('=')[1] ?? 'chromium,webkit').split(',');
const GIT = 'http://localhost:8788';
const TEST_REPO = 'tillg/karpathy-ai-test-vault';
const PUBLIC_REPO = 'octocat/Hello-World';
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const hostGit = (cwd, ...a) => sh(cwd, '-c', 'user.name=Host', '-c', 'user.email=host@example.invalid', ...a);
let token = null;
try { token = execFileSync('gh', ['auth', 'token']).toString().trim(); } catch { console.log('no gh token: authenticated spikes skipped'); }

await build({ configFile: join(ROOT, 'vite.config.js'), root: join(ROOT, 'src') });
const stop = await startServers();
mkdirSync(join(ROOT, 'results'), { recursive: true });

for (const name of engines) {
  const engine = { chromium, webkit }[name];
  const profile = join(ROOT, 'tmp', `profile-${name}`);
  rmSync(profile, { recursive: true, force: true });
  const ctx = await engine.launchPersistentContext(profile, { headless: true });
  let page;
  const openPage = async () => {
    page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && console.log(`  [${name} console] ${m.text().slice(0, 200)}`));
    await page.goto('http://localhost:8787/');
    await page.waitForFunction(() => window.spikesReady);
  };
  await openPage();
  const results = { engine: name, version: ctx.browser()?.version() ?? engine.name(), runs: [] };

  // Runs window.spikes[fn](...args) with a timeout; survives tab crashes.
  async function run(label, fn, args = [], timeoutMs = 300_000) {
    process.stdout.write(`${name} ${label} ... `);
    const t = Date.now();
    let result;
    try {
      result = await Promise.race([
        page.evaluate(([fn, args]) => window.spikes[fn](...args), [fn, args]),
        new Promise((_, rej) => page.once('crash', () => rej(new Error('page crashed')))),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${timeoutMs / 1000}s`)), timeoutMs)),
      ]);
    } catch (e) {
      result = { runnerError: e.message.split('\n')[0].slice(0, 300) };
      await page.close().catch(() => {});
      await openPage();
    }
    const wallMs = Date.now() - t;
    console.log(JSON.stringify(result).slice(0, 300));
    results.runs.push({ label, wallMs, result });
    return result;
  }

  const big = !!arg('big');
  if (big) {
    for (const [fsKind, depth] of [['idb', 1], ['opfs-shim', 1], ['idb', undefined]]) {
      await run(`S2 clone mylife.git (1.7 GB pack, 5604 files) ${fsKind} depth ${depth ?? 'full'}`, 'cloneAndStatus', [{ url: `${GIT}/mylife.git`, fsKind, depth }], 900_000);
    }
  } else {
  // Ephemeral (non-persistent) context = like a private window: does OPFS work at all?
  const eph = await engine.launch();
  const ep = await eph.newPage();
  await ep.goto('http://localhost:8787/'); await ep.waitForFunction(() => window.spikesReady);
  results.runs.push({ label: 'S1 OPFS in ephemeral context', result: await ep.evaluate(() => window.spikes.opfsTiny()) });
  await eph.close();

  await run('S5 feature detection', 's5');
  await run('S1 OPFS vault write/read', 's1');

  await run('S2 clone github.com direct (no proxy)', 's2GithubDirect', [`https://github.com/${PUBLIC_REPO}`]);
  await run('S2 clone public via cors-proxy, depth 1', 'cloneAndStatus', [{ url: 'https://github.com/isomorphic-git/lightning-fs', fsKind: 'idb', depth: 1, corsProxy: 'http://localhost:9999' }]);
  if (token) await run('S2 clone private test vault via cors-proxy + token', 'cloneAndStatus', [{ url: `https://github.com/${TEST_REPO}`, fsKind: 'idb', depth: 1, corsProxy: 'http://localhost:9999', token }]);
  for (const fsKind of ['idb', 'opfs-shim', 'componentor-hybrid']) {
    for (const depth of [undefined, 1]) {
      await run(`S2 clone mdvault (3100 md) ${fsKind} depth ${depth ?? 'full'}`, 'cloneAndStatus', [{ url: `${GIT}/mdvault.git`, fsKind, depth }]);
    }
  }
  await run('S2 clone mdvault componentor-opfs (mode opfs) depth 1', 'cloneAndStatus', [{ url: `${GIT}/mdvault.git`, fsKind: 'componentor-opfs', depth: 1 }], 120_000);

  // S3: fresh copy of the md vault as push target; host side acts as "another device".
  const bare = join(ROOT, 'tmp/git/push.git'), host = join(ROOT, 'tmp/hostwork');
  rmSync(bare, { recursive: true, force: true }); rmSync(host, { recursive: true, force: true });
  cpSync(join(ROOT, 'tmp/git/mdvault.git'), bare, { recursive: true });
  const files = sh(bare, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n');
  const [fileA, fileB, fileC] = [files[0], files[1], files[2]];
  await run('S3 clone push.git', 's3Clone');
  const push = await run('S3 edit+commit+push', 's3EditPush', [fileA]);
  const hostHead = sh(bare, 'log', '-1', '--format=%H %s');
  results.runs.push({ label: 'S3 host verify push', result: { hostHead, matchesBrowser: hostHead.startsWith(push.oid ?? '-') } });
  sh(ROOT, 'clone', '-q', bare, host);
  writeFileSync(join(host, fileB), 'Host change\n' + sh(host, 'show', `HEAD:${fileB}`));
  hostGit(host, 'commit', '-qam', 'host: concurrent non-conflicting change'); hostGit(host, 'push', '-q');
  await run('S3 pull non-conflicting concurrent change (merge) + push', 's3Pull', [{ file: fileC }]);
  results.runs.push({ label: 'S3 host verify merge', result: { hostLog: sh(bare, 'log', '-3', '--format=%h %p %s').split('\n') } });
  hostGit(host, 'pull', '-q', '--no-rebase');
  writeFileSync(join(host, fileA), 'HOST VERSION OF LINE 1\n' + sh(host, 'show', `HEAD:${fileA}`).split('\n').slice(1).join('\n'));
  hostGit(host, 'commit', '-qam', 'host: conflicting change'); hostGit(host, 'push', '-q');
  await run('S3 pull conflicting change', 's3Pull', [{ file: fileA, line: 'BROWSER VERSION OF LINE 1', expectConflict: true }]);

  await run('S4 REST read public repo, unauthenticated', 's4Read', [PUBLIC_REPO]);
  if (token) {
    await run('S4 REST read private test vault, token', 's4Read', [TEST_REPO, token]);
    if (name === 'chromium' && !arg('no-write')) await run('S4 REST write 1 commit to test vault', 's4Write', [TEST_REPO, token]);
  }
  }

  await ctx.close();
  writeFileSync(join(ROOT, 'results', `${name}${big ? '-big' : ''}.json`), JSON.stringify(results, null, 2));
}
stop();
console.log('wrote results/*.json');
