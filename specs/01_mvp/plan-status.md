# MVP plan — verification status

Status of every `step → verify` row of Phases 0–5 in [`plan.md`](plan.md), as of 2026-09-25.
"Evidence" names the test that mechanically checks the verify cell (file › test name), the
spike section, or why it can't be automated here. Decision numbers (D#) refer to
[`implementation-decisions.md`](implementation-decisions.md).

Status: **done** = verify cell covered by a passing test · **partly** = some of the cell
covered · **deviated** = done, but differently from the plan (see note) · **not done** = no
mechanical check.

Test locations: backend `apps/backend/test/` (default tier = `npm test`; `*.github.test.ts`
= `@github`; `*.llm.test.ts` = `@llm`), web unit `apps/web/src/lib/`, Playwright `e2e/`.
Tests added with this status review are marked **(new)**; they live in
`apps/backend/test/plan-gaps.test.ts`, `apps/backend/test/plan-gaps.llm.test.ts`,
`e2e/plan-gaps.spec.ts`, plus one test in `apps/backend/test/chat.test.ts`.

## Summary

| Phase | done | partly | deviated | not done |
|---|---|---|---|---|
| P0 Spike | 5 | 0 | 3 | 0 |
| P1 Scaffold | 4 | 1 | 1 | 1 |
| P2 Vaults + read | 9 | 1 | 0 | 0 |
| P3 Edit + git | 12 | 0 | 0 | 0 |
| P4 AI reads | 8 | 2 | 1 | 0 |
| P5 AI writes | 6 | 0 | 0 | 2 |
| **Total (56 rows)** | **44** | **4** | **5** | **3** |

Before the new tests: 37 done, 11 partly, 5 deviated, 3 not done.

**Open: `plan-gaps.llm.test.ts` (3 tests) is not yet green.** On 2026-09-25 every turn timed
out: the machine's CPU was saturated by two Ollama instances (the dev stack's Ollama was busy
with another e2e run). The existing `chat.llm.test.ts` › read tools show up as consulted files,
which passed before, timed out in the same run, so the failures are environmental, not a finding.
Re-run with an idle machine: `npm run test:llm -w apps/backend -- test/plan-gaps.llm.test.ts`.
Once green, P4 rows 3–4 become done.

## Phase 0 — Spike

