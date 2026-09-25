import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
  Change,
  CommitResult,
  ConflictChoice,
  FileContent,
  FileEntry,
  SearchHit,
  Vault,
  VaultConfig,
  VaultEvent,
  VaultState,
  VaultStatus,
} from '@karpathy/shared';
import type { ConfigStore, StoredVault } from './config-store.js';
import { listTree, search, versionOf, versionOfFile } from './files.js';
import type { GitIdentity } from './git.js';
import { VaultLock } from './lock.js';
import { normalizeRel, resolveInVault } from './paths.js';
import { Repo } from './repo.js';
import { VaultWatcher } from './watcher.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface VaultsEnv {
  vaultsDir: string;
  /** Clone URL = `${remoteBase}${owner/name}.git`; `https://github.com/` in prod, `file://…` in tests. */
  remoteBase: string;
  githubToken?: string;
  identity: GitIdentity;
}

interface Runtime {
  lock: VaultLock;
  state: Exclude<VaultState, 'conflict'>;
  conflict: boolean;
  watcher?: VaultWatcher;
  listeners: Set<(e: VaultEvent) => void>;
  statusTimer?: NodeJS.Timeout;
  cloning?: Promise<void>;
  pullError?: string;
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** The vaults the app manages: admin, files, git, status events (mvp §2.3, §2.4, §3.2). */
export class Vaults {
  private rt = new Map<string, Runtime>();
  /** Called when a vault's clone becomes ready (the chat service opens its subscription). */
  onReady?: (id: string) => void;

  constructor(
    private readonly store: ConfigStore,
    private readonly env: VaultsEnv,
  ) {}

  /** Loads configured vaults; re-clones any whose clone never finished. */
  async init(): Promise<void> {
    for (const v of this.store.get().vaults) {
      const r = this.runtime(v.id);
      if (v.cloned) {
        r.state = 'ready';
        r.conflict = await this.repo(v).inConflict().catch(() => false);
        this.startWatcher(v);
      } else if (v.cloneError) r.state = 'clone-failed';
      else this.startClone(v);
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.rt.values()].map((r) => r.watcher?.close()));
  }

  // ---- admin ----

  list(): Vault[] {
    return this.store.get().vaults.map((v) => this.toVault(v));
  }

  getVault(id: string): Vault {
    return this.toVault(this.config(id));
  }

  async add(input: { name: string; repo: string; branch?: string; root?: string }): Promise<Vault> {
    if (!REPO_RE.test(input.repo)) throw new HttpError(400, 'repo must be owner/name');
    const root = input.root ? normalizeRel(input.root) : '';
    const branch = input.branch || 'main';
    this.refuseDuplicate(input.repo, branch, root);
    const id = this.freeId(input.name || input.repo.split('/')[1]!);
    const v: StoredVault = { id, name: input.name || input.repo, repo: input.repo, branch, root, cloned: false };
    await this.store.update((c) => c.vaults.push(v));
    this.startClone(v);
    return this.toVault(v);
  }

