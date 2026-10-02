import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

// Real opencode container for integration tests (no mocks). The vaults dir must be under the
// repo (Rancher Desktop shares /Users) and is mounted at /vaults, as in compose.
/** The image built from deploy/opencode/Dockerfile, so tests load the same config and tools as prod. */
export const IMAGE = 'kai-test-opencode';
const REPO = resolve(import.meta.dirname, '../../..');
const NET = 'kai-test-net';
const OLLAMA = 'kai-test-ollama';
/** Volume that holds the Ollama models (qwen2.5:3b pulled once). */
const OLLAMA_VOLUME = process.env.OLLAMA_VOLUME ?? 'kai-spike-ollama';
export const LLM_MODEL = process.env.LLM_TEST_MODEL ?? 'ollama/qwen2.5:3b';
/** Declared to opencode but not pulled in Ollama: every turn fails fast with a non-retryable 404. */
export const DEAD_MODEL = 'ollama/kai-no-such-model';
/** A second declared-but-not-pulled model, to observe a model switch without an LLM. */
export const DEAD_MODEL_2 = 'ollama/kai-no-such-model-2';
export const TEST_ROOT = resolve(REPO, 'tmp/test-run');

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function ensureNetwork() {
  try {
    docker('network', 'inspect', NET);
  } catch {
    // Test files run in parallel workers: another one may create it between our inspect and create.
    try {
      docker('network', 'create', NET);
    } catch (e) {
      if (!String((e as { stderr?: string }).stderr).includes('already exists')) throw e;
    }
  }
}

let built = false;
/** Builds the opencode image once per test process (layer-cached, so a no-op when nothing changed). */
function ensureImage() {
  if (built) return;
  docker('build', '-q', '-t', IMAGE, '-f', join(REPO, 'deploy/opencode/Dockerfile'), REPO);
  built = true;
}

/** Starts (or reuses) the Ollama container on the test network. */
export function ensureOllama() {
  ensureNetwork();
  try {
    // "created": another parallel worker is starting it right now — don't remove it under that worker.
    if (['running', 'created'].includes(docker('inspect', '-f', '{{.State.Status}}', OLLAMA))) return;
    docker('rm', '-f', OLLAMA);
  } catch {
    // not there
  }
  try {
    // A context large enough for opencode's system prompt + the vault's AGENTS.md (#57).
    docker('run', '-d', '--name', OLLAMA, '--network', NET, '-e', 'OLLAMA_CONTEXT_LENGTH=16384', '-v', `${OLLAMA_VOLUME}:/root/.ollama`, 'ollama/ollama');
  } catch (e) {
    // Another parallel worker won the race to start it.
    if (!String((e as { stderr?: string }).stderr).includes('is already in use')) throw e;
  }
}

/**
 * Starts opencode serving `vaultsDir` at /vaults, with Ollama as provider. Use DEAD_MODEL for
 * turns that fail fast and deterministically (no LLM runs), LLM_MODEL for real ones.
 */
export async function startOpencode(vaultsDir: string) {
  ensureImage();
  ensureOllama();
  await mkdir(vaultsDir, { recursive: true });
  const name = `kai-test-oc-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
  // A fixed host port, so a stop/start (restart tests) keeps the URL.
  const hostPort = await new Promise<number>((resolve) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const p = (srv.address() as { port: number }).port;
      srv.close(() => resolve(p));
    });
  });
  const models = Object.fromEntries(
    [LLM_MODEL, DEAD_MODEL, DEAD_MODEL_2].map((m) => m.split('/').slice(1).join('/')).map((id) => [id, { name: id, tool_call: true, limit: { context: 16384, output: 4096 } }]),
  );
  const providerCfg = { provider: { ollama: { npm: '@ai-sdk/openai-compatible', name: 'Ollama', options: { baseURL: `http://${OLLAMA}:11434/v1` }, models } } };
  docker(
    'run', '-d', '--name', name, '--network', NET, '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '-p', `127.0.0.1:${hostPort}:4096`,
    '-e', 'HOME=/home/app', '-e', 'XDG_DATA_HOME=/data', '-e', `OPENCODE_MODEL=${LLM_MODEL}`,
    '-e', `OPENCODE_CONFIG_CONTENT=${JSON.stringify(providerCfg)}`,
    '--tmpfs', `/home/app:uid=${process.getuid?.() ?? 1000},gid=${process.getgid?.() ?? 1000},mode=0700`,
    '--tmpfs', `/data:uid=${process.getuid?.() ?? 1000},gid=${process.getgid?.() ?? 1000}`,
    '-v', `${vaultsDir}:/vaults`,
    IMAGE, 'serve', '--hostname', '0.0.0.0', '--port', '4096',
  );
  const url = `http://127.0.0.1:${hostPort}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) break;
    } catch {
      // starting
    }
    if (Date.now() > deadline) {
      const logs = docker('logs', name);
      docker('rm', '-f', name); // don't leak it
      throw new Error(`opencode did not start: ${logs}`);
    }
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
