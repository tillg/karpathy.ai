# MVP — karpathy.ai

A mobile-friendly web app that unites a Markdown vault (Obsidian'ish) with an AI dialog over the same vault.

Terms (vault, chat, turn, uncommitted change, commit, conflict, …) are defined in
[`CONTEXT.md`](../../CONTEXT.md).

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
- No offline AI, no offline editing (offline = read-only cache).
- No creating GitHub repos from the app — only attaching existing ones.

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
  the "tools to search/edit the `.md` files"; working dir = vault root;
- **skills (`SKILL.md`), `AGENTS.md` (falls back to `CLAUDE.md`), MCP, subagents,
  plugins, permission API** — it also reads `.claude/skills`, so the existing wiki
  skills should run largely unchanged.

→ **Neither loop nor tools nor skills** get reimplemented. Only frontend + thin
backend.

**Model:** one server-wide setting; default **Claude Sonnet 5**. No per-vault or per-chat
model choice in the MVP.

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

Notes open in **Write mode** (CM6 with live preview) by default; the user can switch a
note to **Read mode** (rendered, non-editable).

**Optional alternative (not MVP):** Milkdown, *if* true WYSIWYG becomes more important
than clean diffs — then mandatory: `prettier --parser markdown` as a save/commit hook on
**both** sides (human and AI), so that formatting is deterministic.

### 2.3 Data model: vault = GitHub repo; sync = git

- The system is **one web app**. The content it works on are **vaults**.
- **A vault is a GitHub repo.** The app holds no vault content of its own. GitHub is the
  source of truth.
- **Admin area** (in the app, same single user): add, edit and remove vaults. Per vault the
  user sets: display name, repo (`owner/name`), branch, and optionally a subfolder as
  **vault root**. On "add", the backend clones an existing repo (no repo creation); on
  "remove", it deletes the local clone (never the GitHub repo). Removing is **blocked
  while the vault has uncommitted changes** — commit or discard first.
- **Cloning is async:** "add" returns right away with state `cloning`, which then becomes
  `ready` or `clone-failed` (with the git error; retry = remove + add).
- **Editing a vault** (`PATCH`):
  - **display name:** always allowed.
  - **repo, branch, vault root:** only when there are no uncommitted changes and no
    unpushed commits (else 409). Changing the **repo** deletes the clone and re-clones it
    (async, as for add). Changing the **branch** = fetch + checkout of the new branch.
    Changing the **root** is config-only; the folder must exist in the clone.
  - Past chats are bound to the vault root directory (§3.2): changing the root hides them;
    changing the repo keeps them listed, but they refer to the old content. Accepted for
    the MVP.
- The user picks the **active vault** in the UI. Every file, search and chat operation is
  scoped to one vault.
- The vault list and app settings (e.g. commit-reminder threshold, model) live in a small
  config store (JSON file or SQLite) on a backend-only **config volume**. The config is
  not part of any vault.
- **Credentials:** for the MVP, one GitHub token (compose secret, backend only) with
  access to all configured repos (fine-grained PAT or GitHub App installation). Per-vault
  tokens are a later option, not MVP.

### 2.4 Change & commit model: the user commits, the AI never does

See [ADR 0001](../../docs/adr/0001-user-triggered-commits.md).

- **Edits land in the vault's working tree on the server, uncommitted.** The editor
  autosaves (debounced, ~1.5 s) via `PUT /file`; the AI writes directly via its file
  tools. Human and AI changes pool together as **uncommitted changes**, visible to the AI
  and across devices.
- The UI always shows the **number of uncommitted (changed) files** of the active vault
  and a "Show changes" view (per-file diff).
- **Commit is user-triggered and always = commit + push**, covering *all* uncommitted
  changes of the vault (no file picking). The AI proposes a commit message from the diff;
  the user can edit it. Author = the user; a `Co-authored-by:` agent trailer is added when
  AI changes are included. The AI never commits or pushes.
  - **Commit message proposal:** the model runs through opencode, not a second LLM
    client, because only opencode holds provider keys. The backend creates a throwaway session with
    the agent `commit-message` (every tool denied) and prompts it with the diff (file list +
    stat, plus the full diff truncated to 32 KB). It then **deletes the session**, so the
    chat list stays clean. The proposal doesn't take the vault lock (it touches no files).
    If it fails or takes more than 15 s, the dialog falls back to "Update N files", still
    editable.
  - **"AI changes are included"** is tracked, not guessed. The backend watches opencode's
    events for completed `edit`/`write` tool calls in the vault and adds their paths to a
    per-vault **AI-touched set**, persisted on the config volume. Discard removes the path;
    commit clears the set. The trailer is added iff at least one path in the set is among
    the committed changes.
- **Commit reminder:** when the count of changed files exceeds a threshold (global
  setting, default **4**), a dialog reminds the user and offers a Commit button right
  there. After dismissing, it reappears only once the count reaches twice the threshold.
- **Undo:** per-file **Discard** in "Show changes" restores the file from the last commit.
  There is no per-turn undo; opencode's internal snapshots are disabled
  (`snapshot: false`) so nothing rewrites files behind the backend's back.
- **Stale save:** every `PUT /file` carries the version (content hash / ETag) the editor
  loaded. If the file changed since (AI edit, pull), the backend answers **409** and the
  editor offers reload / overwrite. If the AI changes a file that is open **without**
  unsaved changes, the editor reloads silently and shows a short notice.
- **Live vault status:** the frontend learns about changes it didn't make itself (AI edits,
  pulls, other devices) through the vault's **event stream** (`GET /vaults/:id/events`,
  §3.2), not by polling:
  - The backend watches the vault root with a file watcher (inotify; `.git/` excluded,
    debounced 300 ms). This catches AI, human and pull writes alike, because all of them
    hit the same volume.
  - It emits `files-changed` (paths + new versions) and `status` (vault state,
    changed-files count, unpushed count, busy = turn / sync / none).
  - Every (re)connect starts with a full `status` snapshot. The PWA reconnects on
    `visibilitychange`, since iOS kills streams when the app is in the background.
  - The editor, the changed-files counter and the commit reminder all react to these
    events.
