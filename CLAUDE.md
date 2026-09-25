# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

Document everything in English (code, comments, docs, specs, commit messages). Vault *content*
(the user's `.md` notes the app reads/edits) may be in German, French, or any other language —
don't translate or normalize it.

## Status

Spec-only — no code, build, lint, or test commands yet. The source of truth is
[`specs/01_mvp/mvp.md`](specs/01_mvp/mvp.md); read it before implementing anything.

## What this is

Mobile-friendly PWA that combines an Obsidian-style Markdown vault with an AI chat that can
read/write/ingest into that vault — so the existing Obsidian + Claude Code + wiki-skills setup
works from iPad/phone, not just the Mac terminal.

## Architecture (planned)

- **Frontend:** Vite + TypeScript PWA (UI framework not yet chosen). Panels: file tree, editor,
  vault search, streaming chat (shows which files the AI reads/changes).
- **Editor: CodeMirror 6** editing raw Markdown (live preview via decorations). Deliberately
  *not* Milkdown/ProseMirror: WYSIWYG re-serialization causes diff noise and conflicts with the
  AI's raw edits. Preserve lossless round-trips of frontmatter and `[[wikilinks]]`.
- **Backend:** Node/TS, thin. REST file API (`GET /files`, `GET/PUT /file?path=`,
  `GET /search?q=` via ripgrep) + `POST /chat` streaming over SSE/WebSocket.
- **Agentic loop = opencode** (`opencode serve` sidecar, cwd = vault, driven via
  `@opencode-ai/sdk`). Provider-agnostic by design — never hard-wire a specific LLM provider.
  Do **not** reimplement the loop, tools, or skills — opencode's built-in file tools, skills
  (`SKILL.md`, incl. `.claude/skills`), `AGENTS.md`/`CLAUDE.md`, and MCP are the point. Keep the
  backend↔harness boundary small and ACP-shaped so the harness stays swappable.
- **Sync = git.** The vault is a git repo on the backend host; backend pulls before a session,
  commits after human/AI edits, optionally pushes to GitHub. Obsidian mobile/desktop share the
  same remote. No second sync system.
- **Security:** provider API keys server-side only; opencode server bound to localhost, version
  pinned, file access restricted to the vault; a single-user bearer token guards all endpoints;
  HTTPS mandatory (reverse proxy with auto-TLS).

## Scope

MVP boundary = milestone **M4** (chat that reads and writes the vault, mobile, git-synced).
Out of scope: graph view, plugins, canvas, multi-user/real-time collaboration, offline AI.
Skill portability caveats (Python scripts, scraper credentials, the non-portable RTK hook and
global `~/.claude/CLAUDE.md`) are listed in `specs/01_mvp/mvp.md` §4.
