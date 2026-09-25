import { readFileSync } from 'node:fs';
import { createApp } from './app.js';
import { ChatService } from './chat.js';
import { OpencodeCommitMessages } from './commit-message.js';
import { ConfigStore } from './config-store.js';
import { OpencodeHarness } from './harness/opencode.js';
import { Vaults } from './vaults.js';

/** Reads NAME, or the file at NAME_FILE (compose secrets). */
function secret(name: string): string | undefined {
  const file = process.env[`${name}_FILE`];
  if (file) return readFileSync(file, 'utf8').trim();
  return process.env[name] || undefined;
}

const env = {
  port: Number(process.env.PORT ?? 8787),
  vaultsDir: process.env.VAULTS_DIR ?? '/vaults',
  configDir: process.env.CONFIG_DIR ?? '/config',
  token: secret('BEARER_TOKEN') ?? '',
  githubToken: secret('GITHUB_TOKEN'),
  remoteBase: process.env.GIT_REMOTE_BASE ?? 'https://github.com/',
  identity: { name: process.env.GIT_AUTHOR_NAME ?? 'karpathy.ai user', email: process.env.GIT_AUTHOR_EMAIL ?? 'user@karpathy.ai' },
  opencodeUrl: process.env.OPENCODE_URL ?? 'http://opencode:4096',
  /** The vaults dir as opencode sees it (same volume, maybe another mount path). */
  opencodeVaultsDir: process.env.OPENCODE_VAULTS_DIR ?? '/vaults',
  defaultModel: process.env.DEFAULT_MODEL,
};

const store = await ConfigStore.open(env.configDir, env.defaultModel ? { model: env.defaultModel } : {});
const vaults = new Vaults(store, { vaultsDir: env.vaultsDir, remoteBase: env.remoteBase, githubToken: env.githubToken, identity: env.identity });
await vaults.init();

const harness = new OpencodeHarness(env.opencodeUrl);
const chat = new ChatService(vaults, store, harness, env.opencodeVaultsDir);
vaults.onReady = (id) => void chat.watch(id);
// opencode may still be starting; chats attach lazily on first use as well.
await chat.init().catch((e) => console.warn('chat init:', (e as Error).message));
const commitMessages = new OpencodeCommitMessages(vaults, store, harness, (id) => chat.dir(id));

const app = createApp({ token: env.token, vaults, store, chat, commitMessages, opencodeHealthy: () => harness.health(), availableModels: () => harness.models() });
const server = app.listen(env.port, () => console.log(`backend listening on :${env.port}`));

const shutdown = () => {
  server.close();
  chat.close();
  void vaults.close().then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
