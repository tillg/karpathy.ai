# MVP — karpathy.ai

A mobile-friendly web app that unites a Markdown vault (Obsidian'ish) with an AI dialog over the same vault.

---

## 1. Goals & Non-Goals

### Goals

From iPad/phone (and desktop browser):

- search, read, and edit the vault;
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

### 2.1 Agentic loop: Claude Agent SDK, not self-built

The **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, TS) is Claude Code as a
library. It provides for free:

- agentic loop, tool calling, streaming;
- **built-in file tools** (Read/Edit/Grep/Glob) → these already are the "tools to
  search/edit the `.md` files"; `cwd` = vault directory;
- **skills, `CLAUDE.md`, MCP, subagents, hooks** — the existing wiki skills run
  largely unchanged if the backend starts the session with the repo as working dir.

→ **Neither loop nor tools nor skills** get reimplemented. Only frontend + thin
backend.

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

### 2.3 Sync: git remains the source of truth

The vault is a git repo on the backend's disk. The backend commits and pushes to
GitHub; Obsidian mobile/desktop are attached to the same remote. No second sync system.

---

## 3. Architecture

```
┌─ Frontend (PWA, installable on the iPad home screen) ────────┐
│  File tree · MD viewer/editor (CM6) · Search · Chat panel    │
└──────────────┬───────────────────────────────────────────────┘
               │ HTTPS + SSE/WebSocket (chat stream)
┌──────────────┴──────────── Backend (Node/TS) ────────────────┐
│  • File API: list / read / write / search over vault dir     │
│  • Agent SDK session: cwd = vault → skills / CLAUDE.md / MCP │
│  • git: commit / push / pull  → keeps Obsidian sync coherent │
│  • holds ANTHROPIC_API_KEY  (NEVER in the frontend)          │
│  • Auth: single-user token in front of everything            │
└──────────────┬────────────────────────────────────────────────┘
       ┌────────┴────────┐
   Vault (git repo)   Claude API
   ↕ push/pull GitHub  ← Obsidian mobile/desktop attach here too
```

### 3.1 Frontend

- **Stack:** Vite + TypeScript; UI framework open (React/Svelte/Solid — author chooses).
- **PWA:** installable on the iOS home screen; offline cache for reading/editing.
- **Panels (mobile: tabs; desktop: split):**
  - **File tree / list** of the vault, with folders.
  - **Editor** (CodeMirror 6) with Markdown mode, frontmatter detection,
    `[[wikilink]]` decoration + click navigation, in-document search.
  - **Search** across the vault (backend `ripgrep` or JS index).
  - **Chat** with streaming responses; shows which files the AI is currently
    reading/changing; "open the changed page" action.

### 3.2 Backend

- **Stack:** Node/TS, so the Agent SDK (TS) runs natively.
- **File API (REST):**
  - `GET /files` — tree/list.
  - `GET /file?path=` — content.
  - `PUT /file?path=` — write.
  - `GET /search?q=` — ripgrep over the vault.
- **Chat API:** `POST /chat` starts/continues an Agent SDK session, response as
  SSE/WebSocket stream; tool calls (Read/Edit/Grep) run in the SDK against the vault.
- **git:** commit after AI or human edits; auto-push configurable; pull before
  session start to fetch Obsidian changes.
- **Secrets/auth:** `ANTHROPIC_API_KEY` server-side only; a single-user bearer token
  protects all endpoints (the host holds the API key **and** a private life wiki).

### 3.3 Hosting

- Small always-on host: existing Mac mini **or** VPS/Fly.io.
- HTTPS mandatory (PWA + token). Reverse proxy (Caddy/Traefik) with auto-TLS.

---

## 4. Skills Portability — Breaking Points

The wiki skills run via the SDK, but some dependencies are Mac-local and must be
available on the host (or the skill gets adapted):

- **RTK hook** (`git status` → `rtk git status`): dropped, pure terminal convenience —
  must not be a prerequisite for any skill.
- **Python scripts** (`film-import.py`, `serien-import.py`, `reel-film-extract.py`,
  `normalize-film-frontmatter.py`): need Python + deps on the host.
- **Network + credentials:** `ingest-email` (Gmail label `MyLife`), `instascraper`/
  Instagram resolver — need secrets and network access server-side.
- **Project config:** `Schema/CLAUDE.md` + `Schema/methodology.md` + `categories.md`
  are already in the repo → portable. The global `~/.claude/CLAUDE.md` does **not**
  travel along; anything relevant must be project-scoped in the repo (or in the SDK
  session config).

---

## 5. Milestones

1. **M0 — Scaffold:** repo, backend skeleton (Node/TS), frontend skeleton (Vite/PWA),
   auth token, local HTTPS.
2. **M1 — Read the vault:** file API (list/read) + file tree + CM6 viewer in the
   frontend. Vault connected as a git repo (pull).
3. **M2 — Edit the vault:** CM6 editor with save → `PUT /file` → git commit;
   wikilink navigation; search (`ripgrep`).
4. **M3 — AI dialog:** Agent SDK session in the backend, cwd = vault, streaming chat;
   AI can Read/Grep (read-only) → frontend shows consulted files.
5. **M4 — AI writes:** Edit tool enabled; AI edits get committed + optionally pushed;
   "open changed page".
6. **M5 — Skills:** existing wiki skills available in the session; at least `query`
   and `lint` usable on mobile; breaking points from §4 checked off per skill.

MVP boundary = **M4** (chat that can read and write the vault, mobile, git-synced).
M5 (full skills) is the first extension after that.

---

## 6. Open Questions

- Hosting: Mac mini vs. VPS — where do the skill deps (Python, scraper creds) run best?
- Session model: one long agent session per chat, or a fresh one per message? (Cost vs.
  context.)
- Conflict handling when Obsidian mobile and the app change the same file (git merge in
  the backend vs. user prompt).
- Does the MVP already need a rendered reading view next to the editor, or is CM6
  live preview enough?
