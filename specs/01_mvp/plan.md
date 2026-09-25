# MVP — Implementation Plan

Phased plan for [`mvp.md`](mvp.md) (terms: [`CONTEXT.md`](../../CONTEXT.md)). Each phase ends
in a runnable, demoable state. Every step is a `step → verify` pair; a phase is done only
when all its verifies pass mechanically (tests green, e2e run, screenshot checked).

MVP boundary = end of **Phase 5** (spec milestone M4). Phase 6 (M5) is the first extension.

```
P0 Spike ─► P1 Scaffold ─► P2 Vaults+Read ─► P3 Edit+Git ─► P4 AI reads ─► P5 AI writes ─► P6 Skills
 (risk)      (M0)            (M1)              (M2)            (M3)           (M4) = MVP      (M5)
```

## Tooling assumptions

Stated here so they aren't re-decided per phase:

- **Monorepo, npm workspaces:** `apps/web` (Vite + React + TS), `apps/backend` (Node + TS),
  `packages/shared` (API types), `deploy/` (compose files, Caddyfile, opencode config).
- **Tests:** Vitest (unit + backend integration against real git repos in temp dirs and a
  real opencode container, no mocks); Playwright for e2e against the running compose
  stack. Three tiers, tagged:
  - **default** (`npm test`, every PR in CI): unit tests + git integration tests against a
    **local bare repo as the remote** (real git, real fetch/push; a second clone plays
    "Obsidian") + opencode container start/health, **no prompts**. No secrets needed.
  - **`@github`** (nightly CI + locally): clone/push with the token against the throwaway
    GitHub test vault. CI secret: `TEST_VAULT_TOKEN` (fine-grained, test repo only).
  - **`@llm`** (nightly CI + locally, cheap model): anything that needs a model to make a
    tool call. CI secret: one provider key with a spending cap. Rules for these tests:
    - Prompts name the tool explicitly ("Use the edit tool to …").
    - Assertions check **tool/permission events and the file system, never answer text**.
    - If the model made no tool call at all, the test fails as *inconclusive* (a separate
      message), not as passed.
    - At most one retry.
- **Backend HTTP:** Express 5 (native async errors, `res.write` streaming; tests via
  `supertest`, input validation via zod). Config store: one JSON file on the config
  volume (atomic write via temp file + rename).
- **Test vault:** a dedicated throwaway GitHub repo (`karpathy-ai-test-vault`) with a
  subfolder variant, used by integration and e2e tests. Never the real life wiki.

---

## Phase 0 — Spike: de-risk opencode (½–1 day)

Goal: confirm the opencode assumptions the architecture rests on, before any scaffolding.
Results go into `specs/01_mvp/spike-opencode.md`.

| Step | Verify |
|---|---|
| Run pinned `opencode serve` in a container with two vault dirs mounted | `GET /session?directory=A` and `…=B` return separate session lists |
| Create session in vault A, prompt "list files", stream `GET /event` | Event stream shows tool parts; only vault-A files are listed |
| Config `external_directory: deny`, vault root = **subfolder** of a repo; prompt the AI to read a file above the subfolder and in vault B | Both reads are denied (answers the open question in mvp §6) |
| `snapshot: false`, `bash: deny`, `webfetch: deny`, no `ask` rules | AI bash attempts (write a file, `cat /vaults/B/x.md`, `env`, `git commit`) all come back as permission-denied events; files unchanged; the turn never blocks waiting for an approval |
| Agents `vault` (`edit: allow`) + `vault-readonly` (`edit: deny`); pick per prompt via the SDK `agent` field, two vaults at once | Same server, same moment: edit in vault A with `vault` succeeds, edit in vault B with `vault-readonly` is denied |
| Grep/glob/list tools with a path outside the vault root | Denied by `external_directory` (not only read/edit) |
| Disable global Claude lookups, empty `$HOME` | Session only picks up the vault's `AGENTS.md`/`CLAUDE.md` + `.claude/skills` |
| Restart the container with the data volume mounted | Previous session is listed and resumable |

**Exit:** all rows pass, or the spec is amended. If confinement to a subfolder fails, apply
the fallback in mvp §6 (vault root = repo root only) and drop the subfolder variants from
P2/P3 tests. If the per-prompt `agent` field doesn't exist or
doesn't apply permissions, stop and re-decide how permissions differ per vault before P1.

---

## Phase 1 — Scaffold (M0)

Goal: `docker compose up` gives an HTTPS PWA shell that talks to an authenticated backend.

