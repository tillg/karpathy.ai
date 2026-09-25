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

MVP (spec milestone M4) implemented: vaults from GitHub, file tree, CodeMirror editor with
live preview and `[[wikilinks]]`, search, uncommitted changes / diff / discard, Commit & Push
with an AI-proposed message, conflict resolution, and a streaming AI chat that reads and
edits the vault through opencode. Spec: [`specs/01_mvp/mvp.md`](specs/01_mvp/mvp.md), plan:
[`specs/01_mvp/plan.md`](specs/01_mvp/plan.md), opencode findings:
[`specs/01_mvp/spike-opencode.md`](specs/01_mvp/spike-opencode.md), decisions taken while
implementing: [`specs/01_mvp/implementation-decisions.md`](specs/01_mvp/implementation-decisions.md).
UI layout prototypes in [`specs/01_mvp/layouts/`](specs/01_mvp/layouts/) —
**[view rendered](https://raw.githack.com/tillg/karpathy.ai/main/specs/01_mvp/layouts/index.html)**.

## Running it

Everything runs in docker compose (on this Mac: Rancher Desktop).

**Dev** (hot reload, https://localhost:8443, local Ollama `qwen2.5:3b` as the model):

```sh
deploy/dev.sh up        # builds, starts, pulls the dev model once, prints the token
deploy/dev.sh logs
deploy/dev.sh down
```

Notes open at `https://localhost:8443/#/<vault>/<path>` (Back/Forward work). Binary files
(images, PDFs, …) are listed but not editable. A vault whose clone failed can be retried
from the admin area. Unsaved edits
are also kept on the device and restored after a reload or a lost connection. For the
offline cache / PWA install in your own browser, trust Caddy's dev CA (in the proxy
container under `/data/caddy/pki/authorities/local/root.crt`).

To clone from GitHub in dev, put a token into `deploy/secrets/github_token`. To work
offline against local bare repos instead, create them under `tmp/dev/remotes/<owner>/<name>.git`
and set `GIT_REMOTE_BASE=file:///remotes/` in `deploy/.env`.

**Prod** (home server, reachable via VPN): copy `deploy/.env.example` → `deploy/.env`
(domain, DNS provider, git author, model) and `deploy/opencode.env.example` →
`deploy/opencode.env` (provider API keys). Put the secrets into `deploy/secrets/`
(`bearer_token`, `github_token`, `dns_api_token`), then
`docker compose -f deploy/compose.yml up -d --build`. Caddy gets a Let's Encrypt
certificate via DNS-01.

## Tests

```sh
npm test               # unit + integration: real git against local bare repos, real opencode container (Docker)
npm run test:github    # @github: clone/push against the throwaway repo tillg/karpathy-ai-test-vault
npm run test:llm       # @llm: real model turns (default: local Ollama qwen2.5:3b, see apps/backend/test/opencode-container.ts)
npm run test:e2e       # Playwright against the running dev stack
npm run typecheck
```

To run the e2e suite against the **prod images** (https://localhost:9443, next to the dev
stack), see the header of `deploy/compose.prodtest.yml`: `E2E_BASE_URL` and `E2E_TOKEN_FILE`
point Playwright at it.

Layout: `apps/backend` (Express 5, Node/TS), `apps/web` (Vite + React PWA),
`packages/shared` (API types), `deploy/` (compose, Dockerfiles, Caddy, opencode config),
`e2e/` (Playwright).

## Development

Project skills live in `.claude/skills/`, vendored from
[mattpocock/skills](https://github.com/mattpocock/skills) (`c55ee46`, without the
`agents/` Codex configs). Upstream `code-review` is renamed to `spec-review` here, so it
doesn't clash with Claude Code's built-in `/code-review` (bug hunt); `implement` and `tdd`
are adjusted to call it:

| Skill | Use |
|---|---|
| `/grill-with-docs` | Interview about a plan; records terms in `CONTEXT.md`, hard decisions as ADRs in `docs/adr/` |
| `/to-spec`, `/to-tickets` | Turn a conversation or plan into a spec / tracer-bullet tickets on the issue tracker |
| `/wayfinder` | Chart a large effort as a map of decision tickets and resolve them one by one |
| `/triage` | Move issues through triage states and write agent briefs |
| `/implement` | Implement a spec/tickets test-first, then review |
| `tdd`, `spec-review`, `codebase-design` | Red-green loop, two-axis review (standards + spec), deep-module vocabulary |
| `/setup-matt-pocock-skills` | One-time repo setup (issue tracker, triage labels, domain docs) that `to-spec`, `to-tickets`, `triage`, `wayfinder` and `spec-review` expect |

Supporting skills called by the ones above: `grilling`, `domain-modeling`, `research`,
`prototype`.

## Name

Working title `karpathy.ai` — placeholder.

## Logo & icons

Master logo: [`assets/karpathy_ai_logo.png`](assets/karpathy_ai_logo.png). Favicon
(`favicon.ico` 16/32/48 + PNGs), Apple touch icon (180), PWA icons (192/512) and a
maskable 512 icon live in `assets/icons/`; regenerate them with `assets/make-icons.sh`
(needs ImageMagick 7).
