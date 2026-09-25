import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PathError, resolveInVault } from '../src/paths.js';

let root: string;
let outside: string;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'paths-'));
  root = join(base, 'vault');
  outside = join(base, 'outside');
  await mkdir(join(root, 'notes'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, 'secret.md'), 'x');
  await writeFile(join(root, 'notes', 'a.md'), 'a');
  await symlink(join(outside, 'secret.md'), join(root, 'link.md'));
  await symlink(outside, join(root, 'linkdir'));
});

describe('resolveInVault', () => {
  it('resolves normal and new paths inside the root', async () => {
    expect(await resolveInVault(root, 'notes/a.md')).toBe(join(root, 'notes/a.md'));
    expect(await resolveInVault(root, 'new/dir/b.md')).toBe(join(root, 'new/dir/b.md'));
    expect(await resolveInVault(root, './notes//a.md')).toBe(join(root, 'notes/a.md'));
  });

  it.each(['../outside/secret.md', 'notes/../../outside/secret.md', '/etc/passwd', '', '.git/config', 'a\0b'])(
    'rejects %j',
    async (p) => {
      await expect(resolveInVault(root, p)).rejects.toBeInstanceOf(PathError);
    },
  );

  it('rejects symlinked files and directories', async () => {
    await expect(resolveInVault(root, 'link.md')).rejects.toBeInstanceOf(PathError);
    await expect(resolveInVault(root, 'linkdir/secret.md')).rejects.toBeInstanceOf(PathError);
  });
});
