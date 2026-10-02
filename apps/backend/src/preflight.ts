import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Git, type GitOptions } from './git.js';

/** The folders every vault root must have; matched case-insensitively, created with this spelling. */
export const REQUIRED_FOLDERS = ['Sources', 'Wiki'] as const;

/**
 * Checks a repo before it is attached: a depth-1, blobless, no-checkout clone (commits and trees
 * only) into a temp dir under `opts.dir`, always removed again. Throws GitError when the repo or
 * branch can't be fetched.
 */
export async function preflight(
  url: string,
  branch: string,
  root: string,
  opts: GitOptions & { dir: string },
): Promise<{ rootExists: boolean; missing: string[] }> {
  const tmp = await mkdtemp(join(opts.dir, 'pre-'));
  try {
    const git = new Git(tmp, opts);
    await git.run(['clone', '-q', '--depth', '1', '--filter=blob:none', '--no-checkout', '--branch', branch, '--end-of-options', url, 'c']);
    const ls = await new Git(join(tmp, 'c'), opts).run(['ls-tree', root ? `HEAD:${root}` : 'HEAD'], { allowFail: true });
    if (ls.code !== 0) return { rootExists: false, missing: [] };
    const dirs = new Set(
      ls.stdout
        .split('\n')
        .filter((l) => l.split(' ')[1] === 'tree')
        .map((l) => l.slice(l.indexOf('\t') + 1).toLowerCase()),
    );
    return { rootExists: true, missing: REQUIRED_FOLDERS.filter((f) => !dirs.has(f.toLowerCase())) };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