  async patch(id: string, input: Partial<Pick<VaultConfig, 'name' | 'repo' | 'branch' | 'root'>>): Promise<Vault> {
    const v = this.config(id);
    const r = this.runtime(id);
    const next = { ...v };
    if (input.name !== undefined) next.name = input.name;
    const repoChange = input.repo !== undefined && input.repo !== v.repo;
    const branchChange = input.branch !== undefined && input.branch !== v.branch;
    const newRoot = input.root !== undefined ? (input.root ? normalizeRel(input.root) : '') : v.root;
    const rootChange = newRoot !== v.root;
    if (repoChange && !REPO_RE.test(input.repo!)) throw new HttpError(400, 'repo must be owner/name');
    if (repoChange || branchChange || rootChange) this.refuseDuplicate(input.repo ?? v.repo, input.branch ?? v.branch, newRoot, id);
    // A failed clone is retried with the new settings (#9): nothing local to lose.
    if (r.state === 'clone-failed' && (repoChange || branchChange || rootChange)) {
      next.repo = input.repo ?? v.repo;
      next.branch = input.branch ?? v.branch;
      next.root = newRoot;
      next.cloned = false;
      delete next.cloneError;
      await this.store.update((c) => {
        c.vaults = c.vaults.map((x) => (x.id === id ? next : x));
      });
      this.startClone(next);
      return this.toVault(next);
    }
    if (repoChange || branchChange || rootChange) {
      if (r.state === 'cloning') throw new HttpError(409, 'vault is still cloning');
      await r.lock.withExclusive(async () => {
        if (r.state === 'ready') {
          const repo = this.repo(v);
          if ((await repo.changes()).length > 0 || (await repo.unpushedCount()) > 0 || r.conflict)
            throw new HttpError(409, 'commit or discard uncommitted changes first', 'dirty');
        }
        if (repoChange) {
          next.repo = input.repo!;
          next.cloned = false;
          delete next.cloneError;
        }
        if (branchChange) next.branch = input.branch!;
        next.root = newRoot;
        if (!repoChange && r.state === 'ready') {
          const repo = this.repo(v);
          // Check the new root against the target branch before switching anything.
          if (branchChange) await repo.git.run(['fetch', 'origin', next.branch]);
          const ref = branchChange ? `origin/${next.branch}` : 'HEAD';
          if (newRoot && (await repo.git.run(['cat-file', '-t', `${ref}:${newRoot}`], { allowFail: true })).stdout.trim() !== 'tree')
            throw new HttpError(400, `folder ${newRoot} does not exist in the repo`);
          if (branchChange) await repo.checkoutBranch(next.branch);
        }
      });
      await this.store.update((c) => {
        c.vaults = c.vaults.map((x) => (x.id === id ? next : x));
        delete c.aiTouched[id];
      });
      if (repoChange || (branchChange && r.state !== 'ready')) {
        await r.watcher?.close();
        r.watcher = undefined;
        this.startClone(next);
      } else if (rootChange) {
        await r.watcher?.close();
        this.startWatcher(next);
      }
    } else {
      await this.store.update((c) => {
        c.vaults = c.vaults.map((x) => (x.id === id ? next : x));
      });
    }
    this.emitStatusSoon(id);
    return this.toVault(next);
  }

  async remove(id: string): Promise<void> {
    const v = this.config(id);
    const r = this.runtime(id);
    await r.cloning?.catch(() => undefined);
    await r.lock.withExclusive(async () => {
      if (r.state === 'ready') {
        const repo = this.repo(v);
        if ((await repo.changes()).length > 0 || r.conflict) throw new HttpError(409, 'commit or discard uncommitted changes first', 'dirty');
        if ((await repo.unpushedCount()) > 0) throw new HttpError(409, 'push unpushed commits first', 'unpushed');
      }
      await r.watcher?.close();
      await rm(this.cloneDir(id), { recursive: true, force: true });
      await this.store.update((c) => {
        c.vaults = c.vaults.filter((x) => x.id !== id);
        delete c.aiTouched[id];
        delete c.conflicts[id];
      });
    });
    this.rt.delete(id);
  }

  // ---- status / events ----

  lock(id: string): VaultLock {
    this.config(id);
    return this.runtime(id).lock;
  }

  isConflict(id: string): boolean {
    return this.runtime(id).conflict;
  }

  vaultRootDir(id: string): string {
    const v = this.config(id);
    return join(this.cloneDir(id), v.root);
  }

  async status(id: string): Promise<VaultStatus> {
    const v = this.config(id);
    const r = this.runtime(id);
    const base: VaultStatus = { state: this.stateOf(v), changedCount: 0, unpushedCount: 0, busy: r.lock.busy, conflictPaths: [], ...(r.pullError ? { pullError: r.pullError } : {}) };
    if (r.state !== 'ready') return base;
    const repo = this.repo(v);
    const [changes, unpushed] = await Promise.all([repo.changes(), repo.unpushedCount()]);
    base.changedCount = changes.length;
    base.unpushedCount = unpushed;
    if (r.conflict)
      base.conflictPaths = (this.store.get().conflicts[id] ?? []).map((p) => repo.toVaultPath(p) ?? p);
    return base;
  }

  subscribe(id: string, fn: (e: VaultEvent) => void): () => void {
    const r = this.runtime(id);
    r.listeners.add(fn);
    return () => r.listeners.delete(fn);
  }

  private emit(id: string, e: VaultEvent) {
    for (const fn of this.rt.get(id)?.listeners ?? []) fn(e);
  }

  /** Coalesces status recomputation (lock changes, file events, git ops). */
  emitStatusSoon(id: string) {
    const r = this.rt.get(id);
    if (!r || r.statusTimer) return;
    r.statusTimer = setTimeout(() => {
      r.statusTimer = undefined;
      if (!this.rt.has(id) || r.listeners.size === 0) return;
      this.status(id).then(
        (status) => this.emit(id, { type: 'status', status }),
        () => undefined,
      );
    }, 50);
  }