| Step | Verify |
|---|---|
| Monorepo skeleton, lint + typecheck + Vitest wired | `npm test` and `npm run typecheck` pass in CI (GitHub Actions) |
| `deploy/compose.yml`: proxy, backend, opencode; volumes vaults/config/opencode-data; same UID/GID; only proxy publishes ports | `docker compose config` valid; `docker compose ps` all healthy; opencode not reachable from host |
| `compose.dev.yml` override: bind-mounted sources, Vite HMR, backend watch | Editing a React component hot-reloads in the browser without a rebuild |
| Caddy: dev = internal TLS on `localhost`; prod = DNS-01 on own domain | `curl https://localhost/` 200 in dev; prod config passes `caddy validate` |
| Bearer-token middleware on every `/api` route (constant-time compare) | Tests: no token → 401, wrong token → 401, right token → 200; static assets public |
| Frontend shell: token entry screen, stored on device; PWA manifest + icons | Playwright: enter token → shell renders; Lighthouse PWA installable check passes |
| `/api/health` reports backend + opencode reachability | Returns `{backend: ok, opencode: ok}` inside the stack |

---

## Phase 2 — Vaults + read (M1)

Goal: attach a GitHub repo in the admin area and browse/read its notes on the phone.

| Step | Verify |
|---|---|
| Config store: vaults list + settings (threshold default 4, model) | Unit tests: CRUD, atomic write survives kill mid-write |
| `POST/GET/PATCH/DELETE /vaults`; async clone (`cloning` → `ready`/`clone-failed`) with backend-only GitHub token; optional vault root | `@github` integration: clone test vault (root + subfolder variant); bad repo → `clone-failed` with error; DELETE removes clone, never touches remote |
| PATCH rules (mvp §2.3): name always; repo/branch/root only on a clean tree | Integration: dirty tree → 409; branch change checks out the branch; repo change re-clones; root change to a missing folder → 400 |
| Path guard: resolve inside vault root, reject `..` and symlinks | Tests with traversal and symlink fixtures → 400 |
| `GET /files`, `GET /file` (content + hash) | Integration against test vault; hash changes when file changes |
| Pull procedure (mvp §2.4 steps 1–5; no rebase, no `--autostash`) via `POST /vaults/:id/open` | Push a change to the remote from a second clone → appears after reopening; with local uncommitted changes they survive; with an unpushed commit + moved remote → commit folded into uncommitted changes, nothing lost |
| Per-vault lock (shared: PUT, turn; exclusive: pull/commit/discard/resolve/clone/remove) | Unit tests on the lock; integration: commit issued during a long PUT waits for it; vault-open pull while a shared holder runs is skipped |
| Admin UI (list, add/edit/remove, clone/pull status) + vault switcher | Playwright: add test vault → appears in switcher |
| File tree + CM6 in Read mode and Write mode (read-only for now); wikilink decoration + click navigation | Playwright: open note, toggle Read/Write, click `[[link]]` → target opens; screenshot checked |
| Offline read-only cache of recently opened notes (service worker) | Playwright offline mode: previously opened note renders; edit disabled, banner shown |

---

## Phase 3 — Edit + git (M2)

Goal: edit on the phone, see uncommitted changes, commit & push, survive Obsidian edits.

| Step | Verify |
|---|---|
| `PUT /file` with required version; 409 on stale version | Tests: matching hash → 200; changed on disk → 409 |
| Editor autosave (debounced ~1.5 s), stale-save dialog (reload / overwrite) | Playwright: type → saved; change file on disk meanwhile → dialog appears |
| Changes API: list changed files + per-file diff; Discard file | Integration: edit 2 files → both listed; discard one → restored to HEAD |
| `GET /vaults/:id/status` + event stream `GET /vaults/:id/events` (file watcher, `.git/` excluded, snapshot on connect) | Integration: write a file behind the backend's back (as opencode would) → `files-changed` + `status` events within 1 s; reconnect → snapshot first |
| Changed-files counter + Show changes view, driven by the event stream | Playwright: counter matches `git status`; a file changed on disk updates the counter without reload; tab hidden → visible reconnects the stream |
| Commit: frontend flushes the pending autosave, then backend takes exclusive lock → pull → commit all → push; author = user | Integration: remote has 1 new commit with all changes; working tree clean. Playwright: type, commit within the 1.5 s debounce → typed text is in the commit |
| Push failure → unpushed state; retry on next commit/pull | Integration with remote made unreachable: commit local, status "1 unpushed"; restore remote → next pull pushes it |
| Conflict = stash pop failed; state derived from the `karpathy-ai-pull` stash entry; writes blocked | Integration: conflicting edits local + remote → vault state `conflict`, `PUT /file` → 423; restart backend → still `conflict` |
| Conflict resolution per file: keep mine / theirs / both (default both → `Foo.conflict-<date>.md`); then `git reset -q` + `stash drop` | Integration per option, plus cases: both sides added the same new file (untracked mine from `stash^3`), modify vs delete; vault returns to normal, no stash left, no unmerged entries; nothing lost with "both" |
| Commit reminder: above threshold, dismiss → again at 2× threshold | Unit test on reminder logic; Playwright: 5th changed file → dialog with Commit button |
| Remove vault blocked while uncommitted changes exist | `DELETE /vaults/:id` → 409 with dirty tree |
| Search (`ripgrep`) scoped to vault root | Integration: hit in root, no hit from outside a subfolder vault |

---

## Phase 4 — AI reads (M3)

