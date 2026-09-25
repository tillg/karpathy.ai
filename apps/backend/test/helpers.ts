import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const identity = { name: 'Test User', email: 'test@example.com' };

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Obsidian', GIT_AUTHOR_EMAIL: 'o@example.com', GIT_COMMITTER_NAME: 'Obsidian', GIT_COMMITTER_EMAIL: 'o@example.com' },
  });
}

export async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [p, c] of Object.entries(files)) {
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), c);
  }
}

/**
 * A local bare repo as "GitHub" (real git, real fetch/push) under `<base>/remotes/<owner>/<name>.git`,
 * plus a second clone playing "Obsidian".
 */
export async function makeRemote(files: Record<string, string>, { owner = 'o', name = 'vault', branch = 'main' } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'kai-'));
  const remotesBase = join(base, 'remotes');
  const bare = join(remotesBase, owner, `${name}.git`);
  await mkdir(bare, { recursive: true });
  sh(bare, 'init', '-q', '--bare', '-b', branch);
  const seed = join(base, 'seed');
  await mkdir(seed);
  sh(seed, 'init', '-q', '-b', branch);
  await writeFiles(seed, files);
  sh(seed, 'add', '-A');
  sh(seed, 'commit', '-q', '-m', 'seed');
  sh(seed, 'remote', 'add', 'origin', bare);
  sh(seed, 'push', '-q', 'origin', branch);
  const obsidian = join(base, 'obsidian');
  sh(base, 'clone', '-q', bare, obsidian);
  return {
    base,
    bare,
    /** `file://` base URL: `${remoteBase}${owner}/${name}.git`. */
    remoteBase: `file://${remotesBase}/`,
    repo: `${owner}/${name}`,
    obsidian,
    /** Commit + push files from the "Obsidian" clone. */
    async obsidianPush(changes: Record<string, string | null>, msg = 'obsidian edit') {
      sh(obsidian, 'pull', '-q', '--ff-only');
      for (const [p, c] of Object.entries(changes)) {
        if (c === null) sh(obsidian, 'rm', '-q', p);
        else await writeFiles(obsidian, { [p]: c });
      }
      sh(obsidian, 'add', '-A');
      sh(obsidian, 'commit', '-q', '-m', msg);
      sh(obsidian, 'push', '-q');
    },
    remoteLog(): string[] {
      return sh(bare, 'log', '--format=%s', branch).trim().split('\n');
    },
    remoteFile(path: string): string {
      return sh(bare, 'show', `${branch}:${path}`);
    },
  };
}
