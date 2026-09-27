# Spikes: LLM, agent loop, search — browser-only

Run 2026-09-27 on Apple M4 Max, macOS 27.0 (`uname -m` = arm64), Node v22.13.1, Playwright 1.63.0
(headless Chromium 153 / WebKit 26.6 ≈ Safari 26). LLM for L2–L4: `qwen2.5:3b` in the dev stack's
Ollama container (`karpathy-ai-ollama-1`), reached through a throwaway socat forwarder on
`127.0.0.1:11435`. The forwarder was removed afterwards. No API keys were used or stored.

## Verdicts

| # | Theory | Verdict |
|---|---|---|
| L1 | LLM providers can be called straight from the browser (CORS) | **PARTIAL.** Anthropic (only with the `anthropic-dangerous-direct-browser-access` header), OpenRouter, Gemini, Mistral and Groq work. OpenAI answers the preflight, but its error responses have no ACAO header, so the page never sees a 401. Success responses could not be checked without a key. |
| L2 | A browser page can talk to a local Ollama | **PARTIAL.** Works from `http://localhost`/`127.0.0.1` pages, because Ollama's default origin list allows them. Other origins get 403 unless `OLLAMA_ORIGINS` is set. **WebKit blocks an HTTPS page calling `http://localhost:11435` (mixed content).** Chromium allows it. So on iPad, Ollama needs HTTPS plus `OLLAMA_ORIGINS`. |
| L3 | A complete tool-calling agent loop (OPFS tools, skills) runs in the browser | **CONFIRMED (plumbing)** in Chromium and WebKit, with both the AI SDK and a hand-written fetch loop. **Model quality is the limit:** qwen2.5:3b completed the task cleanly 1 time in 70 runs. |
| L4 | A running stream survives the tab going to the background | **NOT TESTABLE headless; doc-based.** The CDP freeze on a visible headless page did nothing, and a synthetic `visibilitychange` has no effect. See notes. |
| L5 | Full-vault search (3337 files, 5.6 M chars) in the browser is fast enough | **CONFIRMED.** A naive regex over texts in memory takes 1–10 ms per query. MiniSearch builds in 0.4–0.8 s and answers in 1–2 ms. FlexSearch builds in 0.6–1.1 s and answers in < 0.1 ms. **The bottleneck is OPFS I/O**, not search: loading many small files takes seconds. |
| L6 | An in-browser model (WebGPU) is possible | **PARTIAL.** Headless WebKit exposes `navigator.gpu` and returns an Apple adapter with `shader-f16`. Headless Chromium has `navigator.gpu` but no adapter. No model was downloaded. |
| extra | OPFS works in WebKit in every context | **REJECTED.** `navigator.storage.getDirectory()` throws `UnknownError` in an ephemeral (non-persistent) WebKit context, which behaves like Safari Private Browsing. It works in a persistent context. |

## L1 — CORS of LLM providers

Preflight: `curl -X OPTIONS` with `Origin: http://localhost:5199` (see `results/L1-curl.txt`).
Real request: `fetch()` from a page on `http://localhost:5199` with a fake key
(`results/L1-cors-{chromium,webkit}.json`). Chromium and WebKit gave identical results.

| Provider / endpoint | Preflight status, ACAO | Browser fetch (both engines) |
|---|---|---|
| Anthropic `/v1/messages`, no direct-access header | 400, no ACAO | **blocked** (TypeError) |
| Anthropic + `anthropic-dangerous-direct-browser-access: true` | 200, `*` | response **401** (readable) |
| OpenAI `/v1/chat/completions` | 200, echoes the origin | **blocked**: the 401 has no ACAO (curl confirms: only `access-control-expose-headers`). Success responses unverified. |
| OpenRouter `/api/v1/chat/completions` | 204, `*` | response 401 |
| Gemini native `:generateContent` (`x-goog-api-key`) | 200, echoes the origin | response 400 |
| Gemini OpenAI-compat `/v1beta/openai/chat/completions` | 200, echoes the origin | response 400 |
| Mistral `/v1/chat/completions` | 200, `*` | response 401 |
| Groq `/openai/v1/chat/completions` | 204, `*` | response 401 |
| Ollama via forwarder `/v1/chat/completions` | 204, echoes the origin | response 404 (dummy model), readable |

Consequence: a browser-only app can reach every provider on the list except, possibly, OpenAI.
The key has to live in the browser (BYO key). OpenRouter is the most permissive gateway: it
allows `*` and a very long list of headers.

## L2 — local Ollama from the browser

Container env has `OLLAMA_HOST=0.0.0.0:11434` and no `OLLAMA_ORIGINS`
(`results/L2-ollama-cors.txt`, `results/L2-mixed-content.json`).