Evidence is [`spike-opencode.md`](spike-opencode.md) § Results (row #). Spike runs are manual;
where a regression test exists it is listed too.

| Step | Status | Evidence | Note |
|---|---|---|---|
| Two vault dirs, separate session lists | done | spike #1; `chat.test.ts` › sessions of vault A never appear under vault B | |
| Session in A, "list files", `/event` shows tool parts | done | spike #2; `harness-map.test.ts` › maps busy/idle status… (real captures) | |
| `external_directory: deny`, subfolder root, reads above root / vault B denied | deviated | spike #3 + "Read this first" 1 | Holds only while the opencode image has no git (D25). No automated confinement test; `plan-gaps.spec.ts` › opencode container › no git in the image… **(new)** guards the precondition. |
| `snapshot:false`, bash/webfetch deny, no `ask` → bash attempts denied, never blocks | deviated | spike #4; `plan-gaps.test.ts` › no permission is ever "ask", hardening flags as in mvp §3.2 **(new)** | Blanket-denied tools aren't offered to the model at all, so there are no permission-denied events (D25). |
| Agents `vault` / `vault-readonly` per prompt, two vaults at once | done | spike #5; `plan-gaps.test.ts` › three agents… **(new)** | |
| grep/glob/list outside root denied | done | spike #6 | opencode 1.18 has no `list` tool. |
| Global Claude lookups off, empty `$HOME` → only vault instructions/skills | deviated | spike #7 + "Read this first" 2 | `OPENCODE_DISABLE_CLAUDE_CODE_*` must NOT be set (D25). `plan-gaps.spec.ts` › opencode container… checks the tmpfs HOME without `~/.claude` **(new)**. |
| Restart with data volume → session listed + resumable | done | spike #8 | No automated test (test containers use a tmpfs `/data`). |

## Phase 1 — Scaffold (M0)

| Step | Status | Evidence | Note |
|---|---|---|---|
| Monorepo, lint + typecheck + Vitest | done | `.github/workflows/ci.yml` job `default` (lint, typecheck, `npm test`, build) green on `main` | The `nightly` job (`@github`, `@llm`) has never run in CI yet (no scheduled/dispatch runs). |
| compose: 3 services, volumes, same UID/GID, only proxy publishes; healthy; opencode unreachable from host | done | CI `docker compose … config -q`; `plan-gaps.test.ts` › compose topology (4 tests) **(new)**; `plan-gaps.spec.ts` › compose ps: every service with a healthcheck is healthy…; opencode container… (same UID) **(new)** | Dev adds `web` + `ollama` (D18, D3). |
| `compose.dev.yml`: HMR, backend watch | not done | manual — no test | Automating needs a test that edits an app source file; out of scope here. Dev containers poll for changes (D37). |
| Caddy dev internal TLS; prod DNS-01 `caddy validate` | deviated | every e2e test loads `https://localhost:8443/` (e.g. `auth.spec.ts` › wrong token is rejected…); `plan-gaps.spec.ts` › the prod Caddyfile (DNS-01) passes `caddy validate` **(new)** | Dev port 8443, not 443 (D4). The validate test skips if no prod proxy image is built locally. |
| Bearer middleware on every `/api` route | done | `api.test.ts` › 401 without or with a wrong token, 200 with the right one; `auth.spec.ts` › icons are served (static public) | Constant-time compare is not asserted by a test. |
| Token screen, stored on device; PWA manifest + icons | partly | `auth.spec.ts` › wrong token is rejected, right token shows the shell and is remembered; › page links a web app manifest…; › icons are served | No Lighthouse installability check (Lighthouse 12 dropped the PWA category); manifest fields are asserted instead. |
| `/api/health` backend + opencode | done | `api.test.ts` › health reports backend + opencode; `chat.test.ts` › health reports opencode ok; `plan-gaps.spec.ts` › /api/health reports backend + opencode ok inside the stack **(new)** | |

## Phase 2 — Vaults + read (M1)

| Step | Status | Evidence | Note |
|---|---|---|---|
| Config store CRUD, atomic write | done | `config-store.test.ts` (5 tests, incl. › a leftover temp file from a killed write does not corrupt the store) | Kill simulated by a leftover temp file. |
| Vault CRUD + async clone, `@github` | done | `github.github.test.ts` › clones the repo root and the wiki/ subfolder variant…; › bad repo → clone-failed…; › …DELETE never touches the remote; `api.test.ts` › add → cloning → ready…; `plan-gaps.test.ts` › DELETE removes the local clone directory **(new)** | Retry = PATCH `{}` / Retry button, not remove + add (D41). |
| PATCH rules | done | `api.test.ts` › PATCH: name always; repo/branch/root only on a clean tree; › PATCH repo re-clones; › PATCH branch + missing root together → 400 | `PATCH repo re-clones` is flaky under load (D48). |
| Path guard | done | `paths.test.ts` (3); `api.test.ts` › rejects traversal and symlinks | |
| `GET /files`, `GET /file` + hash | done | `api.test.ts` › lists, reads with a version, PUT with stale version → 409… | |
| Pull procedure via `POST /open` | done | `api.test.ts` › pull on open brings Obsidian changes…; `repo.test.ts` › brings in remote changes and keeps local uncommitted changes; › folds an unpushed commit into uncommitted changes… | Survive/fold cases are tested at the `Repo` level, not through `/open`. |
| Per-vault lock | done | `lock.test.ts` (5); `api.test.ts` › commit issued during a long save waits for it; › pull on open … skipped while a shared holder runs | The "long PUT" is a held shared `save` lock. |
| Admin UI + switcher | done | `admin.spec.ts` › add a vault → cloned → in the switcher; edit its name; remove it | |
| File tree, CM6 Read/Write, wikilinks | done | `notes.spec.ts` › Read/Write toggle; wikilink click navigates in both modes (screenshot `ideas-read.png`); `fix-17.spec.ts` | |
| Offline read-only cache | partly | `offline.spec.ts` › going offline…; › a previously opened note renders from the cache | Skipped on WebKit (Playwright limit); needs a real iPhone/iPad (D43). |

## Phase 3 — Edit + git (M2)

| Step | Status | Evidence | Note |
|---|---|---|---|
| `PUT /file` version, 409 stale | done | `api.test.ts` › lists, reads with a version, PUT with stale version → 409… | |
| Autosave + stale-save dialog | done | `editing.spec.ts` › typing autosaves…; › stale save: … overwrite keeps mine; › stale save: reload… | |
| Changes API + Discard | done | `api.test.ts` › changes + diff + discard; `repo.test.ts` › lists changed files and discards one back to HEAD | |
| Status + event stream (watcher, `.git/` excluded, snapshot on connect) | done | `api.test.ts` › snapshot first; a file written behind the back → files-changed + status within 1 s; `plan-gaps.test.ts` › every reconnect starts with a status snapshot…; › writes inside .git/ emit no files-changed event **(new)** | |
| Counter + Show changes via event stream; hidden → visible reconnects | done | `editing.spec.ts` › changes badge follows the event stream…; › event stream reconnects after the connection drops; `plan-gaps.spec.ts` › tab hidden → visible reconnects the vault event stream **(new)** | |
| Commit: flush, pull → commit → push, author = user | done | `api.test.ts` › commit = pull → commit all → push…; `repo.test.ts` › commits all changes, pushes, leaves a clean tree; author = user; `git.spec.ts` › commit within the 1.5 s autosave debounce… | |
| Push failure → unpushed; retry | done | `api.test.ts` › push failure → unpushed; retry push later succeeds; `repo.test.ts` › push failure keeps the commit local; the next pull pushes it; `git.spec.ts` › push failure → unpushed commit + retry | |
| Conflict state from stash entry; 423; survives restart | done | `api.test.ts` › conflict: 423 on writes, survives restart…; `repo.test.ts` › stash pop failure → conflict… | Conflict paths also persisted in the config store (D10). |
| Resolution mine / theirs / both + edge cases | done | `repo.test.ts` › keep mine / theirs / both…; › keep both with a deleted side…; › untracked-only clash…; `git.spec.ts` › conflict … keep both | |
| Commit reminder | done | `reminder.test.ts` (5); `git.spec.ts` › commit reminder above the threshold offers Commit | e2e uses threshold 2 (3rd file) instead of the default 4 (5th). After the 2nd dismissal it stays away (D22). |
| Remove blocked while dirty | done | `api.test.ts` › DELETE is blocked while uncommitted changes exist… | The extra unpushed-commits block (D11) has no test. |
| Search scoped to vault root | done | `api.test.ts` › subfolder root: files are scoped to it…; › search finds content and file names | |

## Phase 4 — AI reads (M3)

| Step | Status | Evidence | Note |
|---|---|---|---|
| Every call passes the vault root as `directory` | done | `chat.test.ts` › sessions of vault A never appear under vault B | |
| Every M3 prompt uses `vault-readonly` | deviated | `chat.test.ts` › prompt → 202; turn runs with agent "vault"…; › in Conflict every turn uses "vault-readonly"; `chat.llm.test.ts` › in Conflict the edit is denied… | Superseded by the P5 agent choice. The `@llm` check asserts "no completed write, file unchanged": edit tools aren't offered, so there's no permission-denied event (spike #4). |
| Chat API: list/create, prompt 202, NDJSON stream, child sessions filtered | partly | `chat.test.ts` › stream: queued → running → idle over NDJSON…; › child sessions (subagents) are left out of the list; `plan-gaps.llm.test.ts` › the NDJSON stream carries text and tool parts in the order of the stored message **(new, not yet green)** | Text + tool part order is only checked by the new `@llm` test, which timed out here (see below). |
| One opencode subscription per vault, independent of clients | partly | `chat.test.ts` › opens the event subscription when a vault is added (onReady hook); `plan-gaps.llm.test.ts` › client disconnects mid-turn → the turn still finishes and the lock is released on idle; › reconnect while the turn still runs → messages reload, the stream re-attaches… **(new, not yet green)** | Disconnect/re-attach mid-turn is only covered by the new `@llm` tests (see below). |
| Abort | done | `chat.llm.test.ts` › abort mid-turn → idle, lock released, the next queued prompt starts; `chat.test.ts` › abort removes a queued prompt; `chat.spec.ts` › Stop aborts a running turn | |
| ACP-shaped mapping module | done | `harness-map.test.ts` (7 tests); the web app imports only `@karpathy/shared` types | |
| Pull before every turn | done | `chat.test.ts` › pull runs before the turn is dispatched: local HEAD equals the remote | |
| One running turn per vault; queue; "waiting for other chat" | done | `chat.test.ts` › one running turn per vault: a second chat queues…; `plan-gaps.spec.ts` › a prompt in a second chat shows "Waiting for other chat…" **(new)**; `fix-13.spec.ts` | Default tier with a dead model instead of `@llm` (deterministic). |
| Chat list, resume iPad → iPhone | done | `chat.spec.ts` › chat on iPad: send, streaming answer, consulted-file chip; resume on iPhone; delete | |
| Streaming text + consulted-file chips | done | same `chat.spec.ts` test (screenshot `ipad-chat.png`); `chat.llm.test.ts` › read tools show up as consulted files | |
| Model = server-wide setting | done | `chat.test.ts` › changing the model in settings changes the model reported for new turns **(new)**; `config-store.test.ts` › starts with default settings (threshold 4, Claude Sonnet 5) | Claude Sonnet 5 itself never ran (no Anthropic key; D3). |

## Phase 5 — AI writes (M4)

| Step | Status | Evidence | Note |
|---|---|---|---|
| Agent per prompt: `vault` / `vault-readonly` in Conflict (chat banner) | done | `chat.test.ts` › prompt → 202; turn runs with agent "vault"…; › in Conflict every turn uses "vault-readonly"; `chat.llm.test.ts` › in Conflict the edit is denied…; `plan-gaps.spec.ts` › chat shows the read-only banner while the vault is in Conflict… **(new)** | |
| AI edits in counter + Show changes | done | `chat.llm.test.ts` › the vault agent edits a note → edit/write event, counter increments, diff visible…; `chat.spec.ts` › AI write → changed chip, "Open changed page", changes counter increments | |
| Open note reloads on AI change / stale-save flow | done | `editing.spec.ts` › file changed elsewhere with no unsaved edits → silent reload + notice; › stale save: … | The "AI change" is simulated by a write from the API (same watcher path), not by a model turn. |
| "Open changed page" | done | `chat.spec.ts` › AI write → … "Open changed page" … | |
| Commit message proposal, throwaway session, fallback | done | `chat.test.ts` › commit message: fallback when the model fails; throwaway session deleted, chat list unchanged; › commit message: fallback when opencode is down; `chat.llm.test.ts` › commit message proposal comes back for a real diff… | Only fast failures are tested; the 15 s timeout path isn't. |
| AI-touched set + trailer | done | `api.test.ts` › AI-touched set: trailer iff a touched path is committed…; `chat.llm.test.ts` › the vault agent edits a note → … AI-touched set filled | |
| End-to-end run on real iPhone + iPad via VPN | not done | manual — not possible here | D5. |
| Deploy to the home server, `/api/health` via VPN only | not done | manual — not possible here | D5, D16 (Cloudflare assumed for DNS-01). |

## Spec requirements (mvp.md §2–§3) without any test

- §2.1 The default model (Claude Sonnet 5) and any non-Ollama provider never ran (D3).
- §2.2 Editor: in-document search (CM6 search panel) and frontmatter handling *in the editor* (only `markdown.test.ts` › splitFrontmatter for Read mode; `editing.spec.ts` checks a byte-exact round trip).
- §2.3 Changing the vault root hides past chats; changing the repo keeps them listed.
- §2.3 PATCH of repo/root refused with unpushed commits (only branch is tested, #35); DELETE blocked with unpushed commits (D11).
- §2.4 Commit message: diff truncated to 32 KB; 15 s timeout fallback; proposal runs without the vault lock.
- §2.4 Watcher debounce of 300 ms (only "within 1 s" is asserted).
- §2.4 UI labels "waiting for AI turn" / "syncing…" for saves and exclusive operations waiting on the lock.
- §2.5 Secrets reach only their service *at runtime* for the proxy (DNS token) — only checked in the compose config.
- §3.1 Admin area shows pull / conflict status per vault.
- §3.1 "denied" chip in the chat UI (the mapping is tested in `harness-map.test.ts`, the chip isn't).
- §3.2 Constant-time token compare.
- §3.2 opencode `retry` status (provider retries) mapped to a UI state.
- §3.2 Prod CSP headers themselves (the e2e `cspGuard` only fails on CSP violations when run against `compose.prodtest.yml`).
- §3.3 VPN-only reachability and the real DNS-01 certificate.
