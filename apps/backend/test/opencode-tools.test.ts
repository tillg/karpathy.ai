import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpencodeHarness } from '../src/harness/opencode.js';
import { DEAD_MODEL, LLM_MODEL, startOpencode, testDir } from './opencode-container.js';

// The custom tools baked into the opencode image (deploy/opencode/tools), as the real container sees them.

let oc: Awaited<ReturnType<typeof startOpencode>>;
const vaultsDir = join(testDir('opencode-tools'), 'vaults');

beforeAll(async () => {
  oc = await startOpencode(vaultsDir);
}, 300_000);
afterAll(() => oc?.stop());

describe('opencode server password', () => {
  it('opencode refuses requests without the password', async () => {
    expect((await fetch(`${oc.url}/global/health`)).status).toBe(401);
    expect((await oc.fetch(`${oc.url}/global/health`)).status).toBe(200);
  });
});

describe('opencode custom tools', () => {
  it('opencode lists open_note as a tool', async () => {
    const r = await oc.fetch(`${oc.url}/experimental/tool/ids?directory=/vaults`);
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

describe('opencode web tools', () => {
  it('websearch is offered to the model', async () => {
    const [provider, ...model] = LLM_MODEL.split('/');
    const r = await oc.fetch(`${oc.url}/experimental/tool?directory=/vaults&provider=${provider}&model=${model.join('/')}`);
    expect(r.status).toBe(200);
    const tools = (await r.json()) as { id: string }[];
    expect(tools.map((t) => t.id)).toContain('websearch');
  });

  it('the managed config stays fail-closed: web tools denied, commit-message has no tools', async () => {
    const cfg = JSON.parse(await readFile(join(import.meta.dirname, '../../../deploy/opencode/opencode.json'), 'utf8'));
    expect(cfg.permission.websearch).toBe('deny');
    expect(cfg.permission.webfetch).toBe('deny');
    expect(cfg.agent['commit-message'].permission).toEqual({ '*': 'deny' });
  });
});

describe('per-turn tools map', () => {
  it('prompt tools map becomes session permission', async () => {
    const harness = new OpencodeHarness(oc.url, oc.password);
    const dir = '/vaults';
    const id = await harness.createSession(dir);
    const rules = async () => ((await (await oc.fetch(`${oc.url}/session/${id}?directory=${dir}`)).json()) as { permission?: { permission: string; pattern: string; action: string }[] }).permission ?? [];
    // promptAsync returns before the session is updated: poll until the rules show up.
    const permission = async (want: string) => {
      for (let i = 0; i < 30; i++) {
        const r = await rules();
        if (r.some((x) => x.permission === 'websearch' && x.action === want)) return r;
        await new Promise((res) => setTimeout(res, 200));
      }
      return rules();
    };
    const settle = () => new Promise((r) => setTimeout(r, 1500)); // the dead model's turn fails fast
    await harness.prompt(dir, id, { text: 'hi', agent: 'vault-readonly', model: DEAD_MODEL, tools: { websearch: true, webfetch: true } });
    expect(await permission('allow')).toEqual(expect.arrayContaining([
      { permission: 'websearch', pattern: '*', action: 'allow' },
      { permission: 'webfetch', pattern: '*', action: 'allow' },
    ]));
    await settle();
    await harness.prompt(dir, id, { text: 'hi', agent: 'vault-readonly', model: DEAD_MODEL, tools: { websearch: false, webfetch: false } });
    expect(await permission('deny')).toEqual(expect.arrayContaining([
      { permission: 'websearch', pattern: '*', action: 'deny' },
      { permission: 'webfetch', pattern: '*', action: 'deny' },
    ]));
  });
});

describe('known-url plugin', () => {
  it('known-url plugin is loaded', async () => {
    // The plugin logs once when opencode loads it.
    const logs = await waitForLog(oc.name, /known-url ready/);
    expect(logs).toMatch(/known-url ready/);
  });

  it('web caps come from env', async () => {
    const capped = await startOpencode(join(testDir('opencode-caps'), 'vaults'), { WEB_FETCH_CAP: '1' });
    try {
      // Plugins load with the first instance (directory) a request touches.
      await capped.fetch(`${capped.url}/experimental/tool/ids?directory=/vaults`);
      expect(await waitForLog(capped.name, /known-url ready/)).toContain('fetch cap 1, search cap 20');
      expect(await waitForLog(oc.name, /known-url ready/)).toContain('fetch cap 20, search cap 20');
    } finally {
      capped.stop();
    }
  }, 120_000);
});

async function waitForLog(container: string, re: RegExp, ms = 15_000) {
  const end = Date.now() + ms;
  let logs = '';
  while (Date.now() < end) {
    const r = spawnSync('docker', ['logs', container], { encoding: 'utf8' });
    logs = `${r.stdout}${r.stderr}`;
    if (re.test(logs)) break;
    await new Promise((res) => setTimeout(res, 300));
  }
  return logs;
}
