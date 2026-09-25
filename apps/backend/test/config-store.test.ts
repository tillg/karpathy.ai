import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore } from '../src/config-store.js';

const dir = () => mkdtemp(join(tmpdir(), 'cfg-'));

describe('ConfigStore', () => {
  it('starts with default settings (threshold 4, Claude Sonnet 5)', async () => {
    const s = await ConfigStore.open(await dir());
    expect(s.get().settings).toEqual({ commitReminderThreshold: 4, model: 'anthropic/claude-sonnet-5' });
    expect(s.get().vaults).toEqual([]);
  });

  it('persists vault CRUD across reopen', async () => {
    const d = await dir();
    const s = await ConfigStore.open(d);
    await s.update((c) => c.vaults.push({ id: 'v1', name: 'V', repo: 'o/r', branch: 'main', root: '', cloned: false }));
    await s.update((c) => { c.vaults[0]!.name = 'Renamed'; });
    let r = await ConfigStore.open(d);
    expect(r.get().vaults.map((v) => v.name)).toEqual(['Renamed']);
    await r.update((c) => { c.vaults = []; });
    r = await ConfigStore.open(d);
    expect(r.get().vaults).toEqual([]);
  });

  it('a leftover temp file from a killed write does not corrupt the store', async () => {
    const d = await dir();
    const s = await ConfigStore.open(d);
    await s.update((c) => { c.settings.commitReminderThreshold = 7; });
    // Simulate a crash mid-write: a half-written temp file next to the real one.
    await writeFile(join(d, 'config.json.999.tmp'), '{"vaults": [');
    const r = await ConfigStore.open(d);
    expect(r.get().settings.commitReminderThreshold).toBe(7);
    expect(JSON.parse(await readFile(join(d, 'config.json'), 'utf8')).settings.commitReminderThreshold).toBe(7);
  });

  it('env defaults apply below stored settings', async () => {
    const d = await dir();
    const s = await ConfigStore.open(d, { model: 'openai/gpt-5-mini' });
    expect(s.get().settings.model).toBe('openai/gpt-5-mini');
    await s.update((c) => { c.settings.model = 'x/y'; });
    expect((await ConfigStore.open(d, { model: 'openai/gpt-5-mini' })).get().settings.model).toBe('x/y');
  });

  it('one failed write does not poison later updates', async () => {
    const { chmod } = await import('node:fs/promises');
    const d = await dir();
    const s = await ConfigStore.open(d);
    await s.update((c) => { c.settings.commitReminderThreshold = 5; });
    await chmod(d, 0o500); // temp file can't be created
    await expect(s.update((c) => { c.settings.commitReminderThreshold = 6; })).rejects.toThrow();
    await chmod(d, 0o700);
    await s.update((c) => { c.settings.commitReminderThreshold = 7; });
    expect((await ConfigStore.open(d)).get().settings.commitReminderThreshold).toBe(7);
  });
});
