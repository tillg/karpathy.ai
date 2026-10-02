<p align="center"><img src="assets/icons/icon-192.png" alt="karpathy.app logo" width="128"></p>

# karpathy.app

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
Feature ideas from similar projects (30, ranked, filed as issues #64–#93):
[`specs/02_features/feature-report.md`](specs/02_features/feature-report.md) (interactive version:
`feature-report.html`, rebuilt with `node specs/02_features/build-report-html.mjs`).
Browser-only (serverless) architecture research with spikes:
[`specs/03_browser_only/browser-only-report.html`](specs/03_browser_only/browser-only-report.html).
V1 plan draft: [`specs/04_v1/v1-plan.html`](specs/04_v1/v1-plan.html).
Production environment research (hosters and free tiers, Hetzner vs IONOS, security, disk space):
[`specs/05_prod_env/prod-env-report.html`](specs/05_prod_env/prod-env-report.html).
Generating the reports from Markdown:
[`specs/06_md_to_html/md-to-html-report.html`](specs/06_md_to_html/md-to-html-report.html).
These HTML reports are generated from the `.md` next to each (see [Reports](#reports)).
UI layout prototypes in [`specs/01_mvp/layouts/`](specs/01_mvp/layouts/) —
**[view rendered](https://raw.githack.com/tillg/karpathy.app/main/specs/01_mvp/layouts/index.html)**.

## Running it

Everything runs in docker compose (on this Mac: Rancher Desktop).

**Dev** (hot reload, https://localhost:8443, local Ollama `qwen2.5:3b` as the model):

```sh
just dev                # builds, starts, pulls the dev model once, prints the token
just dev logs           # also: ps, token
just dev down
```

`just` lists all commands (`brew install just`); they wrap `deploy/dev.sh` and npm. Deploying
also needs `brew install lima ansible ansible-lint qrencode jq` (the local target VM, the playbook,
the login QR code and the deploy scripts).

Notes open at `https://localhost:8443/#/<vault>/<path>` (Back/Forward work). Binary files
(images, PDFs, …) are listed but not editable. A vault whose clone failed can be retried
from the admin area. Unsaved edits
are also kept on the device and restored after a reload or a lost connection. For the
offline cache / PWA install in your own browser, trust Caddy's dev CA (in the proxy
container under `/data/caddy/pki/authorities/local/root.crt`). The app reloads itself when
a new version is out (checked on load and whenever it comes back into view). If a browser
still shows an old build, delete the site's website data (Safari: Settings → Privacy →
Manage Website Data → `localhost`) and enter the token again.

To clone from GitHub in dev, put a token into `deploy/secrets/github_token`. To work
offline against local bare repos instead, create them under `tmp/dev/remotes/<owner>/<name>.git`
and set `GIT_REMOTE_BASE=file:///remotes/` in `deploy/.env`.

**Prod** (the Hetzner server `app.karpathy.app`, reachable only over Tailscale) is never built or
configured by hand: releases go there with `just deploy hetzner`, see [Deploying](#deploying).

## Tests

```sh
npm test               # unit + integration: real git against local bare repos, real opencode container (Docker)
npm run test:github    # @github: clone/push against the throwaway repo tillg/karpathy-app-test-vault
npm run test:llm       # @llm: real model turns (default: local Ollama qwen2.5:3b, see apps/backend/test/opencode-container.ts)
npm run test:e2e       # Playwright against the running dev stack
npm run typecheck
```

`just check` runs lint, typecheck and `npm test` in one go.

To run the e2e suite against the **prod images** (https://localhost:9443, next to the dev
stack): `just prodtest`, `just prodtest e2e`, `just prodtest down`; details in the header of `deploy/compose.prodtest.yml`: `E2E_BASE_URL`, `E2E_TOKEN_FILE` and `E2E_BACKEND_CONTAINER`
point Playwright at it.

Tests that need a real model turn are tagged `@llm` in their title; `--grep-invert @llm` skips them.

Accessibility: `e2e/a11y.spec.ts` runs axe-core (WCAG 2.1 AA + best practice) over the main
screens in light and dark mode and fails on serious/critical findings; `e2e/a11y-keyboard.spec.ts`
covers dialog focus trapping, menu/radio-group keys and phone touch-target sizes.

Layout: `apps/backend` (Express 5, Node/TS), `apps/web` (Vite + React PWA),
`packages/shared` (API types), `deploy/` (compose, Dockerfiles, Caddy, opencode config),
`e2e/` (Playwright).

## Deploying

A release is a git tag; CI builds its images and Ansible puts it on a server from the Mac, with
monitoring and a smoke check. **How it works, every `just` recipe, secrets and the first-server
procedure: [`deploy/README.md`](deploy/README.md).** The short version:

```sh
just release 0.3.0            # tag v0.3.0 → images on GHCR + GitHub release
just deploy hetzner 0.3.0     # put it on the server (`local`: the test VM on https://localhost:9444)
just token hetzner --qr       # log a phone or iPad in by scanning a QR code
```

## Development

Project skills live in `.claude/skills/`, vendored from
[mattpocock/skills](https://github.com/mattpocock/skills) (`c55ee46`, without the
`agents/` Codex configs). Upstream `code-review` is dropped here: its two-axis review
(standards + spec) is merged into the spec plugin's `/spec:adversarial-code-review`, which
`implement` and `tdd` are adjusted to call:

| Skill | Use |
|---|---|
| `/grill-with-docs` | Interview about a plan; records terms in `CONTEXT.md`, hard decisions as ADRs in `docs/adr/` |
| `/to-spec`, `/to-tickets` | Turn a conversation or plan into a spec / tracer-bullet tickets on the issue tracker |
| `/wayfinder` | Chart a large effort as a map of decision tickets and resolve them one by one |
| `/triage` | Move issues through triage states and write agent briefs |
| `/implement` | Implement a spec/tickets test-first, then review |
| `tdd`, `codebase-design` | Red-green loop, deep-module vocabulary |
| `/setup-matt-pocock-skills` | One-time repo setup (issue tracker, triage labels, domain docs) that `to-spec`, `to-tickets`, `triage` and `wayfinder` expect |

Supporting skills called by the ones above: `grilling`, `domain-modeling`, `research`,
`prototype`.

### Plugins

`.claude/settings.json` registers the
[till-claude-code-marketplace](https://github.com/tillg/till-claude-code-marketplace) and Matt
Pocock's [`mattpocock/skills`](https://github.com/mattpocock/skills) marketplace (both with
auto-update), and enables `spec` (spec workflow: `/spec:explore`, `/spec:propose`, `/spec:grill`,
`/spec:apply`, …), `md2html`, `mattpocock-skills` (needed by `/spec:grill`) and `claude-security`
from the official marketplace. The spec skills come only from there: the `.claude/skills/` above are
a different, vendored set.

After cloning: start `claude` in the repo and **trust the folder**. In that first session a
`SessionStart` hook installs any of the four plugins that are missing (`claude plugin install …
--scope project`); they load from the **next** session on (restart, or `/reload-plugins`). When
adding or removing a plugin, keep the hook's list in sync with `enabledPlugins`.

### Reports

Reports under `specs/` are Markdown (`*-report.md`, `v1-plan.md`) rendered to self-contained HTML
by the [md2html](https://github.com/tillg/till-claude-code-marketplace/tree/main/plugins/md2html)
plugin, used only through its skills (no local copy of the tool):

| Skill | Use |
|---|---|
| `/md2html:write` | Write or edit a report (the `.md`); the plugin's hook lints every edit |
| `/md2html:build` | Build the HTML; `--check` fails on lint errors, non-canonical Markdown or stale HTML |

Config: `reports.json` (which files, menu bar, brand, theme); theme: `specs/reports-theme.css`.
Improvements go into the plugin in the marketplace repo, not into local scripts.

## Name

`karpathy.app` — renamed from the working title `karpathy.ai` (#95). Domain: `karpathy.app` (#94).

## Logo & icons

Master logo: [`assets/karpathy_app_logo.png`](assets/karpathy_app_logo.png). Favicon
(`favicon.ico` 16/32/48 + PNGs), Apple touch icon (180), PWA icons (192/512) and a
maskable 512 icon live in `assets/icons/`; regenerate them with `assets/make-icons.sh`
(needs ImageMagick 7).
