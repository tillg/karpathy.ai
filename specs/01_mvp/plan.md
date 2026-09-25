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
  stack.
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
| `snapshot: false`, `edit: allow`, `bash` restricted, `git commit*`/`git push*` deny | AI edit works; AI `git commit` attempt is denied |
| Disable global Claude lookups, empty `$HOME` | Session only picks up the vault's `AGENTS.md`/`CLAUDE.md` + `.claude/skills` |
| Restart the container with the data volume mounted | Previous session is listed and resumable |

**Exit:** all rows pass, or the spec is amended (e.g. fallback: one opencode container per
vault if confinement to a subfolder fails).

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
| `POST/GET/PATCH/DELETE /vaults`; clone with backend-only GitHub token; optional vault root | Integration: clone test vault (root + subfolder variant); DELETE removes clone, never touches remote |
| Path guard: resolve inside vault root, reject `..` and symlinks | Tests with traversal and symlink fixtures → 400 |
| `GET /files`, `GET /file` (content + hash) | Integration against test vault; hash changes when file changes |
| Pull on vault open (`pull --rebase --autostash`) | Push a change to the remote from a second clone → appears after reopening |
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
| Changed-files counter + Show changes view | Playwright: counter matches `git status` |
| Commit endpoint: flush → pull → commit all → push; author = user | Integration: remote has 1 new commit with all changes; working tree clean |
| Push failure → unpushed state; retry on next commit/pull | Integration with remote made unreachable: commit local, status "1 unpushed"; restore remote → next pull pushes it |
| Conflict detection on pull/autostash failure; writes blocked | Integration: conflicting edits local + remote → vault state `conflict`, `PUT /file` → 423 |
| Conflict resolution per file: keep mine / theirs / both (default both → `Foo.conflict-<date>.md`) | Integration per option; vault returns to normal; nothing lost with "both" |
| Commit reminder: above threshold, dismiss → again at 2× threshold | Unit test on reminder logic; Playwright: 5th changed file → dialog with Commit button |
| Remove vault blocked while uncommitted changes exist | `DELETE /vaults/:id` → 409 with dirty tree |
| Search (`ripgrep`) scoped to vault root | Integration: hit in root, no hit from outside a subfolder vault |

---

## Phase 4 — AI reads (M3)

Goal: chat with the AI about the active vault; it reads but cannot write yet.

| Step | Verify |
|---|---|
| opencode client in backend; every call passes vault root as `directory` | Integration: sessions of vault A never appear under vault B |
| opencode config from Phase 0, plus `edit: deny` for this phase | Prompt "change file X" → denied, file unchanged |
| `POST /vaults/:id/chat` streams mapped events over `fetch` stream (token in header) | Integration: stream contains text parts + tool parts in order |
| Keep the backend↔harness mapping in one ACP-shaped module (session/prompt/update/tool_call/permission) | Module has its own tests; frontend only consumes the mapped types from `packages/shared` |
| Pull before chat start | Remote change present in the AI's answer |
| One running turn per vault; further prompts queue | Integration: two parallel prompts → second starts after first ends; UI shows "waiting for other chat" |
| Chat list per vault (via opencode session API), resume a chat | Playwright: start chat on "iPad" viewport, resume on "iPhone" viewport |
| Chat UI: streaming text, consulted-files chips | Playwright + screenshot: chips list the files the AI read |
| Model = server-wide setting (default Claude Sonnet 5) | Changing it in settings changes the model reported for new turns |

---

## Phase 5 — AI writes (M4) = **MVP**

Goal: the AI edits notes; changes land as uncommitted changes the user reviews and commits.

| Step | Verify |
|---|---|
| Switch opencode `edit` to `allow` for vaults not in Conflict; `deny` during Conflict (banner in chat) | Integration: AI edit works normally; in conflict state it is denied and chat still answers |
| AI edits show up in counter + Show changes | Prompt edit → counter increments, diff visible |
| Open note reloads on AI change if it has no unsaved changes, with notice; stale-save flow otherwise | Playwright both cases |
| "Open changed page" action in chat | Playwright: click → note opens at the changed file |
| Commit message proposal by the AI from the diff; editable; `Co-authored-by:` agent trailer when AI changes are included | Integration: commit contains trailer only when AI touched files |
| End-to-end mobile run on the real device via VPN (iPhone + iPad, installed PWA) | Manual checklist: open vault, edit, ask AI to edit, review, commit & push, see change in Obsidian mobile |
| Deploy to the home Ubuntu server (prod compose, DNS-01 cert) | `https://<domain>/api/health` ok from a VPN client; not reachable without VPN |

**MVP done** when all Phase 1–5 verifies pass and the e2e checklist is completed on real
devices.

---

## Phase 6 — Skills (M5, post-MVP)

| Step | Verify |
|---|---|
| Python + skill deps in the opencode image | `film-import.py --help` etc. runs in the container |
| Check each wiki skill under opencode (tool names, frontmatter, commit steps removed) | Per-skill checklist in `specs/01_mvp/skills-portability.md` |
| `query` and `lint` usable on mobile | Playwright run of both on the test vault; real run on the life wiki |
| Secrets for `ingest-email` / instascraper as compose secrets (opencode only) | `ingest` fetches from the Gmail label on the server |
| Try at least one non-Claude model for `query`/`lint` | Result documented (works / where it breaks) |

---

## Cross-cutting rules

- Tests first: every verify above is written as a test before the implementation, where
  it can be automated.
- No mocks: integration tests use real git, a real (throwaway) GitHub repo, and the real
  opencode container.
- Keep `README.md`, `mvp.md` and `CONTEXT.md` in sync with any decision that changes
  during implementation. Record hard-to-reverse surprises as ADRs.
