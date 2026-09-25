import { readFile, rename, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_TRAILER, Repo } from '../src/repo.js';
import { identity, makeRemote, sh, writeFiles } from './helpers.js';

async function setup(files: Record<string, string> = { 'a.md': 'a\n', 'b.md': 'b\n', 'k.md': 'k\n' }, root = '') {
  const remote = await makeRemote(files);
  const dir = join(remote.base, 'vaults', 'v1');
  await Repo.clone(`${remote.remoteBase}${remote.repo}.git`, dir, 'main', { identity });
  const repo = new Repo(dir, 'main', root, { identity });
  const read = (p: string) => readFile(join(repo.rootDir, p), 'utf8');
  const write = (p: string, c: string) => writeFiles(repo.rootDir, { [p]: c });
  return { remote, repo, dir, read, write };
}

describe('Repo changes / discard', () => {
  it('lists changed files and discards one back to HEAD', async () => {
    const { repo, write, read } = await setup();
    await write('a.md', 'A\n');
    await write('new.md', 'n\n');
    await rm(join(repo.rootDir, 'k.md'));
    expect(await repo.changes()).toEqual(
      expect.arrayContaining([
        { path: 'a.md', kind: 'modified' },
        { path: 'new.md', kind: 'untracked' },
        { path: 'k.md', kind: 'deleted' },
      ]),
    );
    await repo.discard('a.md');
    await repo.discard('new.md');
    await repo.discard('k.md');
    expect(await read('a.md')).toBe('a\n');
    expect(await read('k.md')).toBe('k\n');
    expect(await repo.changes()).toEqual([]);
  });

  it('scopes changes to a subfolder vault root', async () => {
    const { repo, write } = await setup({ 'wiki/a.md': 'a\n', 'outside.md': 'o\n' }, 'wiki');
    await write('a.md', 'A\n');
    await writeFile(join(repo.dir, 'outside.md'), 'O\n');
    expect(await repo.changes()).toEqual([{ path: 'a.md', kind: 'modified' }]);
  });

  it('diffs tracked and untracked files', async () => {
    const { repo, write } = await setup();
    await write('a.md', 'A\n');
    await write('n.md', 'new\n');
    expect(await repo.diff('a.md')).toContain('+A');
    expect(await repo.diff('n.md')).toContain('+new');
  });
});

describe('Repo commit + push', () => {
  it('commits all changes, pushes, leaves a clean tree; author = user', async () => {
    const { remote, repo, write } = await setup();
    await write('a.md', 'A\n');
    await write('n.md', 'N\n');
    const hash = await repo.commit('Update 2 files', false);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    expect(await repo.push()).toEqual({ pushed: true });
    expect(remote.remoteLog()[0]).toBe('Update 2 files');
    expect(remote.remoteFile('n.md')).toBe('N\n');
    expect(await repo.changes()).toEqual([]);
    expect(sh(remote.bare, 'log', '-1', '--format=%an <%ae>')).toBe('Test User <test@example.com>\n');
    expect(await repo.unpushedCount()).toBe(0);
  });

  it('adds the agent trailer only when asked', async () => {
    const { remote, repo, write } = await setup();
    await write('a.md', 'A\n');
    await repo.commit('msg', true);
    await repo.push();
    expect(sh(remote.bare, 'log', '-1', '--format=%B')).toContain(AI_TRAILER);
  });

  it('returns null when nothing to commit', async () => {
    const { repo } = await setup();
    expect(await repo.commit('x', false)).toBeNull();
  });

  it('push failure keeps the commit local; the next pull pushes it', async () => {
    const { remote, repo, write } = await setup();
    const moved = `${remote.bare}.away`;
    await rename(remote.bare, moved);
    await write('a.md', 'A\n');
    await repo.commit('offline commit', false);
    expect((await repo.push()).pushed).toBe(false);
    expect(await repo.unpushedCount()).toBe(1);
    expect((await repo.pull()).kind).toBe('offline');
    await rename(moved, remote.bare);
    expect(await repo.pull()).toEqual({ kind: 'ok', pushed: true });
    expect(await repo.unpushedCount()).toBe(0);
    expect(remote.remoteLog()[0]).toBe('offline commit');
  });
});

