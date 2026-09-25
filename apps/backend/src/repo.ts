import { mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import type { Change, ChangeKind, ConflictChoice } from '@karpathy/shared';
import { Git, type GitOptions } from './git.js';

export const PULL_STASH = 'karpathy-ai-pull';
export const AI_TRAILER = 'Co-authored-by: karpathy.ai agent <agent@karpathy.ai>';

export type PullResult =
  | { kind: 'ok'; pushed: boolean; pushError?: string }
  /** Fetch failed (e.g. remote unreachable); nothing changed locally. */
  | { kind: 'offline'; error: string }
  /** Stash pop failed: the vault is now in Conflict on these repo-relative paths. */
  | { kind: 'conflict'; paths: string[] };

export interface PushResult {
  pushed: boolean;
  error?: string;
}

/**
 * git operations on one vault clone (mvp §2.4). Paths in and out are vault-root-relative;
 * `root` is the vault's subfolder inside the repo ('' = repo root).
 */
export class Repo {
  readonly git: Git;

  constructor(
    readonly dir: string,
    readonly branch: string,
    readonly root: string,
    opts: GitOptions,
  ) {
    this.git = new Git(dir, opts);
  }

  static async clone(url: string, dir: string, branch: string, opts: GitOptions): Promise<void> {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dirname(dir), { recursive: true });
    await new Git(dirname(dir), opts).run(['clone', '--branch', branch, '--', url, dir]);
  }

  get rootDir(): string {
    return join(this.dir, this.root);
  }

  toRepoPath(p: string): string {
    return this.root ? posix.join(this.root, p) : p;
  }

  /** Repo-relative → vault-relative; null when outside the vault root. */
  toVaultPath(p: string): string | null {
    if (!this.root) return p;
    const prefix = `${this.root}/`;
    return p.startsWith(prefix) ? p.slice(prefix.length) : null;
  }

  private get upstream() {
    return `origin/${this.branch}`;
  }

  private get pathspec() {
    return ['--', this.root || '.'];
  }

  async changes(): Promise<Change[]> {
    const out = await this.git.out(['status', '--porcelain=v1', '-z', '--untracked-files=all', ...this.pathspec]);
    const entries = out.split('\0');
    const changes: Change[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.length < 4) continue;
      const xy = e.slice(0, 2);
      const path = this.toVaultPath(e.slice(3));
      if (xy[0] === 'R' || xy[0] === 'C') i++; // next entry is the rename source
      if (path === null) continue;
      changes.push({ path, kind: kindOf(xy) });
    }
    return changes;
  }

  async unpushedCount(): Promise<number> {
    const r = await this.git.run(['rev-list', '--count', `${this.upstream}..HEAD`], { allowFail: true });
    return r.code === 0 ? Number(r.stdout.trim()) : 0;
  }

  async inConflict(): Promise<boolean> {
    return (await this.pullStashRef()) !== null;
  }

  private async pullStashRef(): Promise<string | null> {
    const out = await this.git.out(['stash', 'list', '--format=%gd %s']);
    for (const line of out.split('\n')) {
      const [ref, ...rest] = line.split(' ');
      if (ref && rest.join(' ').endsWith(PULL_STASH)) return ref;
    }
    return null;
  }

  async diff(path: string): Promise<string> {
    const rp = this.toRepoPath(path);
    const tracked = (await this.git.run(['ls-files', '--error-unmatch', '--', rp], { allowFail: true })).code === 0;
    if (tracked) return this.git.out(['diff', 'HEAD', '--', rp]);
    // Untracked: diff against /dev/null (exit code 1 = differences).
    return (await this.git.run(['diff', '--no-index', '--', '/dev/null', rp], { allowFail: true })).stdout;
  }

  /** Full diff of the vault's uncommitted changes (for the commit message proposal). */
  async fullDiff(): Promise<{ files: Change[]; stat: string; diff: string }> {
    const files = await this.changes();
    const stat = (await this.git.run(['diff', 'HEAD', '--stat', ...this.pathspec], { allowFail: true })).stdout;
    let diff = (await this.git.run(['diff', 'HEAD', ...this.pathspec], { allowFail: true })).stdout;
    for (const c of files.filter((f) => f.kind === 'untracked')) diff += await this.diff(c.path);
    return { files, stat, diff };
  }

  /** Restores one file from the last commit (untracked files are deleted). */
  async discard(path: string): Promise<void> {
    const rp = this.toRepoPath(path);
    const inHead = (await this.git.run(['cat-file', '-e', `HEAD:${rp}`], { allowFail: true })).code === 0;
    if (inHead) await this.git.run(['restore', '--source=HEAD', '--staged', '--worktree', '--', rp]);
    else {
      await this.git.run(['rm', '--cached', '-q', '--ignore-unmatch', '--', rp]);
      await rm(join(this.dir, rp), { force: true });
    }
  }

  /** Pull procedure, mvp §2.4 steps 1–5 (no rebase, no --autostash). */
  async pull(): Promise<PullResult> {
    const fetch = await this.git.run(['fetch', 'origin', this.branch], { allowFail: true });
    if (fetch.code !== 0) return { kind: 'offline', error: fetch.stderr.trim() };
    // 1. Upstream has not moved beyond HEAD: only push what's unpushed.
    const notMoved = (await this.git.run(['merge-base', '--is-ancestor', this.upstream, 'HEAD'], { allowFail: true })).code === 0;
    if (notMoved) {
      if ((await this.unpushedCount()) === 0) return { kind: 'ok', pushed: false };
      const p = await this.push();
      return { kind: 'ok', pushed: p.pushed, pushError: p.error };
    }
    // 2. Fold unpushed commits back into uncommitted changes.
    if ((await this.unpushedCount()) > 0) {
      const base = (await this.git.out(['merge-base', 'HEAD', this.upstream])).trim();
      await this.git.run(['reset', '-q', '--mixed', base]);
    }
    // 3. Stash uncommitted changes (whole repo).
    const dirty = (await this.git.out(['status', '--porcelain', '--untracked-files=all'])).trim() !== '';
    if (dirty) await this.git.run(['stash', 'push', '-q', '--include-untracked', '-m', PULL_STASH]);
    // 4. Always a fast-forward now.
    await this.git.run(['merge', '-q', '--ff-only', this.upstream]);
    // 5. Re-apply.
    if (!dirty) return { kind: 'ok', pushed: false };
    const pop = await this.git.run(['stash', 'pop', '-q'], { allowFail: true });
    if (pop.code === 0) return { kind: 'ok', pushed: false };
    return { kind: 'conflict', paths: await this.computeConflictPaths() };
  }

  /** Paths the failed stash pop could not apply: unmerged ones + untracked ones not restored. */
  async computeConflictPaths(): Promise<string[]> {
    const ref = await this.pullStashRef();
    if (!ref) return [];
    const unmerged = (await this.git.out(['diff', '--name-only', '-z', '--diff-filter=U'])).split('\0').filter(Boolean);
    const untracked: string[] = [];
    if ((await this.git.run(['rev-parse', '-q', '--verify', `${ref}^3`], { allowFail: true })).code === 0) {
      const files = (await this.git.out(['ls-tree', '-r', '-z', '--name-only', `${ref}^3`])).split('\0').filter(Boolean);
      for (const f of files) {
        const mine = await this.git.show(`${ref}^3`, f);
        const cur = await readFile(join(this.dir, f)).catch(() => null);
        if (!cur || !mine || !cur.equals(mine)) untracked.push(f);
      }
    }
    return [...new Set([...unmerged, ...untracked])];
  }

  /** mine = the stash's version, theirs = HEAD's; null = deleted on that side. */
  async conflictSides(repoPath: string): Promise<{ mine: Buffer | null; theirs: Buffer | null }> {
    const ref = await this.pullStashRef();
    if (!ref) throw new Error('not in conflict');
    let mine = await this.git.show(ref, repoPath);
    if (mine === null) mine = await this.git.show(`${ref}^3`, repoPath);
    return { mine, theirs: await this.git.show('HEAD', repoPath) };
  }

  /** Resolves one conflicting path (repo-relative). */
  async resolve(repoPath: string, choice: ConflictChoice, now = new Date()): Promise<void> {
    const { mine, theirs } = await this.conflictSides(repoPath);
    const abs = join(this.dir, repoPath);
    const put = async (p: string, buf: Buffer | null) => {
      if (buf === null) await rm(p, { force: true });
      else {
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, buf);
      }
    };
    if (choice === 'mine') await put(abs, mine);
    else if (choice === 'theirs') await put(abs, theirs);
    else if (mine === null || theirs === null) await put(abs, mine ?? theirs);
    else {
      await put(abs, mine);
      if (!mine.equals(theirs)) await put(await this.freeConflictName(abs, now), theirs);
    }
  }

  private async freeConflictName(abs: string, now: Date): Promise<string> {
    const ext = posix.extname(abs);
    const base = abs.slice(0, abs.length - ext.length);
    const date = now.toISOString().slice(0, 10);
    for (let n = 1; ; n++) {
      const candidate = `${base}.conflict-${date}${n > 1 ? `-${n}` : ''}${ext}`;
      try {
        await access(candidate);
      } catch {
        return candidate;
      }
    }
  }

  /** Once every path is resolved: clear unmerged entries and drop the pull stash. */
  async finishConflict(): Promise<void> {
    await this.git.run(['reset', '-q']);
    const ref = await this.pullStashRef();
    if (ref) await this.git.run(['stash', 'drop', '-q', ref]);
  }

  /** Commits all uncommitted changes of the vault root. Returns the hash, or null if clean. */
  async commit(message: string, withAiTrailer: boolean): Promise<string | null> {
    await this.git.run(['add', '-A', ...this.pathspec]);
    const staged = (await this.git.run(['diff', '--cached', '--quiet'], { allowFail: true })).code !== 0;
    if (!staged) return null;
    const msg = withAiTrailer ? `${message.trim()}\n\n${AI_TRAILER}\n` : message;
    await this.git.run(['commit', '-q', '-F', '-'], { input: msg });
    return (await this.git.out(['rev-parse', 'HEAD'])).trim();
  }

  async push(): Promise<PushResult> {
    const r = await this.git.run(['push', '-q', 'origin', `HEAD:refs/heads/${this.branch}`], { allowFail: true });
    if (r.code !== 0) return { pushed: false, error: r.stderr.trim() };
    await this.git.run(['fetch', '-q', 'origin', this.branch], { allowFail: true });
    return { pushed: true };
  }

  async checkoutBranch(branch: string): Promise<void> {
    await this.git.run(['fetch', 'origin', branch]);
    await this.git.run(['checkout', '-q', '-B', branch, `origin/${branch}`]);
    await this.git.run(['branch', '-q', `--set-upstream-to=origin/${branch}`]);
  }
}

function kindOf(xy: string): ChangeKind {
  if (xy === '??') return 'untracked';
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('R')) return 'renamed';
  if (xy.includes('A')) return 'added';
  return 'modified';
}
