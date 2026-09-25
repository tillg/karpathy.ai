import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Settings } from '@karpathy/shared';
import { bearerAuth } from './auth.js';
import type { ChatService } from './chat.js';
import type { CommitMessages } from './commit-message.js';
import type { ConfigStore } from './config-store.js';
import { PathError } from './paths.js';
import { HttpError, type Vaults } from './vaults.js';

export interface AppDeps {
  token: string;
  vaults: Vaults;
  store: ConfigStore;
  chat?: ChatService;
  commitMessages?: CommitMessages;
  opencodeHealthy?: () => Promise<boolean>;
}

const addVault = z.object({
  name: z.string().trim().max(100).default(''),
  repo: z.string().trim(),
  branch: z.string().trim().min(1).max(200).optional(),
  root: z.string().trim().max(500).optional(),
});
const patchVault = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  repo: z.string().trim().optional(),
  branch: z.string().trim().min(1).max(200).optional(),
  root: z.string().trim().max(500).optional(),
});
const patchSettings = z.object({
  commitReminderThreshold: z.number().int().min(1).max(1000).optional(),
  model: z.string().trim().regex(/^[^/\s]+\/\S+$/, 'model must be provider/model').optional(),
});
const putFile = z.object({ content: z.string(), version: z.string().nullable(), force: z.boolean().optional() });
const commitBody = z.object({ message: z.string().min(1).max(10_000) });
const resolveBody = z.object({ path: z.string().min(1), choice: z.enum(['mine', 'theirs', 'both']) });
const promptBody = z.object({ text: z.string().trim().min(1).max(100_000) });

const qs = (req: Request, name: string): string => {
  const v = req.query[name];
  if (typeof v !== 'string' || v === '') throw new HttpError(400, `query parameter ${name} is required`);
  return v;
};

