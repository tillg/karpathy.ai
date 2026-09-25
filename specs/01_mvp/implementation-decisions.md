# MVP implementation — autonomous decisions & assumptions

Log of decisions and assumptions made while implementing the MVP unattended
(started 2026-09-25 16:43 Europe/Berlin). Review these with the user.

## Summary (for review)

**Status:** MVP (spec M4, plan Phases 0–5) implemented on `main` and pushed. What's in:
vaults from GitHub (admin area), file tree, CodeMirror 6 editor with live preview +
`[[wikilinks]]`, Read mode, search, uncommitted changes / diff / discard, Commit & Push with
AI-proposed message + agent trailer, commit reminder, unpushed/retry, conflict resolution
(mine/theirs/both), live event stream, offline read-only cache (PWA), streaming AI chat via
opencode (reads + writes the vault, one turn per vault, queue, stop, re-attach, adopt after
restart), docker compose dev + prod, CI.

**Not done (needs you):** real-device run on iPhone/iPad via VPN, deploy to the home server
(DNS-01 cert with your DNS provider — Cloudflare assumed, decision 16), trying a Claude model (no
Anthropic key here; everything ran on local Ollama `qwen2.5:3b`), and the offline cache on
real Safari (decision 43).

**Testing:** backend 119 tests (real git with local bare remotes + a real opencode container),
`@github` tier 3 tests (throwaway repo `tillg/karpathy-ai-test-vault`), `@llm` tier 7 tests
(real model turns), web 51 unit tests, Playwright e2e ~36 spec files / 158 tests in Chromium
(desktop, iPad, iPhone) and WebKit incl. axe accessibility checks, plus a prod-image smoke run.
Five rounds of exploratory, resilience, security, accessibility and performance testing filed 52 GitHub issues
(`e2e-found` label); all fixed with a regression test and closed except those still in progress
at the time of writing (see `gh issue list -R tillg/karpathy.ai`).

**Worth a look first** (decision numbers in the table below, not issue numbers): 3 (OpenAI key
unusable → local Ollama; Claude tool-calling untested), 6 (a GitHub test repo was created),
16 (Cloudflare assumed for DNS-01), 44 (vaults carrying `.opencode/` / `opencode.json` are
chat-disabled — security), 32 (unsaved drafts kept in `localStorage`), 45 and 47 (commit/
discard/queue semantics that go beyond the spec).

## Decisions

