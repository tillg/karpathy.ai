// L3 + L4: agent loop fully in the browser. Vault in OPFS, tools on OPFS, LLM = Ollama (OpenAI-compatible /v1).
// Two implementations: Vercel AI SDK (streamText + tools) and a hand-written loop over fetch + SSE.
import { streamText, tool, isStepCount } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { root, readFile, writeFile, listFiles, wipe, writeMode } from './opfs';

const BASE = (window as any).OLLAMA_BASE ?? 'http://localhost:11435/v1';
const MODEL = 'qwen2.5:3b';
const TEMP = Number(new URLSearchParams(location.search).get('temp') ?? 0);
// ?edit=1 replaces write_file (full overwrite) with edit_file (exact-string replace, like opencode's edit tool).
const EDIT = new URLSearchParams(location.search).get('edit') === '1';
const TARGET = 'Wiki/phare-du-petit-minou.md';

async function loadVault() {
  await wipe('vault');
  const r = await root('vault');
  const files: { path: string; text: string }[] = await (await fetch('/vault-small/vault.json')).json();
  for (const f of files) await writeFile(r, f.path, f.text);
  return r;
}
function fm(text: string, key: string) { return text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''; }
async function skillIndex(r: FileSystemDirectoryHandle) {
  const all = await listFiles(r);
  const skills = [];
  for (const p of all.filter((p) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(p))) {
    const t = await readFile(r, p);
    skills.push({ name: fm(t, 'name'), description: fm(t, 'description'), path: p });
  }
  return skills;
}
function systemPrompt(skills: { name: string; description: string }[]) {
  return `You are an assistant that edits a Markdown vault (Obsidian style, YAML frontmatter, [[wikilinks]]).
Use the tools to find, read and write files. Paths are relative, e.g. Wiki/foo.md. ${EDIT ? 'Always read_file before edit_file. Edit files with edit_file (exact string replacement).' : 'Always read_file before write_file. When you edit a file, call write_file with the COMPLETE new content (keep the frontmatter).'}
Available skills (call load_skill with the name to get the instructions before using one):
${skills.map((s) => `- ${s.name}: ${s.description} -> call load_skill with {"name": "${s.name}"}`).join('\n')}
Skills are NOT tools; the only tools are ${Object.keys(schemas).join(', ')}.`;
}
function makeImpl(r: FileSystemDirectoryHandle, log: any[], skillNames: string[] = []) {
  const impl: Record<string, (a: any) => Promise<string>> = {
    list_files: async () => (await listFiles(r)).filter((p) => !p.startsWith('.claude/')).join('\n'),
    read_file: async ({ path }) => { try { return await readFile(r, path); } catch { return `ERROR: no such file ${path}`; } },
    search: async ({ query }) => {
      // Any-term match (small models send multi-word queries).
      const terms = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2); const hits: string[] = [];
      for (const p of await listFiles(r)) {
        const lines = (await readFile(r, p)).split('\n');
        const i = lines.findIndex((l) => terms.some((w) => l.toLowerCase().includes(w)));
        if (i >= 0) hits.push(`${p}:${i + 1}: ${lines[i].slice(0, 120)}`);
      }
      return hits.join('\n') || 'no matches';
    },
    write_file: async ({ path, content }) => { await writeFile(r, path, content); return `wrote ${path} (${content.length} chars)`; },
    edit_file: async ({ path, old_string, new_string }) => {
      let t; try { t = await readFile(r, path); } catch { return `ERROR: no such file ${path}`; }
      if (!old_string || !t.includes(old_string)) return 'ERROR: old_string not found; read_file first and copy it exactly';
      await writeFile(r, path, t.replace(old_string, new_string)); return `edited ${path}`;
    },
    load_skill: async ({ name }) => {
      try { return await readFile(r, `.claude/skills/${name}/SKILL.md`); } catch { return `ERROR: unknown skill ${name}`; }
    },
  };
  for (const sk of skillNames) impl[sk] = async () => readFile(r, `.claude/skills/${sk}/SKILL.md`);
  const wrapped: typeof impl = {};
  for (const [k, f] of Object.entries(impl)) wrapped[k] = async (a) => { const t = performance.now(); const out = await f(a ?? {}); log.push({ tool: k, args: a, ms: Math.round(performance.now() - t), out: out.slice(0, 80) }); return out; };
  return wrapped;
}
const schemas = {
  list_files: { d: 'List all files in the vault.', s: z.object({}) },
  read_file: { d: 'Read a file.', s: z.object({ path: z.string() }) },
  search: { d: 'Case-insensitive full-text search. Returns path:line: text.', s: z.object({ query: z.string() }) },
  write_file: { d: 'Overwrite a file with the complete new content.', s: z.object({ path: z.string(), content: z.string() }) },
  load_skill: { d: 'Load the instructions of a skill by name.', s: z.object({ name: z.string() }) },
  edit_file: { d: 'Replace an exact string in a file. To append a line, use the last line as old_string and last line + newline + new line as new_string.', s: z.object({ path: z.string(), old_string: z.string(), new_string: z.string() }) },
};
if (EDIT) delete (schemas as any).write_file; else delete (schemas as any).edit_file;
const jsonSchemas: Record<string, any> = {
  list_files: { type: 'object', properties: {} },
  read_file: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  search: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  write_file: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  load_skill: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  edit_file: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] },
};

