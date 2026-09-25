# Spike: de-risk opencode (Phase 0)

Run on 2026-09-25 against `ghcr.io/anomalyco/opencode:1.18.25` (source checked at tag
`v1.18.25`, commit `cb7d8b2`). The verified server config is
[`deploy/opencode/opencode.json`](../../deploy/opencode/opencode.json).

## Read this first: the assumptions that failed or needed a fix

1. **Subfolder confinement only holds while opencode cannot see the git repo.**
   `external_directory` treats everything inside the *git worktree* as "inside"
   (`containsPath` = directory **or** worktree). opencode finds the worktree by walking up to a
   `.git` entry and running `git rev-parse`. The stock image has **no `git` binary**, so
   discovery fails, the project becomes `global` with worktree `/`, and only the session
   directory counts as inside. Result: with the stock image, reads above the subfolder are
   **denied**. With `git` installed in the image, the same read **succeeds** (verified).
   **Fix (MVP):** keep `git` out of the opencode image. **If git is ever added (M5):** the
   backend must keep git metadata off the shared volume (`git clone --separate-git-dir=/git/<id>.git`,
   `/git` mounted only in the backend). Verified: with the git image plus a `.git` gitlink that
   points to a path the opencode container can't see, the read is denied again.
2. **`OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` / `_SKILLS` must NOT be set.** They don't just
   skip `~/.claude`. They also drop the **vault's** `CLAUDE.md` and the vault's
   `.claude/skills` (verified). An empty `$HOME` is enough to keep global Claude files out.
3. **`task` must be denied.** A subagent does not inherit its parent *agent's* permissions,
   only the parent *session's*. Verified: a `vault-readonly` turn called `task` →
   `general` subagent → `write` created a file. `permission.task: deny` closes this hole.
4. **The defaults contain `ask` rules** (`doom_loop`, `external_directory`, `read *.env`).
   Each one has to be overridden, or a turn can block. Done in the config. No
   `permission.asked` event showed up in any run.
