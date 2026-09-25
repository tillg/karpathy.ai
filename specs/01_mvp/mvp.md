# MVP — karpathy.ai

A mobile-friendly web app that unites a Markdown vault (Obsidian'ish) with an AI dialog over the same vault.

---

## 1. Goals & Non-Goals

### Goals

From iPad/phone (and desktop browser):

- manage several **vaults**, each one a GitHub repo, from an admin area in the app;
- search, read, and edit the active vault;
- talk to an AI about the vault that can **read, write, and ingest** into it;
- use the existing wiki skills (`ingest`, `lint`, `query`, `timeline`, …) —
  **unchanged** where possible.

### Non-Goals (MVP)

- Don't rebuild Obsidian 1:1 (no graph view, no plugins, no canvas) - for now 😉
- No multi-user, no real-time collaboration. **Single-user.**
- No custom sync protocol — git remains the source of truth.
- No offline AI 

---

## 2. Key Decisions

### 2.1 Agentic loop: opencode, not self-built — provider-agnostic

**Decision: [opencode](https://github.com/anomalyco/opencode)** (MIT, TypeScript on Bun)
as the agent harness, run headless via `opencode serve` (HTTP server, OpenAPI 3.1) and
driven from the backend with the JS SDK `@opencode-ai/sdk`. Goal: **no lock-in to a
single LLM provider.** It provides for free:

- agentic loop, tool calling, streaming (SSE event stream with message + tool parts);
- **75+ providers** via Vercel AI SDK / models.dev (Anthropic, OpenAI, Google,
  OpenRouter, Ollama, …) — the model is a config value, not an architecture decision;
- **built-in file tools** (read/edit/write/grep/glob, plus bash/LSP) → these already are
  the "tools to search/edit the `.md` files"; working dir = vault directory;
- **skills (`SKILL.md`), `AGENTS.md` (falls back to `CLAUDE.md`), MCP, subagents,
  plugins, permission API** — it also reads `.claude/skills`, so the existing wiki
  skills should run largely unchanged.

→ **Neither loop nor tools nor skills** get reimplemented. Only frontend + thin
backend.

**Hedge:** keep the backend↔harness boundary small and ACP-shaped
(session / prompt / update / tool_call / permission events), so opencode could later be
swapped for another harness (e.g. via the Agent Client Protocol: pi, Goose,
claude-agent-acp) without touching the frontend.

**Rejected alternatives:** Claude Agent SDK (proprietary, Claude-tuned; other models only
via proxy), pi (lean, but MCP/permissions only via extensions), Mastra / deepagents-js
(more to build ourselves), Gemini CLI / Crush (licensing/support).

### 2.2 Markdown editor: CodeMirror 6 (default)

**Decision: CodeMirror 6**, not Milkdown/ProseMirror.

Rationale (git-diffable vault that the AI also edits):

- CodeMirror 6 edits the **raw Markdown text**, live preview via decorations over
  the text → **lossless round-trip**, clean git diffs, no fight with AI edits.
  (Obsidian itself is built on CM6 for exactly this reason.)
- Milkdown/ProseMirror is WYSIWYG and re-serializes on save → risk of formatting
  normalization on every save (list markers, emphasis, table padding) and thus diff
  noise + conflicts with the AI's raw edits. Frontmatter and wikilinks would need
  their own ProseMirror nodes to survive the round-trip.

**Optional alternative (not MVP):** Milkdown, *if* true WYSIWYG becomes more important
than clean diffs — then mandatory: `prettier --parser markdown` as a save/commit hook on
**both** sides (human and AI), so that formatting is deterministic.

### 2.3 Data model: vault = GitHub repo; sync = git

- The system is **one web app**. The content it works on are **vaults**.
- **A vault is a GitHub repo.** The app holds no vault content of its own. GitHub is the
  source of truth.
- **Admin area** (in the app, same single user): add, edit and remove vaults. Per vault the
  user sets: display name, repo (`owner/name`), branch, and optionally a subfolder as
  vault root. On "add", the backend clones the repo; on "remove", it deletes the local
  clone (never the GitHub repo).
- The user picks the **active vault** in the UI. Every file, search and chat operation is
  scoped to one vault.
- The vault list lives in a small config store (JSON file or SQLite) on a backend-only
  **config volume**. The config is not part of any vault.
- **Credentials:** for the MVP, one GitHub token (compose secret, backend only) with
  access to all configured repos (fine-grained PAT or GitHub App installation). Per-vault
  tokens are a later option, not MVP.

Sync: the backend pulls a vault before a session, commits after human/AI edits, and
pushes to GitHub. Obsidian mobile/desktop are attached to the same remotes. No second
sync system.

### 2.4 Runtime: docker compose (dev and prod)

**Decision:** the whole stack runs as one docker compose project, in development as well as in
production. It has three services:

- **proxy** (Caddy): auto-TLS; serves the PWA build and proxies `/api` → backend. This is the
  **only** service that publishes ports.
- **backend** (Node/TS): file API, search, git, auth, chat relay.
- **opencode** (pinned image tag): `opencode serve`. Its image holds the skill dependencies
  (Python + deps, ripgrep, git).

The vault clones live in a shared **compose volume** (`/vaults/<vault-id>/`) that both
backend and opencode mount read-write. Each vault's `AGENTS.md`/`CLAUDE.md` and
`.claude/skills` come along with its clone. The admin config lives in a separate volume
that only the backend mounts. Backend and
opencode run with the **same `user:` (UID/GID)** so that files written by opencode stay
committable by the backend (otherwise git fails with "dubious ownership" or files become
unwritable).

Secrets come from compose secrets / env files and each goes only to the service that needs it:

| Secret | Service |
|---|---|
| provider API keys | opencode |
| GitHub token / deploy key | backend |
| user bearer token | backend |

**Dev:** the same compose file plus a dev override that bind-mounts the sources for hot
reload (Vite HMR, backend watch mode). Nothing runs natively. The local Docker engine is
Rancher Desktop.

---

## 3. Architecture

```
┌─ Frontend (PWA, installable on the iPad home screen) ────────┐
│  Vault switcher · File tree · Editor (CM6) · Search · Chat   │
│  Admin area: configure vaults (GitHub repos)                 │
└──────────────┬───────────────────────────────────────────────┘
               │ HTTPS + streamed fetch/WebSocket (chat stream)
┌──────────────┴──── Proxy (Caddy, auto-TLS, only public port) ─┐
│  serves PWA static build · /api → backend                    │
└──────────────┬────────────────────────────────────────────────┘
┌──────────────┴──────────── Backend (Node/TS) ────────────────┐
│  • Vault admin API + config store (list of GitHub repos)     │
│  • File API: list / read / write / search, per vault         │
│  • opencode client: session / prompt / SSE events            │
│  • git: commit / push / pull  → keeps Obsidian sync coherent │
│  • holds GitHub credentials (NEVER in opencode/frontend)     │
│  • Auth: single-user token middleware on every /api route    │
└──────────────┬────────────────────────────────────────────────┘
               │ HTTP + SSE (internal compose network only)
┌──────────────┴──── opencode serve (container, dir = vault) ───┐
│  agentic loop · file tools · skills / AGENTS.md / MCP        │
│  holds provider API keys                                     │
└──────────────┬────────────────────────────────────────────────┘
       ┌────────┴────────┐
   Vaults = clones of GitHub repos   LLM provider(s)
   (/vaults/<id>, compose volume) (Anthropic, OpenAI, OpenRouter, Ollama, …)
   ↕ push/pull GitHub  ← Obsidian mobile/desktop attach here too
```

### 3.1 Frontend

- **Stack:** Vite + TypeScript; UI framework open (React/Svelte/Solid — author chooses).
- **PWA:** installable on the iOS home screen; offline cache for reading/editing.
- **Vault switcher:** always visible. It selects the active vault that the panels below
  work on.
- **Admin area:** list of vaults with add/edit/remove and clone/pull status.
- **Panels (mobile: tabs; desktop: split):**
  - **File tree / list** of the vault, with folders.
  - **Editor** (CodeMirror 6) with Markdown mode, frontmatter detection,
    `[[wikilink]]` decoration + click navigation, in-document search.
  - **Search** across the vault (backend `ripgrep` or JS index).
  - **Chat** with streaming responses; shows which files the AI is currently
    reading/changing; "open the changed page" action.

### 3.2 Backend

- **Stack:** Node/TS; talks to the opencode container via `@opencode-ai/sdk`
  (`createOpencodeClient()` against `http://opencode:<port>`). It does not spawn opencode,
  because compose owns the lifecycle.
- **Vault admin API (REST):**
  - `GET /vaults` — list configured vaults.
  - `POST /vaults` — add a vault (repo, branch, optional root) → clone.
  - `PATCH /vaults/:id` — edit its settings.
  - `DELETE /vaults/:id` — remove the local clone and its config entry.
- **File API (REST), scoped per vault:**
  - `GET /vaults/:id/files` — tree/list.
  - `GET /vaults/:id/file?path=` — content.
  - `PUT /vaults/:id/file?path=` — write.
  - `GET /vaults/:id/search?q=` — ripgrep over the vault.
  - Paths are resolved inside the vault root; reject anything that escapes it (`..`,
    symlinks).
- **Chat API:** `POST /vaults/:id/chat` starts/continues an opencode session, response as
  a streamed `fetch` response or WebSocket (proxied/mapped from opencode's event stream); tool calls
  (read/edit/grep) run inside opencode against that vault. A chat session belongs to
  exactly one vault. One opencode server serves all vaults; each session is created with
  the vault's directory as its project directory (the opencode server API takes a
  per-request `directory`, which needs verifying in M3). Fallback: one opencode container
  per vault.
- **Harness hardening:** the opencode container publishes no port and is reachable only on
  the internal compose network. Pin the opencode image tag (the server API moves fast).
  Restrict tools via opencode permissions: deny access outside the session's vault
  (`external_directory`), which also blocks cross-vault access, restrict/deny `bash`, and deny `git push` in particular. opencode
  never gets GitHub credentials.
- **git:** only the backend runs git operations. It commits after AI or human edits; auto-push configurable; pull before
  session start to fetch Obsidian changes.
- **Secrets/auth:** provider API keys server-side only (opencode service env); see §2.4.
  A single-user bearer token protects all endpoints (the host holds API keys **and** a
  private life wiki):
  - Checked in **one backend middleware** in front of every `/api` route (`/vaults/*`,
    including the admin routes), using a constant-time compare against the secret. The check lives in
    the backend, not the proxy, so there is one rule and it is testable.
  - The PWA's static assets are public (they are only the app shell). The token is entered
    once and stored on the device.
  - Sent as `Authorization: Bearer …`. The native `EventSource` cannot set headers, so chat
    streams via `fetch` + `ReadableStream` (or a WebSocket that authenticates with its first
    message). **Never put the token in the URL**, because it ends up in logs.
  - opencode needs no token check because nothing outside the compose network can reach it.

### 3.3 Hosting

- Small always-on host that runs docker compose: existing Mac mini **or** a VPS. Single-
  container PaaS setups (e.g. Fly.io) don't fit the compose model.
- HTTPS mandatory (PWA + token) via the Caddy proxy service with auto-TLS (§2.4).

---

## 4. Skills Portability — Breaking Points

The wiki skills run via opencode (which reads `SKILL.md` incl. `.claude/skills`), but
some dependencies are Mac-local and must be
available in the opencode image (or the skill gets adapted):

- **RTK hook** (`git status` → `rtk git status`): dropped, pure terminal convenience —
  must not be a prerequisite for any skill.
- **Python scripts** (`film-import.py`, `serien-import.py`, `reel-film-extract.py`,
  `normalize-film-frontmatter.py`): need Python + deps in the opencode image.
- **Network + credentials:** `ingest-email` (Gmail label `MyLife`), `instascraper`/
  Instagram resolver — need secrets (compose secrets, opencode service) and network access
  server-side.
- **Project config:** `Schema/CLAUDE.md` + `Schema/methodology.md` + `categories.md`
  are already in the repo → portable. opencode reads `AGENTS.md` (falls back to
  `CLAUDE.md`) — verify which files it picks up in the vault. The global
  `~/.claude/CLAUDE.md` does **not** travel along; anything relevant must be
  project-scoped in the repo (or in the opencode config).
- **Claude-specific skill features:** skills written for Claude Code may reference
  Claude Code tool names or frontmatter fields — check each skill under opencode and
  with non-Claude models (tool-calling quality varies a lot by model).

---

## 5. Milestones

1. **M0 — Scaffold:** repo, docker compose stack (proxy + backend + opencode + vaults and
   config volumes,
   dev override with hot reload), backend skeleton (Node/TS), frontend skeleton (Vite/PWA),
   auth-token middleware, local HTTPS via Caddy.
2. **M1 — Vaults + read:** admin area (add/remove vault = clone GitHub repo), vault
   switcher, file API (list/read) + file tree + CM6 viewer. Pull on open.
3. **M2 — Edit the vault:** CM6 editor with save → `PUT /file` → git commit;
   wikilink navigation; search (`ripgrep`).
4. **M3 — AI dialog:** opencode container (cwd = vault) driven by the backend, streaming chat;
   AI can Read/Grep (read-only) → frontend shows consulted files.
5. **M4 — AI writes:** Edit tool enabled; AI edits get committed + optionally pushed;
   "open changed page".
6. **M5 — Skills:** existing wiki skills available in the session; at least `query`
   and `lint` usable on mobile; breaking points from §4 checked off per skill.

MVP boundary = **M4** (chat that can read and write configured vaults, mobile, git-synced).
M5 (full skills) is the first extension after that.

---

## 6. Open Questions

- Hosting: Mac mini vs. VPS for the compose stack? (The skill deps now live in the image,
  so the choice comes down to uptime, network access and cost.)
- Vault admin: also *create* a new GitHub repo from the app, or only attach existing ones?
  (MVP: attach only.)
- Session model: one long agent session per chat, or a fresh one per message? (Cost vs.
  context.)
- Conflict handling when Obsidian mobile and the app change the same file (git merge in
  the backend vs. user prompt).
- Default model/provider for the MVP, and which models are good enough at tool calling
  for the wiki skills?
- Does the MVP already need a rendered reading view next to the editor, or is CM6
  live preview enough?