export const TASKS: Record<string, string> = {
  plain: `Find the note about the lighthouse near Brest and add a final line "Seen: yes" to it.`,
  skill: `I visited the Phare du Petit Minou lighthouse. Use the matching skill.`,
};
async function verify(r: FileSystemDirectoryHandle, task: string) {
  const t = await readFile(r, TARGET);
  const seen = /^Seen: yes\s*$/m.test(t);
  const fmKept = t.startsWith('---\n') && /\n---\n/.test(t.slice(3)) && t.includes('[[brittany]]');
  const updated = fm(t, 'updated');
  const orig = ((await (await fetch('/vault-small/vault.json')).json()) as any[]).find((f) => f.path === TARGET).text;
  return { changed: t !== orig, seen, frontmatterKept: fmKept, updated, ok: seen && fmKept && (task !== 'skill' || updated === '2026-09-27') };
}

// ---- Implementation A: Vercel AI SDK ----
async function runSdk(task: string, skillTools = false) {
  const r = await loadVault(); const log: any[] = []; const sk = await skillIndex(r);
  const impl = makeImpl(r, log, skillTools ? sk.map((x) => x.name) : []);
  const provider = createOpenAICompatible({ name: 'ollama', baseURL: BASE });
  const tools: any = {};
  for (const [k, v] of Object.entries(schemas)) tools[k] = tool({ description: v.d, inputSchema: v.s, execute: impl[k] });
  if (skillTools) for (const x of sk) tools[x.name] = tool({ description: `Skill: ${x.description} Returns its instructions.`, inputSchema: z.object({}).passthrough(), execute: impl[x.name] });
  const t0 = performance.now(); let first = 0; let deltas = 0; let steps = 0; let text = '';
  const res = streamText({ model: provider(MODEL), system: systemPrompt(await skillIndex(r)), prompt: TASKS[task], tools, stopWhen: isStepCount(10), temperature: TEMP, maxOutputTokens: 1500 });
  for await (const part of res.fullStream as any) {
    if (!first) first = performance.now() - t0;
    if (part.type === 'text-delta') { deltas++; text += part.text ?? part.delta ?? ''; }
    if (part.type === 'finish-step') steps++;
    if (part.type === 'error') log.push({ error: String(part.error) });
  }
  return { impl: 'ai-sdk', skillTools, task, ms: Math.round(performance.now() - t0), firstChunkMs: Math.round(first), textDeltas: deltas, steps, tools: log, finalText: text.slice(0, 200), verify: await verify(r, task), writeMode };
}

