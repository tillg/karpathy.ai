import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Git, GitError } from '../src/git.js';
import { preflight } from '../src/preflight.js';
import { identity, makeRemote } from './helpers.js';

async function check(files: Record<string, string>, root = '', branch = 'main') {
  const remote = await makeRemote(files, { structure: false });
  const dir = await mkdtemp(join(tmpdir(), 'kai-pre-'));
  const r = await preflight(`${remote.remoteBase}${remote.repo}.git`, branch, root, { dir, identity });
  return { ...r, left: await readdir(dir) };
}

describe('preflight', () => {
  it('both present → no missing folders', async () => {
    expect((await check({ 'Sources/a.md': 'a', 'Wiki/b.md': 'b' })).missing).toEqual([]);
  });

  it('only Sources → Wiki missing', async () => {
    expect((await check({ 'Sources/a.md': 'a', 'x.md': 'x' })).missing).toEqual(['Wiki']);
  });

  it('lowercase sources/ and wiki/ count as present', async () => {
    expect((await check({ 'sources/a.md': 'a', 'wiki/b.md': 'b' })).missing).toEqual([]);
  });

  it('a file named Wiki counts as missing', async () => {
    expect((await check({ 'Sources/a.md': 'a', Wiki: 'not a folder' })).missing).toEqual(['Wiki']);
  });

  it('respects the vault root', async () => {
    const r = await check({ 'Sources/a.md': 'a', 'Wiki/b.md': 'b', 'sub/Wiki/c.md': 'c' }, 'sub');
    expect(r).toMatchObject({ rootExists: true, missing: ['Sources'] });
    expect((await check({ 'a.md': 'a' }, 'nope')).rootExists).toBe(false);
  });

  it('a git that hangs is killed after timeoutMs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kai-pre-'));
    const started = Date.now();
    const r = await new Git(dir, { identity, timeoutMs: 300 }).run(['-c', 'alias.hang=!sleep 10', 'hang'], { allowFail: true });
    expect(r.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('leaves no temp dir behind, also on error', async () => {
    expect((await check({ 'a.md': 'a' })).left).toEqual([]);
    const dir = await mkdtemp(join(tmpdir(), 'kai-pre-'));
    await expect(preflight('file:///nowhere/o/x.git', 'main', '', { dir, identity })).rejects.toBeInstanceOf(GitError);
    expect(await readdir(dir)).toEqual([]);
  });
});