  // ---- files ----

  async listFiles(id: string): Promise<FileEntry[]> {
    this.requireReady(id);
    return listTree(this.vaultRootDir(id));
  }

  async readFile(id: string, path: string): Promise<FileContent> {
    this.requireReady(id);
    const abs = await resolveInVault(this.vaultRootDir(id), path);
    let buf: Buffer;
    try {
      buf = await readFile(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, `not found: ${path}`);
      if ((e as NodeJS.ErrnoException).code === 'EISDIR') throw new HttpError(400, `is a directory: ${path}`);
      throw e;
    }
    return { path: normalizeRel(path), content: buf.toString('utf8'), version: versionOf(buf) };
  }

  /** Writes a file if `version` still matches (null = must not exist yet). 409 stale, 423 in Conflict. */
  async writeFile(id: string, path: string, content: string, version: string | null, force = false): Promise<{ version: string }> {
    this.requireReady(id);
    const r = this.runtime(id);
    return r.lock.withShared('save', async () => {
      if (r.conflict) throw new HttpError(423, 'vault is in conflict; resolve it first', 'conflict');
      const abs = await resolveInVault(this.vaultRootDir(id), path);
      // Before the version check: on a case-insensitive disk the twin would look like "the same file".
      if (version === null) await this.refuseCaseTwin(id, path);
      const current = await versionOfFile(abs);
      if (!force && current !== version)
        throw new HttpError(409, 'file changed since it was loaded', 'stale', { currentVersion: current });
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
      this.emitStatusSoon(id);
      return { version: versionOf(content) };
    });
  }

  /**
   * A new path must not differ only in case from an existing file or folder: the vault's
   * clones on macOS/Windows (Obsidian) can't hold both.
   */
  private async refuseCaseTwin(id: string, path: string) {
    let dir = this.vaultRootDir(id);
    for (const seg of normalizeRel(path).split('/')) {
      const names = await readdir(dir).catch(() => [] as string[]);
      if (names.includes(seg)) {
        dir = join(dir, seg);
        continue;
      }
      const twin = names.find((n) => n.toLowerCase() === seg.toLowerCase());
      if (twin) throw new HttpError(409, `"${twin}" already exists (names differ only in upper/lower case)`, 'exists-case', { existing: twin });
      return;
    }
  }

  async deleteFile(id: string, path: string, version: string): Promise<void> {
    this.requireReady(id);
    const r = this.runtime(id);
    await r.lock.withShared('save', async () => {
      if (r.conflict) throw new HttpError(423, 'vault is in conflict; resolve it first', 'conflict');
      const abs = await resolveInVault(this.vaultRootDir(id), path);
      const current = await versionOfFile(abs);
      if (current === null) throw new HttpError(404, `not found: ${path}`);
      if (current !== version) throw new HttpError(409, 'file changed since it was loaded', 'stale', { currentVersion: current });
      await rm(abs);
      this.emitStatusSoon(id);
    });
  }

  async search(id: string, q: string): Promise<{ hits: SearchHit[]; truncated: boolean }> {
    this.requireReady(id);
    if (!q.trim()) return { hits: [], truncated: false };
    return search(this.vaultRootDir(id), q);
  }

  // ---- git ----

  async changes(id: string): Promise<Change[]> {
    this.requireReady(id);
    return this.repo(this.config(id)).changes();
  }

  async diff(id: string, path: string): Promise<string> {
    this.requireReady(id);
    return this.repo(this.config(id)).diff(normalizeRel(path));
  }

  async fullDiff(id: string) {
    this.requireReady(id);
    return this.repo(this.config(id)).fullDiff();
  }

  /** The pull on vault open: skipped when the lock isn't immediately free. */
  async open(id: string): Promise<VaultStatus> {
    const r = this.runtime(id);
    this.config(id);
    if (r.state === 'ready' && !r.conflict) {
      const release = r.lock.tryExclusive();
      if (release) {
        try {
          await this.pullUnlocked(id);
        } finally {
          release();
        }
      }
    }
    return this.status(id);
  }

