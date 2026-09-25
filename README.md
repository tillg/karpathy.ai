<p align="center"><img src="assets/icons/icon-192.png" alt="karpathy.ai logo" width="128"></p>

# karpathy.ai

A mobile-friendly web app that combines an Obsidian-style Markdown vault with an
AI dialog — so that the knowledge (the `.md` files) and the AI assistant that reads,
writes, and ingests into it can be used **on iPad and phone**, not just in the
terminal on the Mac.

## Problem

The existing setup is: Obsidian vault + Claude Code (CLI) + skills, all local on
the Mac. On mobile, only reading/editing the `.md` files works (Obsidian app). The
**AI + skills** are tied to the terminal and the Mac.

## Solution

A web app (PWA) that unites two things in one place:

1. **Obsidian core:** list, read, edit, search `.md` files (wikilinks,
   frontmatter).
2. **AI dialog:** chat UI in the app; an external LLM (any provider — Claude,
   OpenAI, OpenRouter, local via Ollama, …) is called; the **agentic loop runs in the
   backend on an existing harness** ([opencode](https://github.com/anomalyco/opencode))
   and gets tools to search and edit exactly these `.md` files.

Core idea: **don't** build the agentic loop, tool calling, and skills yourself —
opencode runs headless as a server and brings a provider-agnostic loop, file tools,
skills, `AGENTS.md`/`CLAUDE.md`, and MCP. Only the frontend (editor + chat) and a thin
backend (file API + opencode client + git sync) get built.

## Sync

Every vault is a **GitHub repo**. In the app's admin area you configure which repos
are your vaults; the backend clones them. Your and the AI's edits stay uncommitted until
you hit **Commit & Push**. Obsidian mobile and desktop are attached to the same remotes. No second sync system.

## Status

Specification. See [`specs/01_mvp/mvp.md`](specs/01_mvp/mvp.md), phased plan in
[`specs/01_mvp/plan.md`](specs/01_mvp/plan.md); UI layout prototypes in
[`specs/01_mvp/layouts/`](specs/01_mvp/layouts/) —
**[view rendered](https://raw.githack.com/tillg/karpathy.ai/main/specs/01_mvp/layouts/index.html)**.

## Development

Project skills live in `.claude/skills/`, vendored from
[mattpocock/skills](https://github.com/mattpocock/skills) (`c55ee46`, without the
`agents/` Codex configs):

| Skill | Use |
|---|---|
| `/grill-with-docs` | Interview about a plan; records terms in `CONTEXT.md`, hard decisions as ADRs in `docs/adr/` |
| `/to-spec`, `/to-tickets` | Turn a conversation or plan into a spec / tracer-bullet tickets on the issue tracker |
| `/wayfinder` | Chart a large effort as a map of decision tickets and resolve them one by one |
| `/triage` | Move issues through triage states and write agent briefs |
| `/implement` | Implement a spec/tickets test-first, then review |
| `tdd`, `code-review`, `codebase-design` | Red-green loop, two-axis review (standards + spec), deep-module vocabulary |
| `/setup-matt-pocock-skills` | One-time repo setup (issue tracker, triage labels, domain docs) that `to-spec`, `to-tickets`, `triage`, `wayfinder` and `code-review` expect |

Supporting skills called by the ones above: `grilling`, `domain-modeling`, `research`,
`prototype`.

## Name

Working title `karpathy.ai` — placeholder.

## Logo & icons

Master logo: [`assets/karpathy_ai_logo.png`](assets/karpathy_ai_logo.png). Favicon
(`favicon.ico` 16/32/48 + PNGs), Apple touch icon (180), PWA icons (192/512) and a
maskable 512 icon live in `assets/icons/`; regenerate them with `assets/make-icons.sh`
(needs ImageMagick 7).