5. **No usable OpenAI model.** The `OPENAI_API_KEY` account is inactive ("Your account is not
   active, please check your billing details") and has no access to `gpt-4.1-*`/`gpt-5-*`.
   The opencode Zen free models refuse server use ("free tier can only be used from within
   OpenCode"). The spike therefore used a **local Ollama `qwen2.5:3b`** (container, via
   `@ai-sdk/openai-compatible`). This is a real model, not a mock. **Decision #3 in
   `implementation-decisions.md` (OpenAI for `@llm` tests) does not work with this key.**
   `apply_patch` (the edit tool opencode uses for GPT-5-family models) could not be tested live;
   its event shape comes from the source.

Everything else passed as the spec assumes.

## Results

| # | Plan row | Result | Evidence |
|---|---|---|---|
| 1 | Two vault dirs, `GET /session?directory=A` vs `B` | **pass** | A lists only `A1` (`directory:/vaults/a`), B only `B1`. The filter is exact `directory` + `project_id` (source: `session.ts` list). |
| 2 | Session in A, "list files", stream `/event` | **pass** | Tool part `glob` pending→running→completed. Output `/vaults/a/AGENTS.md, /vaults/a/alpha-two.md, /vaults/a/notes/alpha-one.md`, no B files. |
| 3 | `external_directory: deny`, vault root = subfolder of a repo with `.git` at the parent; read above the root + in vault B | **pass (stock image, no git)** / **fail (image with git)** / **pass (git image + git dir off-volume)** | Stock: both `read` calls → `error` "The user has specified a rule…". Git image: `read /vaults/repo/top-secret.md` → **completed**, B denied. Git image + `.git` gitlink to `/git/repo.git` (not mounted): denied. See failure 1. |
| 4 | `snapshot:false`, `bash/webfetch: deny`, no `ask` | **pass** | Blanket-denied tools are **not offered to the model at all** (`opencode debug agent vault` → `edit, glob, grep, invalid, read, skill, todowrite, write`). The prompt to run `echo > file`, `cat /vaults/b/…`, `env`, `git commit` and webfetch produced no tool call; file hashes unchanged; turn went idle in 22 s; `GET /permission` = `[]`; 0 `permission.asked` events in all runs. |
| 5 | Agents `vault` / `vault-readonly` / `commit-message`, chosen per prompt, two vaults at once | **pass** | Concurrent turns (event-ID ranges overlap): A with `vault` → `write` + `edit` completed. B with `vault-readonly` → no edit tools offered, files unchanged. Switching the agent per prompt in the **same** session works (the `vault-readonly` prompt after the `vault` prompt could not write). `commit-message` → no tools; sync `POST /session/:id/message` returned the message in 1.2 s. |
| 6 | grep/glob/list with a path outside the root | **pass** | `glob path=/vaults/b`, `grep path=/vaults/b`, `grep path=/vaults` → all denied. `glob pattern=../b/*.md` → "No files found". 1.18 has **no `list` tool** (only glob/grep/read). |
| 7 | Global Claude lookups off, empty `$HOME` → only the vault's AGENTS.md/CLAUDE.md + `.claude/skills` | **pass with amended env** (no DISABLE flags) | Captured the LLM requests (socat tap). Vault a → `Instructions from: /vaults/a/AGENTS.md`. Vault c (only `CLAUDE.md`) → `/vaults/c/CLAUDE.md`. `opencode debug skill` in a → `vault-hello` (from `/vaults/a/.claude/skills`) + built-in `customize-opencode`. With both DISABLE flags: c's CLAUDE.md and `vault-hello` **disappear** (see failure 2). |
| 8 | Restart with the data volume → session listed + resumable | **pass** | Container **removed and recreated** with the same data mount: the session is still listed, has 8 messages, and a new prompt answered from earlier context ("AI WAS HERE"). |

Extra findings (not in the plan, verified):

| Finding | Evidence | Consequence |
|---|---|---|
| Symlink escape | `read /vaults/a/link-to-b/secret-b.md` (symlink → `../b`) **completed**. The containment check is lexical. | The backend clones with `-c core.symlinks=false` (symlinks check out as plain text files) or rejects symlinks that leave the root. The AI can't create symlinks (no bash). |
| Config / plugin injection by the AI | `vault` agent `write` to `opencode.json`, `sub/opencode.jsonc`, `.opencode/plugins/x.js`, `.git/hooks/pre-commit` → all denied by the edit guards in the config. | Without the guards, the AI could plant a plugin (arbitrary code in opencode) or a git hook (code in the **backend**, which holds the GitHub token). |
| Project identity | With git discovery, `projectID` = hash of the git remote. Sessions from the git phase **vanished** from `GET /session?directory=…` once discovery stopped (the list filters on `project_id`). | In no-git mode every session is `projectID:"global"`, filtered by directory only, and stable across repo changes (as §2.3 wants). Another reason opencode must not see a git repo. |
| Vault pollution | No files written into vault dirs (`find` for `.opencode`, `.gitignore`, `opencode*` is empty; `git status` clean). With git discovery, opencode writes `.git/opencode` (project ID cache), which is not visible in `git status`. | None. |
| Instruction lookup walks up past the vault root | Subfolder vault `repo/sub` got `Instructions from: /vaults/repo/CLAUDE.md`. In no-git mode the walk stops at `/`; skill dirs (`.claude/skills`, `.agents/skills`) walk up the same way. | Matches mvp §4 ("walking up from the vault root"). Never put `AGENTS.md`/`CLAUDE.md`/`.claude/` in `/vaults` or `/`. |
| Formatters | Edit tools run `format.file()` on every edited file. | `formatter: false` (else e.g. prettier would reformat Markdown → diff noise). `lsp: false` too. |
| Provider retries | A retryable provider error (HTTP 500) was retried for ~107 s (`session.status` `{type:"retry", attempt, message, next}`) before `session.error`. | The backend's timeouts (commit message 15 s) must not rely on opencode failing fast. Map `retry` to a UI state. |

## Deployment facts

- **Command:** `opencode serve --hostname 0.0.0.0 --port 4096` (the image entrypoint is
  `opencode`, so compose `command: ["serve","--hostname","0.0.0.0","--port","4096"]`). It prints
  "OPENCODE_SERVER_PASSWORD is not set; server is unsecured". That's acceptable because the
  port is only reachable on the compose network. `GET /global/health` →
  `{"healthy":true,"version":"1.18.25"}` (use it for the compose healthcheck).
- **Image:** Alpine, contains `opencode` (a single Bun binary) and `rg`. **No git, bash,
  python.** Runs as **root** by default (no `USER`).
- **Run as a given UID:** `user: "1000:1000"` works (verified) if:
  - `HOME` is writable, e.g. `HOME=/home/opencode` on a tmpfs (`uid=1000,gid=1000`). opencode
    creates `~/.local/state/opencode` (locks), `~/.cache/opencode` (`models.json`, `bin/`), and
    `~/.config/opencode/opencode.jsonc` (an empty default). An empty tmpfs HOME is also what
    keeps `~/.claude` out.
  - **Data path:** set `XDG_DATA_HOME=/data` and mount the **opencode-data volume at `/data`**
    (owned by that UID). The DB is `/data/opencode/opencode.db` (+ `-wal`/`-shm`), with logs
    at `/data/opencode/log/`, tool output at `/data/opencode/tool-output/`, and some empty
    `/data/{log,repos}`. Mounting at `~/.local/share/opencode` under a tmpfs HOME fails
    (`EACCES mkdir ~/.local/state`, because docker creates `~/.local` as root).
- **Config:** mount [`deploy/opencode/opencode.json`](../../deploy/opencode/opencode.json) read-only at
  **`/etc/opencode/opencode.json`**. That is opencode's *managed* config dir on Linux. It is
  merged **last**, after global, `OPENCODE_CONFIG`, project `opencode.json` and `.opencode/`, so
  a vault's own `opencode.json` can't override our keys. It can still *add* keys (plugins, MCP,
  agents), which is why the AI can't write those files.
- **Env:** provider keys (e.g. `ANTHROPIC_API_KEY`), `OPENCODE_MODEL=<provider>/<model>`
  (fills `model`/`small_model` in the config), `HOME`, `XDG_DATA_HOME`. **Do not** set
  `OPENCODE_DISABLE_CLAUDE_CODE*`. `OPENCODE_DISABLE_AUTOUPDATE=1` is harmless
  (`autoupdate:false` is in the config already).
- Env flag semantics (source `runtime-flags.ts`, `instruction.ts`, `skill/index.ts`):
  `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` drops `~/.claude/CLAUDE.md` **and** project
  `CLAUDE.md`. `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` drops `~/.claude/skills` **and** project
  `.claude/skills`. `OPENCODE_DISABLE_CLAUDE_CODE` = both. `OPENCODE_DISABLE_EXTERNAL_SKILLS`
  also drops `.agents/skills`. `OPENCODE_DISABLE_PROJECT_CONFIG` drops project
  `opencode.json`/`.opencode/` **and** project AGENTS.md/CLAUDE.md, so it's not usable for us.
- **Egress:** at startup opencode fetches the models.dev catalog (`~/.cache/opencode/models.json`).
  Keep that in mind if the container's network is ever restricted.

## Config decisions (`deploy/opencode/opencode.json`)

- Top-level `permission`: `external_directory`, `bash`, `webfetch`, `websearch`, `task`,
  `question`, `doom_loop` → `deny`; `read` allow except `*.env`/`*.env.*` → deny.
  opencode evaluates the **last matching rule** (built-in defaults first, then the top level,
  then the agent), and `*` matches `/` too.
- `vault`: `edit` = `{"*":"allow", "*.git":"deny", "*.git/*":"deny", "*opencode.json":"deny",
  "*opencode.jsonc":"deny", "*.opencode/*":"deny"}`. The guards must sit **in the agent**,
  because an agent-level `edit: allow` would override top-level denies. Edit patterns are paths
  relative to the worktree (`/` in no-git mode, e.g. `vaults/a/.git/hooks/x`).
- `vault-readonly`: `edit: deny`. `commit-message`: `"*": "deny"` + a short prompt.
- `default_agent: vault-readonly` (a prompt without `agent` fails safe). `build`/`plan` disabled.
- `snapshot:false`, `formatter:false`, `lsp:false`, `share:"disabled"`, `autoupdate:false`.
- A tool whose last matching rule is a blanket `"*": "deny"` is **removed from the model's
  tool list** (`Permission.disabled`). For those tools no "denied" event exists at all.

## API reference for the backend (opencode 1.18.25)

SDK: **`@opencode-ai/sdk@1.18.25`** (npm latest is 1.18.32, so pin it). Use the **v2 client**
(`import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"`). The root/v1 export is
generated from an older spec (path param `id`, and it lacks `roots`, session `permission`,
`format`, …). `createOpencodeClient({ baseUrl: "http://opencode:4096", directory })` adds
`x-opencode-directory` (and `?directory=` on GETs). The backend can also make one client and pass
`directory` per call. Every route takes `?directory=<vault root>`.

| Purpose | HTTP | v2 SDK |
|---|---|---|
| Health | `GET /global/health` | `global.health()` |
| Create session | `POST /session?directory=D` body `{title?, agent?, model?:{id,providerID}, permission?, parentID?}` → `Session` | `session.create({directory, title})` |
| List chats | `GET /session?directory=D&roots=true&limit=N` (exact directory match, newest `time.updated` first, default limit 100). Child sessions have `parentID`; `roots=true` drops them | `session.list({directory, roots:true})` |
| Get session | `GET /session/:id?directory=D` (404 `NotFoundError` if missing) | `session.get` |
| Messages | `GET /session/:id/message?directory=D` → `[{info: Message, parts: Part[]}]` | `session.messages` |
| Prompt, async | `POST /session/:id/prompt_async?directory=D` body `{agent, model:{providerID, modelID}, parts:[{type:"text", text}]}` → **204** immediately | `session.promptAsync` |
| Prompt, sync | `POST /session/:id/message?directory=D` (same body) → `{info, parts}` when the turn ends (use for commit-message) | `session.prompt` |
| Busy sessions | `GET /session/status?directory=D` → `{ "<sessionID>": {type:"busy"} }` (idle sessions omitted, `{}` = none busy) | `session.status` |
| Abort | `POST /session/:id/abort?directory=D` → `true` | `session.abort` |
| Delete | `DELETE /session/:id?directory=D` → `true` | `session.delete` |
| Children | `GET /session/:id/children?directory=D` | `session.children` |
| Events, one vault | `GET /event?directory=D` (SSE, `data: {id, type, properties}`) — **per directory**: a turn in B produced 0 events on A's stream | `event.subscribe({directory})` |
| Events, all vaults | `GET /global/event` (SSE, `data: {directory, project, payload:{id,type,properties}}`) | `global.event()` |

**Model per prompt:** `model: {providerID, modelID}` on `prompt_async`/`prompt` (e.g.
`{"providerID":"anthropic","modelID":"claude-sonnet-5"}`), split from the server-wide
`provider/model` setting at the first `/`. It is recorded on the user message and the session
(`session.model`). **Agent per prompt:** `agent` on the same body. It applies per prompt, even
within one session.

### Event shapes (trimmed, real captures)

```jsonc
// turn start / end. session.status is authoritative; session.idle is deprecated but still sent after idle
{"type":"session.status","properties":{"sessionID":"ses_…","status":{"type":"busy"}}}
{"type":"session.status","properties":{"sessionID":"ses_…","status":{"type":"retry","attempt":1,"message":"…","next":1790…}}}
{"type":"session.status","properties":{"sessionID":"ses_…","status":{"type":"idle"}}}
{"type":"session.idle","properties":{"sessionID":"ses_…"}}

// assistant message (finish: "tool-calls" | "stop"; error on failure/abort)
{"type":"message.updated","properties":{"sessionID":"ses_…","info":{"id":"msg_…","role":"assistant",
  "agent":"vault-readonly","providerID":"ollama","modelID":"qwen2.5:3b","path":{"cwd":"/vaults/a","root":"/"},
  "tokens":{…},"cost":0,"time":{"created":…,"completed":…},"finish":"stop"}}}

// text streaming: part created (empty), then deltas, then the final part with full text
{"type":"message.part.updated","properties":{"sessionID":"ses_…","part":{"id":"prt_…","messageID":"msg_…","type":"text","text":"","time":{"start":…}}}}
{"type":"message.part.delta","properties":{"sessionID":"ses_…","messageID":"msg_…","partID":"prt_…","field":"text","delta":" found"}}
{"type":"message.part.updated","properties":{"part":{"id":"prt_…","type":"text","text":"I found the following …","time":{"start":…,"end":…}}}}

// tool part lifecycle (same part id, status pending → running → completed | error)
{"type":"message.part.updated","properties":{"part":{"type":"tool","tool":"glob","callID":"call_…","id":"prt_…",
  "state":{"status":"pending","input":{},"raw":""}}}}
{"type":"message.part.updated","properties":{"part":{"type":"tool","tool":"glob",
  "state":{"status":"running","input":{"pattern":"**/*.md"},"time":{"start":…}}}}}
{"type":"message.part.updated","properties":{"part":{"type":"tool","tool":"glob",
  "state":{"status":"completed","input":{"pattern":"**/*.md"},"output":"/vaults/a/AGENTS.md\n…",
           "metadata":{"count":3,"truncated":false},"title":"vaults/a","time":{"start":…,"end":…}}}}}

// DENIED tool call = tool part with status "error" and this error prefix (no separate permission event)
{"type":"message.part.updated","properties":{"part":{"type":"tool","tool":"grep",
  "state":{"status":"error","input":{"pattern":"SECRET","path":"/vaults/b"},
           "error":"The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules [...]"}}}}
// (other tool errors, e.g. schema errors, also use status "error"; detect "denied" by that prefix)

// edit / write (non-GPT-5 models): absolute path in state.input.filePath
{"part":{"type":"tool","tool":"write","state":{"status":"completed","input":{"filePath":"/vaults/b/escaped.md","content":"ESCAPED"},
  "output":"Wrote file successfully.","metadata":{"filepath":"/vaults/b/escaped.md","exists":false},"title":"vaults/b/escaped.md"}}}
{"part":{"type":"tool","tool":"edit","state":{"status":"completed","input":{"filePath":"/vaults/a/alpha-two.md","oldString":"Alpha two","newString":"Alpha two (edited)"},
  "output":"Edit applied successfully.","metadata":{"diff":"Index: …","filediff":{"file":"/vaults/a/alpha-two.md","additions":1,"deletions":1}}}}}
// apply_patch (models whose id contains "gpt-" but not "gpt-4"/"oss", e.g. gpt-5*) — from source, not live-tested:
//   state.input.patchText; state.metadata.files[] = {filePath, relativePath, type:"add"|"update"|"delete"|"move", movePath?, additions, deletions}

// tool-agnostic file events, emitted by edit/write/apply_patch (no sessionID; per directory stream)
{"type":"file.edited","properties":{"file":"/vaults/a/alpha-two.md"}}
{"type":"file.watcher.updated","properties":{"file":"/vaults/a/new-from-ai.md","event":"add"}}   // add | change | unlink

// failures and abort (followed by session.status idle)
{"type":"session.error","properties":{"sessionID":"ses_…","error":{"name":"APIError","data":{"message":"…","statusCode":403,"isRetryable":false}}}}
{"type":"session.error","properties":{"sessionID":"ses_…","error":{"name":"MessageAbortedError","data":{"message":"Aborted"}}}}

// subagent session (only if task were allowed)
{"type":"session.created","properties":{"info":{"id":"ses_child","parentID":"ses_parent","agent":"general","title":"… (@general subagent)"}}}
```

Other types seen on the stream: `server.connected` (first event), `server.heartbeat`,
`session.updated`, `session.diff` (`diff: []` with snapshots off), `catalog.updated`,
`integration.updated`, `plugin.added`, `reference.updated`. Ignore them.

**AI-touched set:** subscribe per vault to `/event?directory=<root>`. Add
`properties.file` from every `file.edited` event (covers `edit`, `write` and `apply_patch`, no
tool-name switch needed, absolute path). A cross-check alternative is completed tool parts:
`edit`/`write` → `state.input.filePath`, `apply_patch` → `state.metadata.files[].filePath`/`movePath`.
Relativize against the vault root.

**Turn done / lock release:** `session.status` with `status.type == "idle"` for the root
session. After an abort the order is `session.error` (MessageAbortedError) → `session.status idle`.
On backend startup, `GET /session/status?directory=<root>` = `{}` means no busy session.

## Spec amendments needed

- **mvp §3.2 Harness hardening:**
  - Replace "`OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` and `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`"
    with "empty tmpfs `$HOME` (no `~/.claude`, `~/.agents`, `~/.config/opencode/AGENTS.md`);
    the DISABLE flags are **not** set because they also disable the vault's `CLAUDE.md` and
    `.claude/skills`".
  - Add `permission.task: deny` (subagents escape `vault-readonly`), `doom_loop: deny`,
    `question: deny`, `read *.env: deny` (these replace built-in `ask` defaults), and
    `websearch: deny`.
  - Add the `vault` agent's edit guards (`.git`, `opencode.json(c)`, `.opencode/`) and the reason
    (plugin/hook injection → code execution in opencode or the backend).
  - Add `formatter:false`, `lsp:false`, `default_agent: vault-readonly`, and "config mounted at
    `/etc/opencode/opencode.json` (managed config, highest precedence)".
  - Note that blanket-denied tools are hidden from the model; "denied" chips only appear for
    pattern-level denies (tool part `status:"error"`, error text prefix above).
- **mvp §2.5 / §3.2 opencode image:** the MVP runs the stock image **without git** (a
  precondition for subfolder confinement and a stable `projectID`). Skill deps (Python, …) come
  in M5. If git goes into the image then, the backend must first move git dirs off the vaults
  volume (`--separate-git-dir`, backend-only `/git` volume), and re-run spike row 3.
- **mvp §2.5 volumes:** opencode data volume at `/data` with `XDG_DATA_HOME=/data`, not
  `~/.local/share/opencode`. `HOME` on a tmpfs. Both owned by the shared `user:` UID/GID.
- **mvp §3.2 File API / clone:** clone with `-c core.symlinks=false` (symlinks would bypass
  `external_directory`, verified). Consider warning when a vault repo contains
  `opencode.json`/`.opencode/`, because a vault's own project config can add plugins/MCP.
- **mvp §6 open question:** answered. `external_directory: deny` confines tools to a subfolder
  root **as long as opencode doesn't detect the git worktree** (no git binary, or git dir not
  visible). The fallback "repo root only" is not needed.
