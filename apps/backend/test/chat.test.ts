import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatEvent } from '@karpathy/shared';
import { ChatService } from '../src/chat.js';
import { OpencodeCommitMessages } from '../src/commit-message.js';
import { OpencodeHarness } from '../src/harness/opencode.js';
import { makeApp, TOKEN } from './app-helpers.js';
import { makeRemote, sh } from './helpers.js';
import { DEAD_MODEL, startOpencode, testDir } from './opencode-container.js';

// Default tier: a real opencode container, but the model doesn't exist in Ollama, so every
// turn fails fast. That exercises the whole turn lifecycle deterministically without an LLM.

let oc: Awaited<ReturnType<typeof startOpencode>>;
const base = testDir('chat');
const vaultsDir = join(base, 'vaults');

beforeAll(async () => {
  oc = await startOpencode(vaultsDir);
}, 90_000);
afterAll(() => oc?.stop());

async function setup() {
  const remote = await makeRemote({ 'Home.md': '# Home\n', 'Other.md': 'other\n' }, { name: `v${Math.random().toString(36).slice(2, 7)}` });
  const t = await makeApp(remote.remoteBase, {}, { config: join(base, `config-${Math.random()}`), vaults: vaultsDir });
  await t.store.update((c) => { c.settings.model = DEAD_MODEL; });
  const harness = new OpencodeHarness(oc.url);
  const chat = new ChatService(t.vaults, t.store, harness, '/vaults');
  const commitMessages = new OpencodeCommitMessages(t.vaults, t.store, harness, (id) => chat.dir(id), 5000);
  const { createApp } = await import('../src/app.js');
  const app = createApp({ token: TOKEN, vaults: t.vaults, store: t.store, chat, commitMessages, opencodeHealthy: () => harness.health() });
  const id = await t.addVault(remote.repo, { name: remote.repo.split('/')[1] });
  const request = (await import('supertest')).default;
  const auth = { Authorization: `Bearer ${TOKEN}` };
  const api = {
    get: (p: string) => request(app).get(`/api${p}`).set(auth),
    post: (p: string, body?: object) => request(app).post(`/api${p}`).set(auth).send(body),
    delete: (p: string) => request(app).delete(`/api${p}`).set(auth),
  };
  const raw = createOpencodeClient({ baseUrl: oc.url });
  return { ...t, app, api, chat, harness, remote, id, raw, dir: chat.dir(id) };
}