  /** Pull under a lock the caller already holds exclusively. Records a Conflict if one arises. */
  async pullUnlocked(id: string) {
    const r = this.runtime(id);
    if (r.state !== 'ready' || r.conflict) return null;
    const result = await this.repo(this.config(id)).pull();
    r.pullError = result.kind === 'offline' ? redact(result.error, this.env.githubToken) : undefined;
    if (result.kind === 'conflict') {
      await this.store.update((c) => {
        c.conflicts[id] = result.paths;
      });
      r.conflict = true;
    }
    this.emitStatusSoon(id);
    return result;
  }

  async commit(id: string, message: string): Promise<CommitResult> {
    this.requireReady(id);
    const r = this.runtime(id);
    if (!message.trim()) throw new HttpError(400, 'commit message is required');
    return r.lock.withExclusive(async () => {
      if (r.conflict) throw new HttpError(423, 'vault is in conflict; resolve it first', 'conflict');
      const pull = await this.pullUnlocked(id);
      if (pull?.kind === 'conflict') throw new HttpError(409, 'pull ran into a conflict; resolve it, then commit', 'conflict');
      const repo = this.repo(this.config(id));
      const changed = new Set((await repo.changes()).map((c) => c.path));
      const touched = this.store.get().aiTouched[id] ?? [];
      const withAi = touched.some((p) => changed.has(p));
      const commit = await repo.commit(message, withAi);
      if (commit) await this.store.update((c) => { delete c.aiTouched[id]; });
      const unpushed = await repo.unpushedCount();
      const push = unpushed > 0 ? await repo.push() : { pushed: false };
      this.emitStatusSoon(id);
      return { commit, pushed: push.pushed, ...(push.error ? { pushError: push.error } : {}) };
    });
  }

  async push(id: string): Promise<CommitResult> {
    this.requireReady(id);
    const r = this.runtime(id);
    return r.lock.withExclusive(async () => {
      const pull = await this.pullUnlocked(id);
      this.emitStatusSoon(id);
      if (pull?.kind === 'offline') return { commit: null, pushed: false, pushError: pull.error };
      if (pull?.kind === 'conflict') throw new HttpError(409, 'pull ran into a conflict', 'conflict');
      return { commit: null, pushed: pull?.kind === 'ok' && pull.pushed, ...(pull?.kind === 'ok' && pull.pushError ? { pushError: pull.pushError } : {}) };
    });
  }

  async discard(id: string, path: string): Promise<void> {
    this.requireReady(id);
    const r = this.runtime(id);
    const rel = normalizeRel(path);
    await r.lock.withExclusive(async () => {
      if (r.conflict) throw new HttpError(423, 'vault is in conflict; resolve it first', 'conflict');
      await this.repo(this.config(id)).discard(rel);
      await this.store.update((c) => {
        const set = c.aiTouched[id];
        if (set) c.aiTouched[id] = set.filter((p) => p !== rel);
      });
    });
    this.emitStatusSoon(id);
  }

  async resolveConflict(id: string, path: string, choice: ConflictChoice): Promise<VaultStatus> {
    this.requireReady(id);
    const r = this.runtime(id);
    const repo = this.repo(this.config(id));
    const repoPath = repo.toRepoPath(normalizeRel(path));
    await r.lock.withExclusive(async () => {
      if (!r.conflict) throw new HttpError(409, 'vault is not in conflict');
      const open = this.store.get().conflicts[id] ?? (await repo.computeConflictPaths());
      if (!open.includes(repoPath)) throw new HttpError(400, `not a conflicting path: ${path}`);
      await repo.resolve(repoPath, choice);
      const rest = open.filter((p) => p !== repoPath);
      if (rest.length === 0) {
        await repo.finishConflict();
        r.conflict = false;
      }
      await this.store.update((c) => {
        if (rest.length) c.conflicts[id] = rest;
        else delete c.conflicts[id];
      });
    });
    this.emitStatusSoon(id);
    return this.status(id);
  }

  /** Mine/theirs contents of one conflicting path, for the resolution UI. */
  async conflictSides(id: string, path: string): Promise<{ mine: string | null; theirs: string | null }> {
    this.requireReady(id);
    const repo = this.repo(this.config(id));
    const s = await repo.conflictSides(repo.toRepoPath(normalizeRel(path)));
    return { mine: s.mine?.toString('utf8') ?? null, theirs: s.theirs?.toString('utf8') ?? null };
  }