// ---- Implementation B: hand-written loop over fetch + SSE ----
async function* sse(resp: Response) {
  const rd = resp.body!.pipeThrough(new TextDecoderStream()).getReader(); let buf = '';
  for (;;) {
    const { value, done } = await rd.read(); if (done) return; buf += value;
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const l of ev.split('\n')) if (l.startsWith('data: ') && l !== 'data: [DONE]') yield JSON.parse(l.slice(6)); }
  }
}
async function runFetch(task: string, skillTools = false) {
  const r = await loadVault(); const log: any[] = []; const sk = await skillIndex(r);
  const impl = makeImpl(r, log, skillTools ? sk.map((x) => x.name) : []);
  const messages: any[] = [{ role: 'system', content: systemPrompt(await skillIndex(r)) }, { role: 'user', content: TASKS[task] }];
  const tools = Object.entries(schemas).map(([k, v]) => ({ type: 'function', function: { name: k, description: v.d, parameters: jsonSchemas[k] } }));
  if (skillTools) for (const x of sk) tools.push({ type: 'function', function: { name: x.name, description: `Skill: ${x.description} Returns its instructions.`, parameters: { type: 'object', properties: {} } } });
  const t0 = performance.now(); let first = 0; let deltas = 0; let steps = 0; let text = '';
  for (; steps < 10; ) {
    const resp = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages, tools, stream: true, temperature: TEMP, maxOutputTokens: 1500 }) });
    steps++; let content = ''; const calls: any[] = [];
    for await (const ch of sse(resp)) {
      if (!first) first = performance.now() - t0;
      const d = ch.choices?.[0]?.delta ?? {};
      if (d.content) { deltas++; content += d.content; }
      for (const tc of d.tool_calls ?? []) { const c = (calls[tc.index ?? 0] ??= { id: tc.id, name: '', args: '' }); if (tc.id) c.id = tc.id; if (tc.function?.name) c.name += tc.function.name; if (tc.function?.arguments) c.args += tc.function.arguments; }
    }
    text = content;
    messages.push({ role: 'assistant', content, tool_calls: calls.length ? calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) : undefined });
    if (!calls.length) break;
    for (const c of calls) {
      let args: any = {}; try { args = JSON.parse(c.args || '{}'); } catch {}
      const out = impl[c.name] ? await impl[c.name](args) : `ERROR: unknown tool ${c.name}`;
      messages.push({ role: 'tool', tool_call_id: c.id, content: out });
    }
  }
  return { impl: 'fetch-loop', skillTools, task, ms: Math.round(performance.now() - t0), firstChunkMs: Math.round(first), textDeltas: deltas, steps, tools: log, finalText: text.slice(0, 200), verify: await verify(r, task), writeMode };
}
(window as any).runAgent = (impl: string, task: string, skillTools = false) => (impl === 'sdk' ? runSdk(task, skillTools) : runFetch(task, skillTools)).catch((e) => ({ impl, task, error: String(e?.stack ?? e) }));

// ---- L4: streaming + lifecycle probe. Streams a long answer and records chunk timestamps + visibility events. ----
(window as any).startStream = async () => {
  const w = window as any; w.__stream = { chunks: [] as number[], events: [] as any[], done: false, error: null, t0: performance.now() };
  document.addEventListener('visibilitychange', () => w.__stream.events.push({ t: Math.round(performance.now() - w.__stream.t0), vis: document.visibilityState }));
  for (const ev of ['freeze', 'resume', 'pagehide', 'pageshow']) document.addEventListener(ev, () => w.__stream.events.push({ t: Math.round(performance.now() - w.__stream.t0), ev }));
  try {
    const resp = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, stream: true, max_tokens: 400, messages: [{ role: 'user', content: 'Write a 300-word story about a lighthouse.' }] }) });
    for await (const _ of sse(resp)) w.__stream.chunks.push(Math.round(performance.now() - w.__stream.t0));
  } catch (e) { w.__stream.error = String(e); }
  w.__stream.done = true;
};