async function waitIdle(chat: ChatService, vaultId: string, chatId: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (chat.turnState(vaultId, chatId) !== 'idle') {
    if (Date.now() > end) throw new Error('turn did not end');
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function userAgents(raw: ReturnType<typeof createOpencodeClient>, dir: string, chatId: string) {
  const msgs = (await raw.session.messages({ directory: dir, sessionID: chatId })).data ?? [];
  return msgs.filter((m) => m.info.role === 'user').map((m) => (m.info as { agent?: string }).agent);
}

describe('chat API against a real opencode container', () => {
  it('health reports opencode ok', async () => {
    const t = await setup();
    expect((await t.api.get('/health')).body).toEqual({ backend: 'ok', opencode: 'ok' });
  });

  it('sessions of vault A never appear under vault B', async () => {
    const a = await setup();
    const b = await setup();
    const { chatId } = (await a.api.post(`/vaults/${a.id}/chats`)).body;
    expect((await a.api.get(`/vaults/${a.id}/chats`)).body.map((c: { id: string }) => c.id)).toContain(chatId);
    expect((await b.api.get(`/vaults/${b.id}/chats`)).body.map((c: { id: string }) => c.id)).not.toContain(chatId);
    expect((await b.api.get(`/vaults/${b.id}/chats/${chatId}`)).status).toBe(404);
  });

  it('child sessions (subagents) are left out of the list', async () => {
    const t = await setup();
    const { chatId } = (await t.api.post(`/vaults/${t.id}/chats`)).body;
    const child = (await t.raw.session.create({ directory: t.dir, parentID: chatId, title: 'child' })).data!;
    const ids = (await t.api.get(`/vaults/${t.id}/chats`)).body.map((c: { id: string }) => c.id);
    expect(ids).toContain(chatId);
    expect(ids).not.toContain(child.id);
  });

  it('prompt → 202; turn runs with agent "vault", lock released on idle, error surfaced in messages', async () => {
    const t = await setup();
    const { chatId } = (await t.api.post(`/vaults/${t.id}/chats`)).body;
    const r = await t.api.post(`/vaults/${t.id}/chats/${chatId}/prompt`, { text: 'hello' });
    expect(r.status).toBe(202);
    await waitIdle(t.chat, t.id, chatId);
    expect(t.vaults.lock(t.id).isFree).toBe(true);
    expect(await userAgents(t.raw, t.dir, chatId)).toEqual(['vault']);
    const detail = (await t.api.get(`/vaults/${t.id}/chats/${chatId}`)).body;
    expect(detail.turn).toBe('idle');
    expect(detail.messages[0]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'hello' }] });
  });

  it('in Conflict every turn uses "vault-readonly"', async () => {
    const t = await setup();
    const f = (await t.api.get(`/vaults/${t.id}/file?path=Other.md`)).body;
    await t.api.post(`/vaults/${t.id}/open`);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(t.vaults.vaultRootDir(t.id), 'Other.md'), 'mine\n');
    await t.remote.obsidianPush({ 'Other.md': 'theirs\n' });
    expect(f.version).toBeTruthy();
    const { chatId } = (await t.api.post(`/vaults/${t.id}/chats`)).body;
    // The pull at turn start runs into the conflict.
    await t.api.post(`/vaults/${t.id}/chats/${chatId}/prompt`, { text: 'one' });
    await waitIdle(t.chat, t.id, chatId);
    expect(t.vaults.isConflict(t.id)).toBe(true);
    await t.api.post(`/vaults/${t.id}/chats/${chatId}/prompt`, { text: 'two' });
    await waitIdle(t.chat, t.id, chatId);
    expect(await userAgents(t.raw, t.dir, chatId)).toEqual(['vault-readonly', 'vault-readonly']);
  });

  it('pull runs before the turn is dispatched: local HEAD equals the remote', async () => {
    const t = await setup();
    await t.remote.obsidianPush({ 'Other.md': 'remote change\n' });
    const remoteHead = sh(t.remote.bare, 'rev-parse', 'main').trim();
    const { chatId } = (await t.api.post(`/vaults/${t.id}/chats`)).body;
    await t.api.post(`/vaults/${t.id}/chats/${chatId}/prompt`, { text: 'x' });
    await waitIdle(t.chat, t.id, chatId);
    expect(sh(t.vaults.vaultRootDir(t.id), 'rev-parse', 'HEAD').trim()).toBe(remoteHead);
  });

  it('one running turn per vault: a second chat queues and starts after the first is idle', async () => {
    const t = await setup();
    const a = (await t.api.post(`/vaults/${t.id}/chats`)).body.chatId;
    const b = (await t.api.post(`/vaults/${t.id}/chats`)).body.chatId;
    const states: string[] = [];
    await t.api.post(`/vaults/${t.id}/chats/${a}/prompt`, { text: 'first' });
    await t.api.post(`/vaults/${t.id}/chats/${b}/prompt`, { text: 'second' });
    states.push(t.chat.turnState(t.id, b));
    await waitIdle(t.chat, t.id, a);
    await waitIdle(t.chat, t.id, b);
    expect(states[0]).toBe('queued');
    const msgsA = (await t.raw.session.messages({ directory: t.dir, sessionID: a })).data!;
    const msgsB = (await t.raw.session.messages({ directory: t.dir, sessionID: b })).data!;
    const aEnd = Math.max(...msgsA.map((m) => (m.info.time as { completed?: number; created: number }).completed ?? m.info.time.created));
    const bUser = msgsB.find((m) => m.info.role === 'user')!.info.time.created;
    expect(bUser).toBeGreaterThanOrEqual(aEnd);
  });

  it('abort removes a queued prompt', async () => {
    const t = await setup();
    const release = await t.vaults.lock(t.id).acquireExclusive(); // hold the vault busy
    const { chatId } = (await t.api.post(`/vaults/${t.id}/chats`)).body;
    await t.api.post(`/vaults/${t.id}/chats/${chatId}/prompt`, { text: 'never' });
    expect(t.chat.turnState(t.id, chatId)).toBe('queued');
    await t.api.post(`/vaults/${t.id}/chats/${chatId}/abort`);
    expect(t.chat.turnState(t.id, chatId)).toBe('idle');
    release();
    await new Promise((r) => setTimeout(r, 500));
    expect(await userAgents(t.raw, t.dir, chatId)).toEqual([]);
  });

  it('stream: queued → running → idle over NDJSON; idle chat ends immediately', async () => {
    const t = await setup();
    const server = http.createServer(t.app).listen(0);
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    const { chatId } = (await t.api.post(`/vaults/${t.id}/chats`)).body;
    const read = async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/vaults/${t.id}/chats/${chatId}/stream`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      return (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as ChatEvent);
    };
    expect(await read()).toEqual([{ type: 'turn', state: 'idle' }]);
    const release = await t.vaults.lock(t.id).acquireExclusive();
    await t.api.post(`/vaults/${t.id}/chats/${chatId}/prompt`, { text: 'streamed' });
    const events = read();
    await new Promise((r) => setTimeout(r, 200));
    release();
    const got = await events;
    const turns = got.filter((e) => e.type === 'turn').map((e) => (e as { state: string }).state);
    expect(turns).toEqual(['queued', 'running', 'idle']);
    expect(got.some((e) => e.type === 'message')).toBe(true);
    server.close();
  });

  it('commit message: fallback when the model fails; throwaway session deleted, chat list unchanged', async () => {
    const t = await setup();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(t.vaults.vaultRootDir(t.id), 'Other.md'), 'changed\n');
    const before = (await t.api.get(`/vaults/${t.id}/chats`)).body;
    const r = await t.api.post(`/vaults/${t.id}/commit-message`);
    expect(r.body).toEqual({ message: 'Update 1 file', fallback: true });
    expect((await t.api.get(`/vaults/${t.id}/chats`)).body).toEqual(before);
  });

  it('commit message: fallback when opencode is down', async () => {
    const t = await setup();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(t.vaults.vaultRootDir(t.id), 'Other.md'), 'changed\n');
    const deadHarness = new OpencodeHarness('http://127.0.0.1:9');
    const cm = new OpencodeCommitMessages(t.vaults, t.store, deadHarness, (id) => t.chat.dir(id), 2000);
    expect(await cm.propose(t.id)).toEqual({ message: 'Update 1 file', fallback: true });
  });

  it('deleting a chat removes it from the list', async () => {
    const t = await setup();
    const { chatId } = (await t.api.post(`/vaults/${t.id}/chats`)).body;
    expect((await t.api.delete(`/vaults/${t.id}/chats/${chatId}`)).status).toBe(204);
    expect((await t.api.get(`/vaults/${t.id}/chats`)).body.map((c: { id: string }) => c.id)).not.toContain(chatId);
  });
});