  /** Records vault-relative paths the AI changed (mvp §2.4 AI-touched set). */
  async markAiTouched(id: string, paths: string[]): Promise<void> {
    if (!this.store.get().vaults.some((v) => v.id === id)) return;
    const cur = new Set(this.store.get().aiTouched[id] ?? []);
    const before = cur.size;
    // Absolute = outside the vault root; it can never be committed from here.
    for (const p of paths) if (!p.startsWith('/')) cur.add(p);
    if (cur.size !== before) await this.store.update((c) => { c.aiTouched[id] = [...cur]; });
  }

  aiTouched(id: string): string[] {
    return this.store.get().aiTouched[id] ?? [];
  }

  // ---- internals ----

  private config(id: string): StoredVault {
    const v = this.store.get().vaults.find((x) => x.id === id);
    if (!v) throw new HttpError(404, `no such vault: ${id}`);
    return v;
  }

  private runtime(id: string): Runtime {
    let r = this.rt.get(id);
    if (!r) {
      const lock = new VaultLock();
      r = { lock, state: 'cloning', conflict: false, listeners: new Set() };
      lock.onChange(() => this.emitStatusSoon(id));
      this.rt.set(id, r);
    }
    return r;
  }

  private requireReady(id: string) {
    const v = this.config(id);
    const r = this.runtime(id);
    if (r.state !== 'ready') throw new HttpError(409, `vault is ${this.stateOf(v)}`, 'not-ready');
  }

  private stateOf(v: StoredVault): VaultState {
    const r = this.runtime(v.id);
    return r.state === 'ready' && r.conflict ? 'conflict' : r.state;
  }

  private toVault(v: StoredVault): Vault {
    const { cloned: _c, cloneError, ...cfg } = v;
    return { ...cfg, state: this.stateOf(v), ...(cloneError ? { error: cloneError } : {}) };
  }

  private cloneDir(id: string) {
    return join(resolve(this.env.vaultsDir), id);
  }

  private repo(v: StoredVault): Repo {
    return new Repo(this.cloneDir(v.id), v.branch, v.root, { identity: this.env.identity, token: this.env.githubToken });
  }

  private refuseDuplicate(repo: string, branch: string, root: string, exceptId?: string) {
    const dup = this.store.get().vaults.find((x) => x.id !== exceptId && x.repo === repo && x.branch === branch && x.root === root);
    if (dup) throw new HttpError(409, `"${dup.name}" already uses ${repo} (${branch}${root ? `, ${root}` : ''})`, 'duplicate');
  }

  private freeId(name: string): string {
    const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vault';
    const ids = new Set(this.store.get().vaults.map((v) => v.id));
    let id = slug;
    for (let n = 2; ids.has(id); n++) id = `${slug}-${n}`;
    return id;
  }

  private startClone(v: StoredVault) {
    const r = this.runtime(v.id);
    r.state = 'cloning';
    r.conflict = false;
    this.emitStatusSoon(v.id);
    r.cloning = r.lock.withExclusive(async () => {
      try {
        await Repo.clone(`${this.env.remoteBase}${v.repo}.git`, this.cloneDir(v.id), v.branch, { identity: this.env.identity, token: this.env.githubToken });
        if (v.root) {
          const st = await stat(join(this.cloneDir(v.id), v.root)).catch(() => null);
          if (!st?.isDirectory()) throw new Error(`folder ${v.root} does not exist in the repo`);
        }
        await this.store.update((c) => {
          const x = c.vaults.find((y) => y.id === v.id);
          if (x) {
            x.cloned = true;
            delete x.cloneError;
          }
        });
        r.state = 'ready';
        this.startWatcher(v);
        this.onReady?.(v.id);
      } catch (e) {
        const msg = redact((e as Error).message, this.env.githubToken);
        await this.store.update((c) => {
          const x = c.vaults.find((y) => y.id === v.id);
          if (x) x.cloneError = msg;
        });
        r.state = 'clone-failed';
      }
      this.emitStatusSoon(v.id);
    });
  }

  /** Waits for a running clone (tests, startup). */
  async whenCloned(id: string): Promise<void> {
    await this.runtime(id).cloning;
  }

  private startWatcher(v: StoredVault) {
    const r = this.runtime(v.id);
    const root = join(this.cloneDir(v.id), v.root);
    r.watcher = new VaultWatcher(root, async (paths) => {
      const files = await Promise.all(
        paths.map(async (path) => ({ path, version: await versionOfFile(join(root, path)) })),
      );
      this.emit(v.id, { type: 'files-changed', files });
      this.emitStatusSoon(v.id);
    });
  }
}

function redact(msg: string, token?: string) {
  return token ? msg.replaceAll(token, '***') : msg;
}