| # | Decision / assumption | Why | Reversible? |
|---|---|---|---|
| 1 | Committed + pushed the pending spec/skill changes as one commit on `main` (`7a8ce18`). | User asked "commit and push our repo" first. | yes |
| 2 | Work happens directly on `main` (no branch). | Global rule: never create/switch branches without permission; `/implement` says "commit to the current branch". | yes |
| 3 | No Anthropic key here, and the `OPENAI_API_KEY` account is inactive (billing; no gpt-4.1/5 access). **`@llm` tests and the live dev stack use a local Ollama `qwen2.5:3b`** (real model, not a mock; weak but makes the requested tool calls). The server default stays **Claude Sonnet 5** (`anthropic/claude-sonnet-5`); dev overrides `DEFAULT_MODEL`. Default-tier chat tests use an Ollama model name that isn't pulled (`ollama/kai-no-such-model`): turns fail fast with a non-retryable 404, so the lifecycle is tested without an LLM. (An unreachable endpoint doesn't work: opencode retries connection errors with backoff for minutes.) | Only working option on this machine. I did **not** use the Azure key found in `~/.config/opencode` (unrelated work credentials). | yes |
| 4 | Dev proxy publishes **https://localhost:8443** (not 443). | Keep off privileged/likely-used ports; 3000/8080 are taken by other local projects. | yes |
| 5 | Phase 5 steps "real device via VPN" and "deploy to home Ubuntu server" are **not done** (no access). Prod compose + Caddy DNS-01 config are written and `caddy validate`d only. | Out of reach from this machine. | — |
| 6 | Created the throwaway GitHub repo **`tillg/karpathy-ai-test-vault`** (private; `README.md`, `Note A.md`, `wiki/` subfolder variant, `outside.md`). `@github` tests use `TEST_VAULT_TOKEN` or fall back to `gh auth token`; they push only to a temporary `test-<ts>` branch and delete it afterwards. | Plan's `@github` tier requires it. Private, never real data. Delete with `gh repo delete tillg/karpathy-ai-test-vault` if unwanted. | yes |
| 7 | TypeScript **5.9** (not 7.0 "tsgo", which is `latest` on npm). Vitest 5, Express 5, zod 4, Vite 8, React 19. | 5.9 has the widest tooling compatibility. | yes |
| 8 | Backend runs TS directly via `tsx` (no build step), in dev (`tsx watch`) and prod. | Fewer moving parts for a single-user app. | yes |
| 9 | Clone URL = `GIT_REMOTE_BASE` + `owner/name.git` (default `https://github.com/`). Tests and the dev stack point it at local bare repos (`file://…`). GitHub token is passed per git call via `GIT_CONFIG_*` env (`http.extraheader`), never written to `.git/config`; clone errors are token-redacted. | Real git in tests without GitHub; no credential on disk in the vault. | yes |
| 10 | Unresolved **Conflict paths are persisted** in the config store (`conflicts[vaultId]`), while the *state* is still derived from the `karpathy-ai-pull` stash entry. Recomputed from git if the record is missing. | After "keep theirs" on an untracked clash the file no longer differs from HEAD, and tracked unmerged entries stay until the final `git reset`, so git alone can't tell resolved from unresolved paths. | yes |
| 11 | `DELETE /vaults/:id` is also blocked (409) while **unpushed commits** exist, not only uncommitted changes. | Removing the clone would silently lose them. | yes |
| 12 | Extra routes not in the spec: `DELETE /vaults/:id/file?path=&version=` (delete a note), `GET /vaults/:id/conflicts/sides?path=` (mine/theirs for the resolution UI), `DELETE /vaults/:id/chats/:chatId`, unauthenticated `GET /healthz` (container liveness; no data; outside `/api`). `PUT /file` accepts `force: true` for the stale-save "Overwrite" choice. | Needed for a usable UI (create/edit/delete notes) and for Docker health checks. | yes |
| 13 | File tree hides dot-entries (`.git`, `.obsidian`, `.claude`, …). Search = ripgrep fixed-string, case-insensitive (respects `.gitignore`), plus file-name matches (line 0), max 200 hits. | Obsidian-like; skills/config aren't notes. | yes |
| 14 | Commit `Co-authored-by` trailer: `Co-authored-by: karpathy.ai agent <agent@karpathy.ai>`. Author/committer = `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env of the backend. | Spec says "an agent trailer" without naming one. | yes |
| 15 | Commit / push: if the pre-commit pull can't reach the remote ("offline"), the commit is still made locally and becomes an unpushed commit. | Matches plan P3 "remote unreachable → commit local, 1 unpushed". | yes |
| 16 | Prod proxy image builds Caddy with a DNS provider module via `xcaddy` (build arg `DNS_PROVIDER`, default **cloudflare** — assumption, the DNS provider isn't named anywhere). DNS token via `{file.*}` from a compose secret. | DNS-01 needs a provider module. | yes |
| 17 | Named volumes get their ownership from the images (mount points pre-created as `APP_UID:APP_GID`, default 1000:1000) instead of an init container. | Keeps the stack at the three specified services (+ a dev-only `web` Vite service). | yes |
| 18 | Dev stack adds a 4th service **`web`** (Vite dev server, HMR) behind the proxy; prod serves the static build from the proxy. | Spec: "dev override bind-mounts the sources for hot reload". | yes |
| 19 | Frontend layout (from layout 07): phone <700 px tab bar (Files, Search, Chat, Changes) with push navigation; tablet 700–1023 px overlay sidebar + slide-over chat; ≥1024 px three columns, chat inspector open by default ≥1280 px. 07's separate note-list column and "Notes \| Chat" switch dropped; sidebar has a Files / Search / Changes segmented control. Admin + settings = one modal. | Simplest fit of 07 onto MVP features. | yes |
| 20 | Icons: Framework7 Icons bundled from npm (offline) instead of 07's CDN; `publicDir` = `assets/icons`. Confirms/new-note name use native `confirm()`/`prompt()`. New notes start with `# <name>`; `.md` added when no extension. | Offline-capable, minimal code. | yes |
| 21 | Wikilink click navigates unless the cursor is inside the link; resolution exact path → `+.md` → path suffix → basename, case-insensitive. | Tap-friendly yet editable; Obsidian-like resolution. | yes |
| 22 | Commit reminder: after the 2nd dismissal it stays away until the count drops to ≤ threshold; dismissal state in memory per vault. | Spec defines only the first two appearances. | yes |
| 23 | Offline = `navigator.onLine`; SW caches only GET `/vaults`, `/files`, `/file` (NetworkFirst); search/chat disabled offline. | Spec: offline = read-only cache. | yes |
| 24 | Read-only git commands run with `GIT_OPTIONAL_LOCKS=0`. | Status polling raced with Discard on `index.lock` (found in UI testing; regression test added). | yes |
| 25 | Spike findings applied: opencode image = stock (no git, no Python); `task`/`websearch`/`question`/`doom_loop` denied; `vault` agent can't edit `.git`, `opencode.json(c)`, `.opencode/`; clones use `core.symlinks=false`; no `OPENCODE_DISABLE_CLAUDE_CODE_*` flags; HOME = tmpfs, data at `/data`. Spec §2.4/§2.5/§3.2/§6 amended. | See `spike-opencode.md`. | yes |
| 26 | A chat accepts only one queued/running turn at a time (a second prompt to the *same* chat → 409); other chats of the vault queue normally. | Two queued prompts in one opencode session would interleave; the UI disables send while a turn runs. | yes |
| 27 | Backend reconciles turn state by polling opencode's busy list every 3 s while a turn runs (safety net for missed `idle` events / SSE reconnects), and on startup holds the vault lock for sessions opencode still reports busy. | Spec: "on startup the backend waits until opencode reports no busy session". | yes |
| 28 | Small extras kept: `GET /vaults/:id` (single vault, used by the admin UI), collapsible "Thinking" for reasoning parts, `[[Note#Heading]]` jumps to the heading. | Cheap, and each used by the UI. | yes |
| 29 | Startup busy check: the backend holds the vault lock and waits up to 30 s for opencode to answer before assuming no leftover turn (compose only starts it after opencode is healthy). | Spec wants a wait; an unreachable opencode can't be running a turn that writes. | yes |
| 30 | Chat turn events carry `waiting: 'turn' \| 'sync'` for queued turns ("Waiting for other chat…" vs "Waiting for sync…"); vault status carries `pullError` after an offline pull (git pill shows "· offline"). | Spec review: the UI said "waiting for other chat" also while a pull/commit ran, and failed pulls were invisible. | yes |
| 31 | ESLint (flat config, typescript-eslint recommended, react-hooks classic rules) as `npm run lint`; CI nightly `@llm` runs on Ollama `qwen2.5:3b`. | Plan P1 "lint wired"; no working provider key for CI. | yes |
| 32 | **Unsaved drafts are kept in `localStorage`** (key: vault + path + base version) on every edit; saved on `visibilitychange: hidden`/`pagehide` (keepalive only < 60 KB), `beforeunload` warns, failed saves retry every 10 s and on `online`. On reopen a draft is restored if its base version still matches, else the stale-save dialog opens with the draft (#14). | The spec's "debounced autosave" alone lost text on reload/backgrounding. | yes |
| 33 | Leaving a note saves first; only a stale save or a deleted note with unsaved edits blocks leaving (network/server failures don't — the draft is local). Stale dialog is bound to the note it belongs to (#3). | Avoid trapping the user; never overwrite the wrong note. | yes |
| 34 | URL routing `#/<vault>/<path>` (hash) for Back/Forward/reload; Read/Write mode and sidebar tab are not in the URL; mode is kept when following links (#5, #17). Token never in the URL. | Minimal routing that fixes history. | yes |
| 35 | Note deleted elsewhere → banner "Keep as new note" / "Close", editor read-only (#8). Silent reload applies a minimal text diff to keep scroll/cursor (#4). | — | yes |
| 36 | Conflict view: line diff theirs→mine with collapsed unchanged runs, "Compare larger" dialog (#10). Paths shown as name + folder on two lines (#11). Queued prompts stay visible, Stop returns the text to the composer, empty chats are deleted when you leave them (#13). Commit is enabled while the open note has unsaved edits (#18). | UX bugs from testing. | yes |
| 37 | Dev: vite-plugin-pwa `devOptions` on (manifest + SW in dev); dev web and backend containers **poll** for source changes (Rancher bind mounts deliver no inotify events). Offline e2e launches Chromium with `--ignore-certificate-errors` (SW won't register over the dev self-signed cert otherwise). | Make the dev stack testable like prod. | yes |
| 38 | Binary files (not valid UTF-8 or containing NUL) are flagged by the backend (`binary: true`, empty content) and shown as a placeholder — never loaded into the editor (#20). No image preview in the MVP. | One keystroke used to corrupt a PNG. | yes |
| 39 | New file names are validated for every clone's OS: no Windows-reserved names (CON, NUL, COM1…), no control chars or `<>:"\|?*\\`, no trailing dot/space/slash, no case-only twin of an existing file (400 `bad-name` / 409 `exists-case`). | Obsidian on Windows/macOS/iOS shares the repo. | yes |
| 40 | Chats are titled after their first prompt (opencode's "New session - <date>" replaced, max 60 chars); the chat list shows Running/Queued; a queued prompt's text is kept server-side until it runs (`queuedText`) (#13). | Queued prompts vanished on reload/other devices. | yes |
| 41 | A clone-failed vault gets a Retry button (PATCH `{}` re-clones); duplicate-vault check ignores case (#23, #25). | — | yes |
| 42 | CRLF files stay CRLF on save (#19); commit reminder is suppressed during Conflict (#21); per-vault UI state is tagged with its vault so a failed/cloning vault never shows another vault's changes (#22); removing the active vault drops its note and drafts (#24); hidden panes are `inert`, Write/Read toggle has `aria-pressed` (#26). | Round-2 testing. | yes |
| 43 | Offline cache in **WebKit** is not verified: Playwright's offline WebKit fails even SW-served requests, so that test is skipped on WebKit. Needs a check on a real iPhone/iPad. | Tooling limit. | — |
| 44 | **Security (from the probe, #27/#30/#31):** a vault containing opencode project config (`.opencode/`, `opencode.json(c)`) is chat-disabled (409 `unsafe-config`) rather than trying to strip it — the backend never lets a request for it reach opencode, and the file API refuses to create such files. Branch names: plain ref names + `--end-of-options`. Notes: DOMPurify without forms/inputs/inline styles + strict CSP in prod. Spec §3.2 amended. | `OPENCODE_DISABLE_PROJECT_CONFIG` would also drop the vault's AGENTS.md/CLAUDE.md. A repo that needs its own opencode config can't use chat in the MVP. | yes |
| 45 | **Discard and commit carry what the user reviewed** (file version / changed-file list); after waiting for an AI turn they refuse (409 `stale` / `changes-moved`) instead of acting on unreviewed changes (#32, #33). | Waiting is by spec; silently committing/discarding AI edits the user never saw is not. | yes |
| 46 | Remote history replaced (no merge base): pull resets `--mixed` onto the new upstream and keeps the working tree → everything local becomes uncommitted changes (#36). Spec §2.4 step 2 amended. | Was a dead end (500s, no way out). | yes |
| 47 | Queued chat prompts are persisted in the config store and resumed after a backend restart (spec said "queued requests fail and the client retries"; the client never did) (#37). Removing a vault deletes its opencode sessions (#34). A turn cut off by an opencode restart ends with an explicit error (#28); opencode down → 503 `ai-unavailable` (#29). | Resilience testing. | yes |
| 48 | Known flaky under full parallel load (pass reliably alone): `api.test.ts › PATCH repo re-clones`, `chat.test.ts › onReady hook` (supertest socket hang-up). | Load on this laptop (two Ollama instances + stack). | — |
| 49 | Review round 4 fixes: a failed vault-list fetch never declares a vault gone (drafts were wiped); harness-config check re-runs after the pre-turn pull; vault removal doesn't send an unsafe vault's dir to opencode; backend listens before chat init (opencode may be restarting); queued prompts are persisted before the 202; keepalive size measured in bytes; conflict line diff falls back for huge inputs; opencode runs with `init: true` (#38, SIGTERM). | Code review + prod smoke test. | yes |
| 50 | `deploy/compose.prodtest.yml`: runs the prod images locally on https://localhost:9443 (Caddy `tls internal` via `TLS_MODE=internal` snippet in the prod Caddyfile; prod default unchanged = DNS-01). e2e can target it with `E2E_BASE_URL`/`E2E_TOKEN_FILE`; every e2e test now fails on CSP violations. Prod smoke: 124 passed, 1 skipped (desktop, iPhone, WebKit), incl. real offline/SW. | Verify the actual deploy artifact, not only dev. | yes |