- **Pull:** when a vault is opened, when a chat's turn starts, and right before every
  commit. Obsidian mobile/desktop share the same remotes; no second sync system. The
  backend runs explicit steps instead of `git pull --rebase --autostash`, so there is only
  one way to end up in a Conflict:
  1. `git fetch`. If upstream has not moved: push any unpushed commits, done.
  2. If there are unpushed commits: `git reset --mixed $(git merge-base HEAD @{u})`. Their
     changes become uncommitted changes again; their messages are dropped (the next commit
     re-records them). No rebase, so no mid-rebase state ever exists.
  3. If there are uncommitted changes: `git stash push --include-untracked -m
     karpathy-ai-pull`.
  4. `git merge --ff-only @{u}` (always a fast-forward after steps 2–3).
  5. `git stash pop`. Success → normal state. Failure → **Conflict**.
- **Conflict:** the stash pop failed for some paths. Git has already applied the stash's
  non-conflicting changes; the stash entry `karpathy-ai-pull` is kept. The vault is in
  Conflict **exactly while that stash entry exists**, so the state is derived from git and
  survives backend restarts. Writes are blocked (editor read-only, AI runs with the
  read-only agent (§3.2), chat still usable for questions, with a banner). Per conflicting
  path, *mine* = the stash's version (`stash@{0}`, or `stash@{0}^3` for untracked files)
  and *theirs* = `HEAD`'s version. The user resolves per file:
  - **keep mine**: write mine to the path;
  - **keep theirs**: write theirs to the path;
  - **keep both** (default): mine at the path, theirs as `Foo.conflict-<date>.md`. If one
    side deleted the file, the side that exists is kept.

  Once every path is resolved: `git reset -q` (clears unmerged index entries) and
  `git stash drop`. Result: normal state, and all resolved content is uncommitted changes.
- **Push failure:** the commit stays local; the UI shows "N unpushed commits · retry". The
  next commit or pull retries the push automatically. If the remote has moved in the
  meantime, pull step 2 folds the unpushed commits back into uncommitted changes.
