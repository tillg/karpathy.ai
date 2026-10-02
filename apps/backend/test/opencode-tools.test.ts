import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startOpencode, testDir } from './opencode-container.js';

// The custom tools baked into the opencode image (deploy/opencode/tools), as the real container sees them.

let oc: Awaited<ReturnType<typeof startOpencode>>;
const vaultsDir = join(testDir('opencode-tools'), 'vaults');

beforeAll(async () => {
  oc = await startOpencode(vaultsDir);
}, 300_000);
afterAll(() => oc?.stop());

describe('opencode custom tools', () => {
  it('opencode lists open_note as a tool', async () => {
    const r = await fetch(`${oc.url}/experimental/tool/ids?directory=/vaults`);
    expect(r.status).toBe(200);
    expect(await r.json()).toContain('open_note');
  });

  it('open_note is allowed for vault and vault-readonly, hidden for commit-message', async () => {
    const cfg = JSON.parse(await readFile(join(import.meta.dirname, '../../../deploy/opencode/opencode.json'), 'utf8'));
    expect(cfg.agent.vault.permission.open_note).toBe('allow');
    expect(cfg.agent['vault-readonly'].permission.open_note).toBe('allow');
    expect(cfg.agent['commit-message'].permission).toEqual({ '*': 'deny' });
  });
});