Goal: chat with the AI about the active vault; it reads but cannot write yet.

| Step | Verify |
|---|---|
| opencode client in backend; every call passes vault root as `directory` | Integration: sessions of vault A never appear under vault B |
| opencode config from Phase 0; every prompt in this phase uses agent `vault-readonly` | Integration: request sent to opencode carries `agent: vault-readonly` (deterministic). `@llm`: "use the edit tool to change X" → permission-denied event, file unchanged |
| Chat API (mvp §3.2): list/create chats, `prompt` → 202, `stream` (NDJSON over `fetch`, token in header); child sessions filtered from list | Integration: stream contains text parts + tool parts in order; a subagent's child session never shows up in the list |
| One opencode event subscription per vault, independent of clients | Integration: prompt, disconnect the client mid-turn → turn finishes, lock released on idle; reconnect → messages reloaded, stream re-attached while still running |
| Abort: queued prompt removed / running turn aborted via `session.abort` | `@llm` integration: abort mid-turn → session idle, lock released, next queued prompt starts; Playwright: Stop button |
| Keep the backend↔harness mapping in one ACP-shaped module (session/prompt/update/tool_call/permission) | Module has its own tests; frontend only consumes the mapped types from `packages/shared` |
| Pull (exclusive lock) before every turn | Integration: remote change pushed → local HEAD equals remote before the prompt is dispatched to opencode (no model needed) |
| One running turn per vault (shared lock); further prompts queue | `@llm` integration: two parallel prompts → second is dispatched only after first's idle event; UI shows "waiting for other chat" |
| Chat list per vault (via opencode session API), resume a chat | Playwright: start chat on "iPad" viewport, resume on "iPhone" viewport |
| Chat UI: streaming text, consulted-files chips | Playwright + screenshot: chips list the files the AI read |
| Model = server-wide setting (default Claude Sonnet 5) | Changing it in settings changes the model reported for new turns |

---

## Phase 5 — AI writes (M4) = **MVP**

Goal: the AI edits notes; changes land as uncommitted changes the user reviews and commits.

| Step | Verify |
|---|---|
| Agent choice per prompt: `vault` normally, `vault-readonly` while in Conflict (banner in chat) | Integration: agent field matches vault state (deterministic). `@llm`: edit works normally; in conflict → permission-denied event, file unchanged |
| AI edits show up in counter + Show changes | `@llm`: prompt edit → edit tool event, counter increments, diff visible |
| Open note reloads on AI change if it has no unsaved changes, with notice; stale-save flow otherwise | Playwright both cases |
| "Open changed page" action in chat | Playwright: click → note opens at the changed file |
| Commit message proposal via a throwaway `commit-message` session (deleted afterwards; 15 s timeout → "Update N files") | Integration: after the proposal the chat list is unchanged; with opencode stopped → fallback text. `@llm`: a proposal comes back for a real diff |
| AI-touched set from opencode `edit`/`write` events, persisted on the config volume; trailer iff a touched path is committed | Integration (drive the set via real tool events in `@llm`, set logic unit-tested): human-only commit → no trailer; AI edit → trailer; AI edit then Discard → no trailer; set survives backend restart and is empty after commit |
| End-to-end mobile run on the real device via VPN (iPhone + iPad, installed PWA) | Manual checklist: open vault, edit, ask AI to edit, review, commit & push, see change in Obsidian mobile |
| Deploy to the home Ubuntu server (prod compose, DNS-01 cert) | `https://<domain>/api/health` ok from a VPN client; not reachable without VPN |

**MVP done** when all Phase 1–5 verifies pass and the e2e checklist is completed on real
devices.

---

## Phase 6 — Skills (M5, post-MVP)

| Step | Verify |
|---|---|
| Python + skill deps in the opencode image | `film-import.py --help` etc. runs in the container |
| Replace `bash: deny` with an explicit command allowlist for the skills; decide on webfetch for `ingest` | `@llm` repeat of the P0 bash rows: allowed commands run; writes outside the vault, cross-vault reads and `env` still denied |
| Check each wiki skill under opencode (tool names, frontmatter, commit steps removed) | Per-skill checklist in `specs/01_mvp/skills-portability.md` |
| `query` and `lint` usable on mobile | Playwright run of both on the test vault; real run on the life wiki |
| Secrets for `ingest-email` / instascraper as compose secrets (opencode only) | `ingest` fetches from the Gmail label on the server |
| Try at least one non-Claude model for `query`/`lint` | Result documented (works / where it breaks) |

---

## Cross-cutting rules

- Tests first: every verify above is written as a test before the implementation, where
  it can be automated.
- No mocks: integration tests use real git (local bare remote in the default tier, the
  throwaway GitHub repo in `@github`) and the real opencode container with a real model
  (`@llm`). A scripted fake LLM provider would make `@llm` deterministic, but it counts as a
  mock and needs explicit approval first.
- Keep `README.md`, `mvp.md` and `CONTEXT.md` in sync with any decision that changes
  during implementation. Record hard-to-reverse surprises as ADRs.