- **Vault lock:** the backend serializes the operations on each vault with one in-memory
  lock per vault (a single backend process, so no distributed lock is needed):
  - **shared holders:** `PUT /file` (for the duration of the write) and a running AI turn
    (for the whole turn). Human saves and an AI turn may overlap; if both write the same
    file, the stale-save check covers it. There is still at most one turn per vault.
  - **exclusive holders:** pull, commit, discard, conflict resolution, clone, remove.
    Each one waits for the running shared holders to finish and blocks new ones until it
    is done. Queued prompts and saves wait (the UI shows "waiting for AI turn" /
    "syncing…").
  - The pull on vault open is **skipped** when the lock is not immediately free (it only
    exists to keep things fresh). The pull at turn start and the pull before a commit
    always run: they run under the exclusive lock right before the turn or commit takes
    over.
  - Commit = the frontend first **flushes** the editor's unsaved changes (it sends the
    pending debounced `PUT` right away), then calls commit; the backend takes the exclusive
    lock and runs pull → commit all → push.
  - Because pulls never run during a turn, a vault cannot enter Conflict while a turn is
    running.
  - If the backend restarts, the lock and its queue are lost; queued requests fail and the
    client retries. A turn that was running keeps running in opencode. On startup the
    backend waits until opencode reports no busy session for a vault before running an
    exclusive operation on it.

### 2.5 Runtime: docker compose (dev and prod)

**Decision:** the whole stack runs as one docker compose project, in development as well as in
production. It has three services:

- **proxy** (Caddy): TLS; serves the PWA build and proxies `/api` → backend. This is the
  **only** service that publishes ports.
- **backend** (Node/TS): file API, search, git, auth, chat relay.
- **opencode** (pinned image tag): `opencode serve`. Its image holds the skill dependencies
  (Python + deps, ripgrep, git).

Volumes:

- **vaults** (`/vaults/<vault-id>/`): the clones; backend and opencode mount it
  read-write. Each vault's `AGENTS.md`/`CLAUDE.md` and `.claude/skills` come along with
  its clone.
- **config**: vault list + settings; backend only.
- **opencode data** (`~/.local/share/opencode` in the opencode container): its SQLite
  session store, so chats survive restarts; opencode only.

Backend and opencode run with the **same `user:` (UID/GID)** so that files written by
opencode stay committable by the backend (otherwise git fails with "dubious ownership" or
files become unwritable).

Secrets come from compose secrets / env files and each goes only to the service that needs it:

| Secret | Service |
|---|---|
| provider API keys | opencode |
| GitHub token / deploy key | backend |
| user bearer token | backend |
| DNS provider API token (DNS-01) | proxy |

**Dev:** the same compose file plus a dev override that bind-mounts the sources for hot
reload (Vite HMR, backend watch mode). Nothing runs natively. The local Docker engine is
Rancher Desktop.

---

## 3. Architecture

```
┌─ Frontend (React PWA, installable on the iPad home screen) ──┐
│  Vault switcher · File tree · Editor (CM6) · Search · Chat   │
│  Changed-files count · Show changes · Commit & Push          │
│  Admin area: configure vaults (GitHub repos), settings       │
└──────────────┬───────────────────────────────────────────────┘
               │ HTTPS (via home VPN) + streamed fetch (NDJSON)
┌──────────────┴──── Proxy (Caddy, DNS-01 TLS, only port) ──────┐
│  serves PWA static build · /api → backend                    │
└──────────────┬────────────────────────────────────────────────┘
┌──────────────┴──────────── Backend (Node/TS) ────────────────┐
│  • Vault admin API + config store (list of GitHub repos)     │
│  • File API: list / read / write / search / changes, per vault│
│  • opencode client: session / prompt / SSE events            │
│  • git: pull / commit / push / discard / conflict resolution │
│  • holds GitHub credentials (NEVER in opencode/frontend)     │
│  • Auth: single-user token middleware on every /api route    │
└──────────────┬────────────────────────────────────────────────┘
               │ HTTP + SSE (internal compose network only)
┌──────────────┴──── opencode serve (one container, all vaults) ┐
│  agentic loop · file tools · skills / AGENTS.md / MCP        │
│  directory per request = vault root · holds provider keys    │
└──────────────┬────────────────────────────────────────────────┘
       ┌────────┴────────┐
   Vaults = clones of GitHub repos   LLM provider(s)
   (/vaults/<id>, compose volume) (Anthropic, OpenAI, OpenRouter, Ollama, …)
   ↕ push/pull GitHub  ← Obsidian mobile/desktop attach here too
```

