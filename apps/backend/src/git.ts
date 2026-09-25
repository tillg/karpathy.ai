import { execFile } from 'node:child_process';

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly code: number | null,
    readonly stderr: string,
    readonly stdout: string,
  ) {
    super(`git ${args[0]} failed: ${stderr.trim() || stdout.trim() || `exit ${code}`}`);
  }
}

export interface GitIdentity {
  name: string;
  email: string;
}

export interface GitOptions {
  /** GitHub token; sent as an http header via env, never written to .git/config. */
  token?: string;
  identity: GitIdentity;
}

/** Runs git in one working copy. Only the backend runs git (mvp §3.2). */
export class Git {
  constructor(
    readonly cwd: string,
    private readonly opts: GitOptions,
  ) {}

  run(args: string[], { input, allowFail = false }: { input?: string; allowFail?: boolean } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
    return runGit(this.cwd, args, this.opts, input).then((r) => {
      if (r.code !== 0 && !allowFail) throw new GitError(args, r.code, r.stderr, r.stdout);
      return r;
    });
  }

  async out(args: string[]): Promise<string> {
    return (await this.run(args)).stdout;
  }

  /** Content of `rev:path`, or null when it doesn't exist there. */
  async show(rev: string, path: string): Promise<Buffer | null> {
    const r = await runGit(this.cwd, ['show', `${rev}:${path}`], this.opts, undefined, true);
    return r.code === 0 ? r.buf : null;
  }
}

export function runGit(
  cwd: string,
  args: string[],
  opts: GitOptions,
  input?: string,
  binary = false,
): Promise<{ code: number; stdout: string; stderr: string; buf: Buffer }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: opts.identity.name,
    GIT_AUTHOR_EMAIL: opts.identity.email,
    GIT_COMMITTER_NAME: opts.identity.name,
    GIT_COMMITTER_EMAIL: opts.identity.email,
    // Vaults live on a shared volume written by opencode too (same UID, but be safe).
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'safe.directory',
    GIT_CONFIG_VALUE_0: '*',
  };
  if (opts.token) {
    const basic = Buffer.from(`x-access-token:${opts.token}`).toString('base64');
    env.GIT_CONFIG_COUNT = '2';
    env.GIT_CONFIG_KEY_1 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_1 = `AUTHORIZATION: basic ${basic}`;
  }
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      { cwd, env, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
        resolve({ code, stdout: binary ? '' : stdout.toString('utf8'), stderr: stderr.toString('utf8'), buf: stdout });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}
