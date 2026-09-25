import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigStore } from '../src/config-store.js';
import { Git } from '../src/git.js';
import { Vaults } from '../src/vaults.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { identity } from './helpers.js';

// @github tier: the throwaway test vault on GitHub, never the real life wiki.
const REPO = process.env.TEST_VAULT_REPO ?? 'tillg/karpathy-ai-test-vault';
const token = process.env.TEST_VAULT_TOKEN ?? execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const branch = `test-${Date.now()}`;

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'kai-gh-'));
  const store = await ConfigStore.open(join(base, 'config'));
  const vaults = new Vaults(store, { vaultsDir: join(base, 'vaults'), remoteBase: 'https://github.com/', githubToken: token, identity });
  await vaults.init();
  return { vaults, base };
}

const pushed: { dir: string }[] = [];
afterAll(async () => {
  // Remove the temporary branch from the test repo.
  for (const p of pushed) {
    execFileSync('git', ['init', '-q'], { cwd: p.dir }); // push needs a repo to run in
    await new Git(p.dir, { identity, token }).run(['push', '-q', `https://github.com/${REPO}.git`, '--delete', branch], { allowFail: true });
  }
});

describe('@github test vault', () => {
  it('clones the repo root and the wiki/ subfolder variant with the token', async () => {
    const { vaults } = await setup();
    const a = await vaults.add({ name: 'root', repo: REPO });
    const b = await vaults.add({ name: 'sub', repo: REPO, root: 'wiki' });
    await vaults.whenCloned(a.id);
    await vaults.whenCloned(b.id);
    expect(vaults.getVault(a.id).state).toBe('ready');
    expect((await vaults.listFiles(a.id)).map((f) => f.path)).toEqual(expect.arrayContaining(['README.md', 'Note A.md', 'wiki/Home.md']));
    expect((await vaults.listFiles(b.id)).map((f) => f.path)).toEqual(['Home.md', 'Page.md']);
    // The token is never written to .git/config.
    const cfg = execFileSync('git', ['config', '--list', '--local'], { cwd: vaults.vaultRootDir(a.id), encoding: 'utf8' });
    expect(cfg).not.toContain(token);
    await vaults.close();
  });

  it('bad repo → clone-failed with the git error, token redacted', async () => {
    const { vaults } = await setup();
    const v = await vaults.add({ name: 'bad', repo: 'tillg/karpathy-ai-no-such-repo' });
    await vaults.whenCloned(v.id);
    const got = vaults.getVault(v.id);
    expect(got.state).toBe('clone-failed');
    expect(got.error).toBeTruthy();
    expect(got.error).not.toContain(token);
  });

  it('commit + push round trip on a temporary branch; DELETE never touches the remote', async () => {
    const { vaults, base } = await setup();
    const v = await vaults.add({ name: 'rt', repo: REPO });
    await vaults.whenCloned(v.id);
    const dir = vaults.vaultRootDir(v.id);
    const git = new Git(dir, { identity, token });
    await git.run(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`]);
    pushed.push({ dir: base });
    await vaults.patch(v.id, { branch });
    await writeFile(join(dir, 'roundtrip.md'), `written at ${new Date().toISOString()}\n`);
    const r = await vaults.commit(v.id, 'Round trip test');
    expect(r.pushed).toBe(true);
    const remote = (await git.out(['ls-remote', 'origin', `refs/heads/${branch}`])).split('\t')[0];
    expect(remote).toBe(r.commit);
    await vaults.remove(v.id);
    const outside = new Git(base, { identity, token });
    expect((await outside.run(['ls-remote', '--exit-code', `https://github.com/${REPO}.git`, branch], { allowFail: true })).code).toBe(0);
    await vaults.close();
  });
});