### 3.1 Frontend

- **Stack:** Vite + TypeScript + **React**.
- **PWA:** installable on the iOS home screen; **offline = read-only cache** of recently
  opened notes. Editing, search and chat need a connection.
- **Vault switcher:** always visible. It selects the active vault that the panels below
  work on.
- **Admin area:** list of vaults with add/edit/remove and clone/pull/conflict status;
  global settings (commit-reminder threshold).
- **Git status:** changed-files count, "Show changes" (per-file diff + Discard),
  "Commit & Push" (with AI-proposed, editable message), unpushed/retry state, commit
  reminder dialog, conflict resolution (keep mine / theirs / both).
- **Panels (mobile: tabs; desktop: split):**
  - **File tree / list** of the vault, with folders.
  - **Editor** (CodeMirror 6): Write mode by default, switchable to Read mode; Markdown
    mode, frontmatter detection, `[[wikilink]]` decoration + click navigation,
    in-document search; debounced autosave; stale-save handling (§2.4).
  - **Search** across the vault (backend `ripgrep`).
  - **Chat:** list of past chats per vault (resumable); streaming responses; shows which
    files the AI is currently reading/changing; "open the changed page" action; shows
    "waiting for other chat" while another turn runs in the same vault.
    - **Stop** button while a turn runs or waits in the queue (§3.2 abort).
    - **Turns outlive the connection:** closing the app or losing the network doesn't stop
      a turn. Reopening the chat reloads its messages and re-attaches to the live stream
      if the turn is still running.
    - Denied tool calls are shown as a "denied" chip. There is no approval UI, because no
      permission is ever `ask` (§3.2).

### 3.2 Backend

- **Stack:** Node/TS; talks to the opencode container via `@opencode-ai/sdk`
  (`createOpencodeClient()` against `http://opencode:<port>`). It does not spawn opencode,
  because compose owns the lifecycle.
All routes below sit under `/api`. Streams are `fetch` responses with a `ReadableStream`
(newline-delimited JSON), because they need the auth header and the native `EventSource`
can't send one. No WebSocket.

- **App API:**
  - `GET /health` — backend + opencode reachability.
  - `GET /settings`, `PATCH /settings` — commit-reminder threshold, model.
- **Vault admin API (REST):**
  - `GET /vaults` — list configured vaults, each with its state (`cloning` / `ready` /
    `clone-failed` / `conflict`).
  - `POST /vaults` — add a vault (repo, branch, optional root) → 202, clone runs async
    (§2.3).
  - `PATCH /vaults/:id` — edit its settings (rules in §2.3; 409 when refused).
  - `DELETE /vaults/:id` — remove the local clone and its config entry (409 while
    uncommitted changes exist).
- **Vault status (scoped per vault):**
  - `POST /vaults/:id/open` — the "vault opened" pull (§2.4; skipped when busy) → status.
  - `GET /vaults/:id/status` — state, changed-files count, unpushed count, busy, conflict
    paths.
  - `GET /vaults/:id/events` — the live event stream (§2.4 "Live vault status").
- **File API (REST), scoped per vault:**
  - `GET /vaults/:id/files` — tree/list.
  - `GET /vaults/:id/file?path=` — content + version (hash).
  - `PUT /vaults/:id/file?path=` — write; requires the loaded version, 409 if stale, 423 in
    Conflict.
  - `GET /vaults/:id/search?q=` — ripgrep over the vault.
  - Paths are resolved inside the vault root; reject anything that escapes it (`..`,
    symlinks).