/** Starts an NDJSON stream response; returns a writer. Blank lines are keepalives. */
export function ndjson(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const keepalive = setInterval(() => res.write('\n'), 15_000);
  res.on('close', () => clearInterval(keepalive));
  return {
    send: (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`),
    end: () => {
      clearInterval(keepalive);
      res.end();
    },
  };
}

export function createApp(d: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  // Container liveness probe only; carries no data, so it sits outside the authed /api.
  app.get('/healthz', (_req, res) => void res.send('ok'));
  const api = express.Router();
  api.use(bearerAuth(d.token));
  api.use(express.json({ limit: '10mb' }));

  api.get('/health', async (_req, res) => {
    const opencode = d.opencodeHealthy ? await d.opencodeHealthy().catch(() => false) : false;
    res.json({ backend: 'ok', opencode: opencode ? 'ok' : 'down' });
  });

  api.get('/settings', (_req, res) => {
    res.json(d.store.get().settings);
  });
  api.patch('/settings', async (req, res) => {
    const body = patchSettings.parse(req.body);
    await d.store.update((c) => {
      c.settings = { ...c.settings, ...body } as Settings;
    });
    res.json(d.store.get().settings);
  });

  // ---- vault admin ----
  api.get('/vaults', (_req, res) => {
    res.json(d.vaults.list());
  });
  api.post('/vaults', async (req, res) => {
    res.status(202).json(await d.vaults.add(addVault.parse(req.body)));
  });
  api.get('/vaults/:id', (req, res) => {
    res.json(d.vaults.getVault(req.params.id!));
  });
  api.patch('/vaults/:id', async (req, res) => {
    res.json(await d.vaults.patch(req.params.id!, patchVault.parse(req.body)));
  });
  api.delete('/vaults/:id', async (req, res) => {
    await d.vaults.remove(req.params.id!);
    d.chat?.vaultRemoved(req.params.id!);
    res.status(204).end();
  });

  // ---- status ----
  api.post('/vaults/:id/open', async (req, res) => {
    res.json(await d.vaults.open(req.params.id!));
  });
  api.get('/vaults/:id/status', async (req, res) => {
    res.json(await d.vaults.status(req.params.id!));
  });
  api.get('/vaults/:id/events', async (req, res) => {
    const id = req.params.id!;
    const status = await d.vaults.status(id);
    const out = ndjson(res);
    out.send({ type: 'status', status });
    const unsub = d.vaults.subscribe(id, (e) => out.send(e));
    res.on('close', unsub);
  });

  // ---- files ----
  api.get('/vaults/:id/files', async (req, res) => {
    res.json(await d.vaults.listFiles(req.params.id!));
  });
  api.get('/vaults/:id/file', async (req, res) => {
    const f = await d.vaults.readFile(req.params.id!, qs(req, 'path'));
    res.setHeader('ETag', `"${f.version}"`);
    res.json(f);
  });
  api.put('/vaults/:id/file', async (req, res) => {
    const body = putFile.parse(req.body);
    res.json(await d.vaults.writeFile(req.params.id!, qs(req, 'path'), body.content, body.version, body.force));
  });
  api.delete('/vaults/:id/file', async (req, res) => {
    await d.vaults.deleteFile(req.params.id!, qs(req, 'path'), qs(req, 'version'));
    res.status(204).end();
  });
  api.get('/vaults/:id/search', async (req, res) => {
    res.json(await d.vaults.search(req.params.id!, typeof req.query.q === 'string' ? req.query.q : ''));
  });

  // ---- git ----
  api.get('/vaults/:id/changes', async (req, res) => {
    res.json(await d.vaults.changes(req.params.id!));
  });
  api.get('/vaults/:id/changes/diff', async (req, res) => {
    const path = qs(req, 'path');
    res.json({ path, diff: await d.vaults.diff(req.params.id!, path) });
  });
  api.post('/vaults/:id/discard', async (req, res) => {
    await d.vaults.discard(req.params.id!, qs(req, 'path'));
    res.status(204).end();
  });
  api.post('/vaults/:id/commit-message', async (req, res) => {
    const id = req.params.id!;
    if (!d.commitMessages) {
      const n = (await d.vaults.changes(id)).length;
      return void res.json({ message: `Update ${n} file${n === 1 ? '' : 's'}`, fallback: true });
    }
    res.json(await d.commitMessages.propose(id));
  });
  api.post('/vaults/:id/commit', async (req, res) => {
    res.json(await d.vaults.commit(req.params.id!, commitBody.parse(req.body).message));
  });
  api.post('/vaults/:id/push', async (req, res) => {
    res.json(await d.vaults.push(req.params.id!));
  });
  api.get('/vaults/:id/conflicts/sides', async (req, res) => {
    res.json(await d.vaults.conflictSides(req.params.id!, qs(req, 'path')));
  });
  api.post('/vaults/:id/conflicts/resolve', async (req, res) => {
    const b = resolveBody.parse(req.body);
    res.json(await d.vaults.resolveConflict(req.params.id!, b.path, b.choice));
  });

  // ---- chat ----
  const chat = () => {
    if (!d.chat) throw new HttpError(503, 'chat is not available');
    return d.chat;
  };
  api.get('/vaults/:id/chats', async (req, res) => {
    res.json(await chat().list(req.params.id!));
  });
  api.post('/vaults/:id/chats', async (req, res) => {
    res.status(201).json(await chat().create(req.params.id!));
  });
  api.get('/vaults/:id/chats/:chatId', async (req, res) => {
    res.json(await chat().get(req.params.id!, req.params.chatId!));
  });
  api.delete('/vaults/:id/chats/:chatId', async (req, res) => {
    await chat().remove(req.params.id!, req.params.chatId!);
    res.status(204).end();
  });
  api.post('/vaults/:id/chats/:chatId/prompt', async (req, res) => {
    await chat().prompt(req.params.id!, req.params.chatId!, promptBody.parse(req.body).text);
    res.status(202).json({ queued: true });
  });
  api.get('/vaults/:id/chats/:chatId/stream', async (req, res) => {
    const out = ndjson(res);
    const stop = chat().stream(req.params.id!, req.params.chatId!, (e) => out.send(e), () => out.end());
    res.on('close', stop);
  });
  api.post('/vaults/:id/chats/:chatId/abort', async (req, res) => {
    await chat().abort(req.params.id!, req.params.chatId!);
    res.status(204).end();
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });
  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    if (err instanceof PathError) return void res.status(400).json({ error: err.message, code: 'bad-path' });
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), code: 'invalid' });
    if ((err as { type?: string }).type === 'entity.parse.failed') return void res.status(400).json({ error: 'invalid JSON' });
    console.error(err);
    res.status(500).json({ error: (err as Error).message ?? 'internal error' });
  });

  app.use('/api', api);
  return app;
}