| Origin | `/api/chat` and `/v1/chat/completions` preflight |
|---|---|
| `http://localhost:5199`, `http://127.0.0.1:5199` | 204, ACAO = origin |
| `app://obsidian.md` | 204, ACAO = origin |
| `https://vault.example.com` (a hosted PWA) | **403** |
| `null` (file://, sandboxed iframe) | **403** |

| HTTPS page (`https://localhost:5443`) → `http://localhost:11435/api/tags` | Result |
|---|---|
| Chromium | 200 |
| WebKit | **blocked** (mixed content) |

Consequence for iPad/Safari: a hosted HTTPS PWA can only use an Ollama on another machine if that
Ollama sits behind HTTPS (for example a reverse proxy or Tailscale serve) with
`OLLAMA_ORIGINS=https://<pwa-origin>`. Ollama's OpenAI-compatible `/v1` streams SSE and works with
`@ai-sdk/openai-compatible` unchanged.

## L3 — agent loop fully in the browser

Page `agent.html` / `src/agent.ts`. It builds a 12-note vault with frontmatter and `[[wikilinks]]`,
plus 2 skills under `.claude/skills/*/SKILL.md`, and writes them into OPFS. Tools run on OPFS:
`list_files`, `read_file`, `search`, `write_file` (or `edit_file`) and `load_skill`. The system
prompt lists the skills by name and description only; the body is loaded on demand (progressive
disclosure). After each run the page reads the target file back from OPFS to check it.
Implementation A is the Vercel AI SDK (`ai@7.0.118`, `streamText` + `tool` + `isStepCount(10)`,
`@ai-sdk/openai-compatible@3.0.57`). Implementation B is a hand-written loop over `fetch` with an
SSE parser (about 40 lines). Tasks:
*plain* = "Find the note about the lighthouse near Brest and add a final line "Seen: yes" to it.";
*skill* = "I visited the Phare du Petit Minou lighthouse. Use the matching skill." Pass = `Seen: yes`
line present, frontmatter intact, and (for *skill*) `updated: 2026-09-27`.

| Variant (temp 0, 3 runs each) | Chromium ok / file changed | WebKit ok / file changed | Latency per run | Tools called |
|---|---|---|---|---|
| SDK, plain | 0 / 1 | 0 / 1 | 2.1–4.3 s | search, read_file, (write_file) |
| fetch loop, plain | 0 / 1 | 0 / 1 | 2.2–3.3 s | same |
| SDK or fetch, skill (`load_skill` only) | 0 / 0 | 0 / 0 | 0.3–0.4 s | none: the model emits a call to a tool named `mark-seen`, which **Ollama silently drops** because the name is not in `tools` |
| SDK or fetch, skill + each skill also exposed as a tool | 0 / 0 | 0 / 0 | 5.6–7.8 s | skill loaded 3/3; the write went to the wrong path (`phare-du-petit-minou.md` without `Wiki/`) |

| Retries at temp 0.7, plain task (5 × SDK + 5 × fetch per browser) | Chromium ok / changed | WebKit ok / changed |
|---|---|---|
| `write_file` (full overwrite) | 0/10, 5/10 | 0/10, 6/10 |
| `edit_file` (exact string replace, like opencode's `edit`) | **1/10** (SDK, 7 steps, 6.3 s), 5/10 | 0/10, 6/10 |

Observations:
- **Plumbing works identically in both engines**, with both implementations: tool calls come back
  parsed, tools run against OPFS, results feed the next step, and the file really changes in OPFS.
  OPFS writes used `createWritable()` in both engines (a worker fallback exists but was not needed).
- **Streaming works:** the final answer arrived as 107 text deltas, and the L4 baseline delivered
  336–392 SSE chunks for 400 tokens in both engines. Ollama sends tool calls as one whole chunk, not
  streamed arguments. The SDK's "first chunk" (3–40 ms) is its stream-start event; the first real
  model byte takes about 180–800 ms (fetch loop).
- **Every failure is a model-quality failure.** qwen2.5:3b rewrites the frontmatter on full-file
  writes, repeats `edit_file` with an `old_string` that does not match, or stops after `read_file`.
  Harness lessons: (1) prefer an exact-replace edit tool over full overwrite; (2) expose skills
  through a tool whose name the model will actually call (opencode uses a `skill` tool), because
  Ollama drops unknown tool names without any error; (3) always cap output tokens. One uncapped run
  generated more than 20 000 tokens before the client aborted it.
- **The AI SDK has no trouble in the browser:** no Node polyfills needed, and it bundles to 408 kB
  (110 kB gzip, including zod). The hand-written loop is only a few kB and behaved the same, but
  you would then maintain the SSE and tool-call parsing yourself.

## L4 — background / tab lifecycle

| Engine | Method | Baseline stream | "Interrupted" stream |
|---|---|---|---|
| Chromium | CDP `Page.setWebLifecycleState frozen` for 8 s after 1.5 s | 336 chunks, 4.9 s | 401 chunks, 5.8 s, max gap 197 ms, no `freeze` event: **the freeze had no effect on a visible headless page** |
| WebKit | synthetic `visibilitychange` → hidden (the only thing available) | 392 chunks, 5.3 s | 374 chunks, 5.3 s, no gap: synthetic event, no real throttling |

Headless browsers cannot reproduce iOS behaviour, so the rest comes from the platform docs: Safari on
iOS suspends a backgrounded tab's JS within seconds and may drop its network connections. There is
no Background Fetch or Background Sync in WebKit. Service workers do not keep a fetch alive
indefinitely. Measured side effect: when the client disconnects, Ollama stops generating (seen in
its logs). **Design implication:** a browser-only agent loop runs only while the tab is in the
foreground. It must persist its state after every step (messages and tool results, for example in
OPFS or IndexedDB) and resume after a reload. Long runs cannot continue while the iPad is locked.

## L5 — search over the full mylife_wiki vault (3337 .md files, 5 632 421 chars, 6.2 MB JSON)

`search.html` / `src/search.ts`, `results/L5-search-*.json`. Times are the mean of 5 runs after a warm-up.

| Measurement | Chromium | WebKit |
|---|---|---|
| fetch + JSON.parse of all files | 462 ms | 41 ms |
| (a) naive `RegExp(q,'i')` over all texts in memory, per query | 1–10 ms (one outlier 49 ms) | 0.8–2.6 ms |
| OPFS write of 3337 files, `createWritable` sequentially | 102 s (21 s in an ephemeral context) | 18 s |
| OPFS write of 3337 files, one worker + `createSyncAccessHandle` | 21.6 s (9.7 s ephemeral) | 6.9 s |
| OPFS recursive list | 2.0 s | 7.9 s |
| OPFS read all (`Promise.all`) | 11.1 s (1.0 s ephemeral) | 3.4 s |
| scan once after reading from OPFS | 1.9 ms | 2.0 ms |
| (b) MiniSearch build (`path`, `text`) | 822 ms (665–2463 across runs) | 376 ms |
| MiniSearch serialized size / `loadJSON` | 5.3 MB / 252 ms | 5.3 MB / 360 ms |
| MiniSearch query (prefix + fuzzy 0.2) | 0.8–2.1 ms | 0.2–1.2 ms |
| (c) FlexSearch `Index` (`tokenize: forward`) build | 1075 ms | 558 ms |
| FlexSearch export size | 13.7 MB | 13.7 MB |
| FlexSearch query | < 0.1 ms | < 0.1 ms |
| JS heap after everything | 304 MB | n/a |

Consequences: keep all texts in memory, or keep a persisted MiniSearch index plus the file texts.
Naive regex over 5.6 M chars is already interactive (it is the in-browser equivalent of ripgrep),
and MiniSearch adds ranking and fuzzy matching. The expensive part is getting 3300 small files into
and out of OPFS: several seconds to minutes, with high variance in Chromium. Storing the vault as
per-file OPFS entries needs a bulk path (a worker with sync access handles) and ideally a packed
cache (one JSON/SQLite blob, or a persisted index) for cold start.

## L6 — WebGPU for an in-browser model (feature detection only)

| | Chromium headless | WebKit headless |
|---|---|---|
| `navigator.gpu` | yes | yes |
| `requestAdapter()` | null (no GPU in headless) | Apple adapter, `shader-f16` |
| `storage.estimate().quota` (ephemeral context) | 10.7 GB | 1.0 GB |

WebLLM was not initialised and no model was downloaded. WebGPU is present in Safari 26-class WebKit,
so small in-browser models are technically possible. The 1 GB quota in an ephemeral WebKit context
is a warning sign for multi-GB model weights. Persistent Safari quotas are larger but get evicted.

## Re-run

```bash
cd specs/03_browser_only/spikes/llm-agent
npm install && npx playwright install chromium webkit
npm run fixture                       # copies ~/git/mylife_wiki/**/*.md (read-only) to public/fixture (gitignored) + builds the small vault
bash scripts/cors-curl.sh             # L1 preflights
# L2–L4 need the forwarder to the dev stack's Ollama (no stack changes):
docker run -d --rm --name spike-ollama-fwd --network karpathy-ai_internal -p 127.0.0.1:11435:11434 \
  alpine/socat tcp-listen:11434,fork,reuseaddr tcp-connect:ollama:11434
bash scripts/ollama-cors.sh           # L2 CORS per origin
node scripts/mixed-content.mjs        # L2 HTTPS page -> http://localhost Ollama
node scripts/run.mjs                  # L1 fetch, L6, L5, L3 (REPEAT=3), L4 in Chromium + WebKit -> results/*.json
node scripts/agent-retries.mjs 5 0.7 0   # L3 retries, write_file
node scripts/agent-retries.mjs 5 0.7 1   # L3 retries, edit_file
node scripts/webkit-opfs-ephemeral.mjs   # OPFS ephemeral vs persistent WebKit context
docker rm -f spike-ollama-fwd
```

Notes: `scripts/run.mjs` uses persistent browser contexts because WebKit refuses OPFS in ephemeral
ones. Pages can also be opened by hand with `npm run dev` → `http://localhost:5199/agent.html` and
calling `runAgent('sdk'|'fetch', 'plain'|'skill', skillTools?)` in the console
(`?temp=0.7&edit=1` are optional).