describe('Repo pull', () => {
  it('brings in remote changes and keeps local uncommitted changes', async () => {
    const { remote, repo, write, read } = await setup();
    await write('a.md', 'local\n');
    await write('mine-new.md', 'mine\n');
    await remote.obsidianPush({ 'b.md': 'remote\n', 'r.md': 'r\n' });
    expect(await repo.pull()).toEqual({ kind: 'ok', pushed: false });
    expect(await read('b.md')).toBe('remote\n');
    expect(await read('r.md')).toBe('r\n');
    expect(await read('a.md')).toBe('local\n');
    expect(await read('mine-new.md')).toBe('mine\n');
    expect(await repo.inConflict()).toBe(false);
    expect(sh(repo.dir, 'stash', 'list')).toBe('');
  });

  it('folds an unpushed commit into uncommitted changes when the remote moved; nothing lost', async () => {
    const { remote, repo, write, read } = await setup();
    const moved = `${remote.bare}.away`;
    await rename(remote.bare, moved);
    await write('a.md', 'unpushed\n');
    await repo.commit('local only', false);
    await rename(moved, remote.bare);
    await remote.obsidianPush({ 'b.md': 'remote\n' });
    expect((await repo.pull()).kind).toBe('ok');
    expect(await repo.unpushedCount()).toBe(0);
    expect(await read('a.md')).toBe('unpushed\n');
    expect(await read('b.md')).toBe('remote\n');
    expect(await repo.changes()).toEqual([{ path: 'a.md', kind: 'modified' }]);
  });
});

describe('Repo conflict', () => {
  async function conflicted() {
    const s = await setup();
    await s.write('a.md', 'mine\n');
    await s.write('both-new.md', 'mine new\n');
    await rm(join(s.repo.rootDir, 'k.md'));
    await s.write('ok-new.md', 'no clash\n');
    await s.remote.obsidianPush({ 'a.md': 'theirs\n', 'both-new.md': 'theirs new\n', 'k.md': 'theirs k\n' });
    const r = await s.repo.pull();
    return { ...s, r };
  }

  it('stash pop failure → conflict on exactly the clashing paths, derived from git', async () => {
    const { repo, r, read } = await conflicted();
    expect(r.kind).toBe('conflict');
    expect(r.kind === 'conflict' && r.paths.sort()).toEqual(['a.md', 'both-new.md', 'k.md']);
    expect(await repo.inConflict()).toBe(true);
    expect(await read('ok-new.md')).toBe('no clash\n');
    // "Restart": a fresh Repo instance still sees the conflict.
    expect(await new Repo(repo.dir, 'main', '', { identity }).inConflict()).toBe(true);
  });

  it('keep mine / theirs / both; then finish → normal, no stash, no unmerged, nothing lost', async () => {
    const { repo, read, dir } = await conflicted();
    const now = new Date('2026-09-25T12:00:00Z');
    await repo.resolve('a.md', 'both', now);
    await repo.resolve('both-new.md', 'theirs', now);
    await repo.resolve('k.md', 'mine', now); // mine = deleted
    await repo.finishConflict();
    expect(await read('a.md')).toBe('mine\n');
    expect(await read('a.conflict-2026-09-25.md')).toBe('theirs\n');
    expect(await read('both-new.md')).toBe('theirs new\n');
    await expect(read('k.md')).rejects.toThrow();
    expect(await repo.inConflict()).toBe(false);
    expect(sh(dir, 'stash', 'list')).toBe('');
    expect(sh(dir, 'diff', '--name-only', '--diff-filter=U')).toBe('');
    const paths = (await repo.changes()).map((c) => c.path).sort();
    expect(paths).toEqual(['a.conflict-2026-09-25.md', 'a.md', 'k.md', 'ok-new.md']);
  });

  it('keep both with a deleted side keeps the side that exists', async () => {
    const { repo, read } = await conflicted();
    await repo.resolve('k.md', 'both');
    expect(await read('k.md')).toBe('theirs k\n');
  });

  it('untracked-only clash (both sides added the same new file) is a conflict too', async () => {
    const s = await setup();
    await s.write('same.md', 'mine\n');
    await s.remote.obsidianPush({ 'same.md': 'theirs\n' });
    const r = await s.repo.pull();
    expect(r).toEqual({ kind: 'conflict', paths: ['same.md'] });
    const sides = await s.repo.conflictSides('same.md');
    expect(sides.mine?.toString()).toBe('mine\n');
    expect(sides.theirs?.toString()).toBe('theirs\n');
    await s.repo.resolve('same.md', 'mine');
    await s.repo.finishConflict();
    expect(await s.read('same.md')).toBe('mine\n');
    expect(await s.repo.inConflict()).toBe(false);
  });
});
