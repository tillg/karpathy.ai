import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Real opencode container for integration tests (no mocks). The vaults dir must be under the
// repo (Rancher Desktop shares /Users) and is mounted at /vaults, as in compose.
export const IMAGE = 'ghcr.io/anomalyco/opencode:1.18.25';
const NET = 'kai-test-net';
const OLLAMA = 'kai-test-ollama';
/** Volume that holds the Ollama models (qwen2.5:3b pulled once). */
const OLLAMA_VOLUME = process.env.OLLAMA_VOLUME ?? 'kai-spike-ollama';
export const LLM_MODEL = process.env.LLM_TEST_MODEL ?? 'ollama/qwen2.5:3b';
/** Declared to opencode but not pulled in Ollama: every turn fails fast with a non-retryable 404. */
export const DEAD_MODEL = 'ollama/kai-no-such-model';
const CONFIG = resolve(import.meta.dirname, '../../../deploy/opencode/opencode.json');
export const TEST_ROOT = resolve(import.meta.dirname, '../../../tmp/test-run');

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function ensureNetwork() {
  try {
    docker('network', 'inspect', NET);
  } catch {
    docker('network', 'create', NET);
  }
}

/** Starts (or reuses) the Ollama container on the test network. */
export function ensureOllama() {
  ensureNetwork();
  try {
    if (docker('inspect', '-f', '{{.State.Running}}', OLLAMA) === 'true') return;
    docker('rm', '-f', OLLAMA);
  } catch {
    // not there
  }
  docker('run', '-d', '--name', OLLAMA, '--network', NET, '-v', `${OLLAMA_VOLUME}:/root/.ollama`, 'ollama/ollama');
}

/**
 * Starts opencode serving `vaultsDir` at /vaults, with Ollama as provider. Use DEAD_MODEL for
 * turns that fail fast and deterministically (no LLM runs), LLM_MODEL for real ones.
 */
export async function startOpencode(vaultsDir: string) {
  ensureOllama();
  await mkdir(vaultsDir, { recursive: true });
  const name = `kai-test-oc-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
  const models = Object.fromEntries(
    [LLM_MODEL, DEAD_MODEL].map((m) => m.split('/').slice(1).join('/')).map((id) => [id, { name: id, tool_call: true }]),
  );
  const providerCfg = { provider: { ollama: { npm: '@ai-sdk/openai-compatible', name: 'Ollama', options: { baseURL: `http://${OLLAMA}:11434/v1` }, models } } };
  docker(
    'run', '-d', '--name', name, '--network', NET, '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '-p', '127.0.0.1::4096',
    '-e', 'HOME=/home/app', '-e', 'XDG_DATA_HOME=/data', '-e', `OPENCODE_MODEL=${LLM_MODEL}`,
    '-e', `OPENCODE_CONFIG_CONTENT=${JSON.stringify(providerCfg)}`,
    '--tmpfs', `/home/app:uid=${process.getuid?.() ?? 1000},gid=${process.getgid?.() ?? 1000},mode=0700`,
    '--tmpfs', `/data:uid=${process.getuid?.() ?? 1000},gid=${process.getgid?.() ?? 1000}`,
    '-v', `${CONFIG}:/etc/opencode/opencode.json:ro`,
    '-v', `${vaultsDir}:/vaults`,
    IMAGE, 'serve', '--hostname', '0.0.0.0', '--port', '4096',
  );
  const port = docker('port', name, '4096/tcp').split('\n')[0]!.split(':').pop();
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`${url}/global/health`);
      if (r.ok) break;
    } catch {
      // starting
    }
    if (Date.now() > deadline) throw new Error(`opencode did not start: ${docker('logs', name)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  return {
    url,
    name,
    stop: () => void docker('rm', '-f', name),
    pause: () => void docker('stop', name),
    resume: () => void docker('start', name),
  };
}

export function testDir(label: string) {
  return join(TEST_ROOT, `${label}-${process.pid}-${Date.now()}`);
}
