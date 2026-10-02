import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveNote } from '../../../deploy/opencode/lib/resolve-note.js';
import { testDir } from './opencode-container.js';

// The open_note tool's path check, on a real directory (the tool itself runs inside opencode).

const base = testDir('open-note');
const vault = join(base, 'vault');

beforeAll(async () => {
  await mkdir(join(vault, 'notes'), { recursive: true });
  await mkdir(join(vault, '.git'), { recursive: true });
  await mkdir(join(base, 'other'), { recursive: true });
  await writeFile(join(vault, 'notes/a.md'), '# A\n');
  await writeFile(join(vault, 'notes/.hidden.md'), 'x\n');
  await writeFile(join(vault, '.git/config'), 'x\n');
  await writeFile(join(base, 'other/a.md'), 'x\n');
});

describe('resolveNote', () => {
  it('accepts an existing note, also with an absolute path inside the vault', async () => {
    expect(await resolveNote(vault, 'notes/a.md')).toBe('notes/a.md');
    expect(await resolveNote(vault, join(vault, 'notes/a.md'))).toBe('notes/a.md');
  });

  it('refuses a missing file and a directory', async () => {
    await expect(resolveNote(vault, 'missing.md')).rejects.toThrow('no such note: missing.md');
    await expect(resolveNote(vault, 'notes')).rejects.toThrow('no such note: notes');
  });

  it('refuses paths outside the vault', async () => {
    await expect(resolveNote(vault, '../other/a.md')).rejects.toThrow('outside the vault');
    await expect(resolveNote(vault, '/etc/passwd')).rejects.toThrow('outside the vault');
  });

  it('refuses dot-paths, as the file list hides them', async () => {
    await expect(resolveNote(vault, '.git/config')).rejects.toThrow('no such note: .git/config');
    await expect(resolveNote(vault, 'notes/.hidden.md')).rejects.toThrow('no such note: notes/.hidden.md');
  });
});