- **Git API (REST), scoped per vault:**
  - `GET /vaults/:id/changes` — list of changed files; `GET /vaults/:id/changes/diff?path=`
    — one file's diff.
  - `POST /vaults/:id/discard?path=` — restore one file from the last commit.
  - `POST /vaults/:id/commit-message` — AI proposal (§2.4).
  - `POST /vaults/:id/commit` `{message}` — pull → commit all → push.
  - `POST /vaults/:id/push` — retry pushing unpushed commits.
  - `POST /vaults/:id/conflicts/resolve` `{path, choice: mine|theirs|both}`.
- **Chat API, scoped per vault.** A chat = one opencode session and belongs to exactly one
  vault. Chats are listed via opencode's session API (no chat store in the backend); child
  sessions (subagents) are left out of the list. Tool calls run inside opencode against
  that vault.
  - `GET /vaults/:id/chats` — list; `POST /vaults/:id/chats` — new chat → `{chatId}`.
  - `GET /vaults/:id/chats/:chatId` — messages so far.
  - `POST /vaults/:id/chats/:chatId/prompt` — queue a turn → 202. The turn runs whether a
    client is watching or not.
  - `GET /vaults/:id/chats/:chatId/stream` — the mapped events of the running or queued
    turn; ends when the turn is idle. After a reconnect, the client first reloads the
    messages, then attaches here.
  - `POST /vaults/:id/chats/:chatId/abort` — removes a queued prompt, or aborts the
    running turn via opencode `session.abort`. The vault lock is released once opencode
    reports the session idle.
  - The backend keeps **one opencode event subscription per vault** (opened on startup and
    on add), independent of any client. It feeds the chat streams, tells the backend when
    a turn is done (lock release), and fills the AI-touched set (§2.4).
  - **One opencode server serves all vaults:** every request passes the vault root as
    `directory` (SDK `directory` option / `x-opencode-directory` header).
  - **One running turn per vault;** further prompts to the same vault queue (vault lock,
    §2.4).
  - Pull (§2.4) before every turn starts.
  - Every prompt names the opencode **agent** that runs it (SDK `agent` field): `vault`
    (can edit) normally, `vault-readonly` while the vault is in Conflict (and for every turn
    in M3). This is how permissions differ **per vault** even though all vaults share one
    opencode server. No per-vault opencode config file is written into the vault.
- **Harness hardening:** the opencode container publishes no port and is reachable only on
  the internal compose network. Pin the opencode image tag (the server API moves fast).
  opencode config (server-level, in `deploy/`):
  - `permission.external_directory: deny` — the AI's file tools (read/edit/write/grep/
    glob/list) can neither **read nor write** outside the session's vault root (this also
    blocks cross-vault access and the rest of the repo when the vault root is a
    subfolder);
  - **`permission.bash: deny`** in the MVP. The bash tool would get around every file-tool
    rule: it can write files (M3's read-only mode, the Conflict block), read other vaults
    under `/vaults/*`, and read the container env, which holds the provider API keys. None of
    the MVP features need it. M5 brings it back as an explicit allowlist of commands for the
    skills' Python scripts (§4), re-checked against these three leaks. As a side effect,
    `git commit`/`git push` are impossible;
  - **`permission.webfetch: deny`** in the MVP: it could send vault content or keys out
    after a prompt injection from ingested content. Revisited in M5 for `ingest`;
  - three agents: `vault` (`edit: allow`, no per-edit approval), `vault-readonly`
    (`edit: deny`), and `commit-message` (every tool denied; only for the commit message
    proposal, §2.4). The backend picks one per prompt (Chat API above);
  - **no permission is ever `ask`**. Every rule is `allow` or `deny`, so a turn never
    blocks waiting for an approval, and the MVP needs no approval UI;
  - `snapshot: false`;
  - no global `~/.claude` in the container, plus `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` and
    `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` — instructions and skills come only from the
    vault's repo.
  - opencode never gets GitHub credentials.
- **git:** only the backend runs git operations (§2.4).
- **Secrets/auth:** provider API keys server-side only (opencode service env); see §2.5.
  A single-user bearer token protects all endpoints (the host holds API keys **and** a
  private life wiki):
  - Checked in **one backend middleware** in front of every `/api` route (`/vaults/*`,
    including the admin routes), using a constant-time compare against the secret. The check lives in
    the backend, not the proxy, so there is one rule and it is testable.
  - The PWA's static assets are public (they are only the app shell). The token is entered
    once and stored on the device.
  - Sent as `Authorization: Bearer …`. The native `EventSource` cannot set headers, so chat
    and event streams use `fetch` + `ReadableStream`. **Never put the token in the URL**, because it ends up in logs.
  - opencode needs no token check because nothing outside the compose network can reach it.

### 3.3 Hosting

- **Local Ubuntu server at home** running docker compose; reachable from outside only via
  the existing **home VPN** — no public port.
- HTTPS mandatory (PWA service worker + token): Caddy obtains a Let's Encrypt certificate
  for an own domain (e.g. `wiki.home.example.com`, resolving to the VPN-internal IP) via
  the **DNS-01 challenge** (DNS provider API token as a proxy secret).

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
  `CLAUDE.md`) walking up from the vault root. The global `~/.claude/CLAUDE.md` does
  **not** travel along (deliberately disabled, §3.2); anything relevant must be
  project-scoped in the repo. Files a skill reads via tools must lie **inside the vault
  root** (tool access outside it is denied).
