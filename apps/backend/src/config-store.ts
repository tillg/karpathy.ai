import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Settings, VaultConfig } from '@karpathy/shared';

export interface StoredVault extends VaultConfig {
  /** True once the clone finished; a vault without it is (re)cloned on startup. */
  cloned: boolean;
  cloneError?: string;
}

export interface ConfigData {
  vaults: StoredVault[];
  settings: Settings;
  /** Per-vault AI-touched set (vault-relative paths), mvp §2.4. */
  aiTouched: Record<string, string[]>;
  /** Per-vault unresolved Conflict paths (repo-relative), kept while the pull stash exists. */
  conflicts: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  commitReminderThreshold: 4,
  model: 'anthropic/claude-sonnet-5',
};

/**
 * The backend-only config store: one JSON file on the config volume. Writes go to a temp
 * file first and are renamed into place, so a crash mid-write leaves the old file intact.
 */
export class ConfigStore {
  private data!: ConfigData;
  private writing: Promise<void> = Promise.resolve();

  private constructor(private readonly file: string) {}

  static async open(dir: string, defaults: Partial<Settings> = {}): Promise<ConfigStore> {
    const store = new ConfigStore(join(dir, 'config.json'));
    let raw: Partial<ConfigData> = {};
    try {
      raw = JSON.parse(await readFile(store.file, 'utf8')) as Partial<ConfigData>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    store.data = {
      vaults: raw.vaults ?? [],
      settings: { ...DEFAULT_SETTINGS, ...defaults, ...raw.settings },
      aiTouched: raw.aiTouched ?? {},
      conflicts: raw.conflicts ?? {},
    };
    return store;
  }

  get(): Readonly<ConfigData> {
    return this.data;
  }

  /** Applies `fn` to a copy of the data and persists it atomically. */
  async update(fn: (d: ConfigData) => void): Promise<void> {
    const next = structuredClone(this.data);
    fn(next);
    // Applied in memory right away so concurrent updates build on each other.
    this.data = next;
    const snapshot = JSON.stringify(next, null, 2);
    // Serialize writes; a failed one must not reject every later update.
    const write = this.writing.catch(() => undefined).then(() => this.write(snapshot));
    this.writing = write;
    await write;
  }

  private async write(json: string) {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, json);
    await rename(tmp, this.file);
  }
}