- **mvp §2.4 AI-touched set:** use `file.edited` events (tool-agnostic). GPT-5-family models
  edit via `apply_patch`, not `edit`/`write`.
- **mvp §3.2 chat list:** `GET /session?directory=<root>&roots=true` (plus an explicit `limit`,
  default 100).
- **implementation-decisions #3:** the OpenAI key can't run any current model (account
  inactive, no gpt-4.1/gpt-5 access). `@llm` tests need another key, or a local Ollama model
  (worked here; qwen2.5:3b on CPU, ~2–30 s per turn, weak but it makes the requested tool calls).

## Spike harness (not committed, `tmp/spike/`)

- `run.sh [image] [docker args]`: starts `kai-spike-oc` (user 1000:1000, tmpfs HOME,
  `XDG_DATA_HOME=/data`, managed config mount, `/vaults` bind, port `127.0.0.1:4096`). The
  Ollama provider is injected via `OPENCODE_CONFIG_CONTENT` (spike only).
- `turn.py DIR AGENT MODEL "prompt" [--session ID]`: creates a session, subscribes
  `/event?directory=`, calls `prompt_async`, waits for idle, prints tool parts and text, and
  writes `events.jsonl`.
- `ev-*.jsonl`: the raw event captures behind the table above. `src/`: opencode source at `v1.18.25`.