- **Claude-specific skill features:** skills written for Claude Code may reference
  Claude Code tool names or frontmatter fields — check each skill under opencode and
  with non-Claude models (tool-calling quality varies a lot by model).
- **Bash and webfetch are denied in the MVP** (§3.2): any skill that shells out
  (Python scripts, `rg` via bash) or fetches URLs works only after M5 adds the bash allowlist.
- **Skills that commit:** any skill step that runs `git commit`/`git push` must be
  dropped or adapted — the AI never commits (§2.4).

---

## 5. Milestones

1. **M0 — Scaffold:** repo, docker compose stack (proxy + backend + opencode; vaults,
   config and opencode-data volumes; dev override with hot reload), backend skeleton
   (Node/TS), frontend skeleton (Vite + React PWA), auth-token middleware, HTTPS via Caddy
   (DNS-01).
2. **M1 — Vaults + read:** admin area (add/remove vault = clone GitHub repo), vault
   switcher, file API (list/read) + file tree + CM6 viewer + Read mode, read-only offline
   cache. Pull on open.
3. **M2 — Edit the vault:** CM6 Write mode with autosave → `PUT /file` (stale-save 409);
   changed-files count, Show changes + Discard, Commit & Push (pull before, AI message
   proposal can come in M3), commit reminder, unpushed/retry, conflict resolution;
   wikilink navigation; search (`ripgrep`).
4. **M3 — AI dialog:** opencode container driven by the backend (directory = vault root),
   streaming chat, chat list per vault; AI can Read/Grep only (`vault-readonly` agent,
   bash and webfetch denied) → frontend shows consulted files; one turn per vault.
5. **M4 — AI writes:** `vault` agent (edit allowed); AI changes show up as uncommitted changes;
   editor reloads on AI edits; `vault-readonly` during Conflict; "open changed page".
6. **M5 — Skills:** existing wiki skills available in the session; at least `query`
   and `lint` usable on mobile; breaking points from §4 checked off per skill; at least
   one non-Claude model tried.

MVP boundary = **M4** (chat that can read and write configured vaults, mobile, git-synced).
M5 (full skills) is the first extension after that.

---

## 6. Open Questions

- Which models besides Claude Sonnet 5 are good enough at tool calling for the wiki
  skills? (M5)
- Is the `external_directory` deny enough to confine opencode's read tools to a vault
  root that is a subfolder of its git repo, or does opencode treat the whole worktree as
  "inside"? Verified in the P0 spike. **Fallback if it fails:** the MVP supports only
  vault root = repo root (the admin area rejects a subfolder root); subfolder roots come
  later. The fallback is not "one opencode container per vault": vaults are added at
  runtime, and compose, not the backend, owns container lifecycles.
