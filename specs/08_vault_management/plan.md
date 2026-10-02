---
feature: 08_vault_management
title: "Plan: vault list, GitHub token, checked attach"
status: applied
order: 4
created: 2026-10-02
edited: 2026-10-02
---

# Plan: vault list, GitHub token, checked attach

Test-first, in dependency order. Backend tests run with `npm -w apps/backend test` (real git against local bare
repos, no mocks). e2e runs with `just e2e` against the running dev stack (`just dev`). "Full suite" means
`just check`. The three phases ([architecture §1](architecture.md#1-overview)) can be reviewed and shipped one
at a time.

## Phase 1: GitHub token in the config store

- [x] Store the token in `ConfigData.githubToken`, separate from `settings`
  - Test first: `apps/backend/test/config-store.test.ts` › "githubToken round-trips and is not part of settings": set, reopen the store, read it back, and assert `get().settings` has no `githubToken`. Fails today: the key doesn't exist.
  - Verify: `npm -w apps/backend test -- config-store` → green; `just check` → green
- [x] `GitHubToken` module: `current()` / `source()` with stored-over-secret precedence, `set` / `clear`
  - Test first: `apps/backend/test/github-token.test.ts` › "stored token wins over secret; clear falls back; none when neither". Fails today: the module doesn't exist.
  - Verify: `npm -w apps/backend test -- github-token` → green; `just check` → green
- [x] `redact()` covers every token value seen since startup
  - Test first: `github-token.test.ts` › "after set(B), messages containing old token A and B are both redacted". Fails today: no such function.
  - Verify: `npm -w apps/backend test -- github-token` → green
- [x] `Vaults` reads the token through a getter, so a change applies without a restart
  - Test first: `apps/backend/test/github.github.test.ts` › "token changed at runtime is used by the next clone": a wrong token at startup, the real one set via `GitHubToken.set`, then the private test vault clones. file:// remotes never send the auth header, so this runs against real GitHub. Fails today: `env.githubToken` is the startup string.
  - Verify: `npm run test:github` → green; `just check` → green
- [x] `GET /settings` returns `githubToken: { source, last4 }`, never the plaintext; `PUT` / `DELETE /settings/github-token`
  - Test first: `api.test.ts` › "PUT token → GET shows source settings + last4 and the response body does not contain the token"; "DELETE → source secret"; "PUT with whitespace or < 20 chars → 400". Fails today: routes missing.
  - Verify: `npm -w apps/backend test -- api` → green; `just check` → green
- [x] Shared types `SettingsView`, `TokenTest`; zod `githubTokenBody`
  - Test first: none, types only. `just check` typecheck covers it.
  - Verify: `npm run typecheck` → exit 0
- [x] `POST /settings/github-token/test`: per-vault `git ls-remote` check
  - Test first: `api.test.ts` › "test lists each vault with ok:true for a reachable file:// remote and ok:false with a message for a deleted remote". Fails today: the route is missing.
  - Verify: `npm -w apps/backend test -- api` → green
- [x] `POST /settings/github-token/test`: identity via `GET {GITHUB_API_BASE}/user` (login, scopes, expiry), for a body token or the stored one
  - Test first: `apps/backend/test/github.github.test.ts` › "valid token → ok, login set"; "garbage token → ok:false, error mentions 401". Real GitHub, no stub. Fails today: the route is missing.
  - Verify: `npm run test:github` → green (needs `GITHUB_TOKEN`); `just check` → green

## Phase 2: Attach preflight

- [x] Test fixtures carry `Sources/` and `Wiki/` (decided 2026-10-02): backend `makeRemote` seeds `Sources/.gitkeep` and `Wiki/.gitkeep` unless `{ structure: false }` (skipping a folder the files already have in any case); `make-vault.py` likewise; the GitHub test vault gets the two files pushed (done: `1cf708c` in `tillg/karpathy-app-test-vault`)
  - Test first: none, fixture-only. Existing tests pass before and after (the folders are dot-file-only, so they don't change any counts except exact file lists, which are updated per the approved list).
  - Verify: `npm -w apps/backend test` → green; `npm run test:github` → green
- [x] `preflight(repo, branch, root)`: blobless depth-1 clone into `vaultsDir/.preflight/<rand>`, returns missing folders, always cleans up
  - Test first: `apps/backend/test/repo.test.ts` (or new `preflight.test.ts`) › cases "both present → []", "only Sources → ['Wiki']", "file named Wiki → ['Wiki']", "root sub/ respected", "tmp dir gone afterwards, also on error". Fails today: no preflight.
  - Verify: `npm -w apps/backend test -- preflight` → green
- [x] `POST /vaults` refuses unreachable repo / missing branch / missing root with 422 `repo-unreachable` / `root-missing`, and stores nothing
  - Test first: `api.test.ts` › "POST /vaults for a nonexistent remote → 422 repo-unreachable and GET /vaults is unchanged"; the same for the branch and the root. Fails today: it returns 202 and stores a vault that turns `clone-failed`.
  - Verify: `npm -w apps/backend test -- api` → green
- [x] `POST /vaults` with missing folders and no `createFolders` → 409 `missing-folders { missing }`, nothing stored
  - Test first: `api.test.ts` › "repo without Sources/Wiki → 409 with missing ['Sources','Wiki']; config has no new vault; no clone dir". Fails today: 202.
  - Verify: `npm -w apps/backend test -- api` → green
- [x] `createFolders: true` stores `pendingFolders`, and after the clone writes `<root>/<f>/.gitkeep`, shown as uncommitted changes
  - Test first: `api.test.ts` › "createFolders → ready, git status lists Sources/.gitkeep and Wiki/.gitkeep as untracked, pendingFolders cleared"; "restart during clone still creates them"; "a file named Sources → clone-failed with a clear message". Fails today: the field is unknown.
  - Verify: `npm -w apps/backend test -- api` → green
- [x] A folder containing only `.gitkeep` still shows in the file tree
  - Test first: `api.test.ts` › "GET /files lists folder Sources with no children" (asserted in the createFolders test). Passed without code: `listTree` already lists dot-file-only folders.
  - Verify: `npm -w apps/backend test -- api` → green; `just check` → green
- [x] Existing preflight-free paths unchanged: retry of a `clone-failed` vault, `PATCH` repo/branch/root
  - Test first: existing `api.test.ts` patch/retry tests pass before and after.
  - Verify: `npm -w apps/backend test` → green

## Phase 3: Admin modal views

- [x] Modal opens on the vault list; clicking a row opens details; Back returns
  - Test first: `e2e/admin.spec.ts` › new "list → details → back": list rows show name + `repo · branch`, details show the edit fields. Fails today: no details view.
  - Verify: `just e2e admin` → green
- [x] Existing `admin.spec.ts` add/edit/remove flow goes through the new views
  - Test first: existing "add a vault → cloned → …" adjusted only in navigation (click into details before Edit/Remove, wait for the list after Remove), with the same assertions. User OK 2026-10-02, also for the navigation-only changes in a11y-keyboard, fix-15, fix-16, fix-24, git and version.
  - Verify: `just e2e admin` → green
- [x] "a repo that cannot be cloned shows clone-failed" becomes "an unreachable repo is refused inline and not attached"
  - Test first: rewrite the test. Its expected behavior changes by design ([proposal](proposal.md#assumptions)). User OK 2026-10-02. Fails today: the inline error doesn't exist.
  - Verify: `just e2e admin` → green
- [x] "Edit vault" CTAs (`NotePane`, `ChangesPanel`) open that vault's details
  - Test first: `e2e/fix-22.spec.ts` › the clone-failed flow's "Edit vault" now expects `vault-details` of that vault. Its clone-failed vault is set up via a PATCH to a missing repo, because preflight refuses a missing repo at add. Failed before the change: it opened the list.
  - Verify: `just e2e fix-22` → green
- [x] Add flow: missing folders → confirm → "Don't attach" leaves the list unchanged; "Create folders" attaches and the folders appear in the changes list
  - Test first: `e2e/admin.spec.ts` › one case covering both buttons, seeding a bare repo without folders via `makePlainRemote` (e2e helper). Fails today: no dialog.
  - Verify: `just e2e admin` → green
- [x] Settings view: token field shows the masked state, Save / Remove, Test token shows the result line and per-vault lines
  - Test first: `e2e/admin.spec.ts` › "save token → placeholder shows last4; Test token → per-vault lines" (the dev stack's file remotes give `ok` per vault; the identity line is asserted only to exist). Fails today: no token block.
  - Verify: `just e2e admin` → green
- [x] `(?)` "What is a vault?" opens the help dialog (Sources, Wiki, Schema optional)
  - Test first: `e2e/admin.spec.ts` › "help dialog explains Sources and Wiki". Fails today: no link.
  - Verify: `just e2e admin` → green
- [x] Accessibility of the new views and dialogs
  - Test first: extend the axe spec (`e2e/a11y.spec.ts`) to scan the list, details, settings, the help dialog and the confirm dialog. Written after the UI code, so it was not seen failing first.
  - Verify: `just e2e a11y` → green; full `just e2e` → green except the pre-existing GoDaddy Caddy-module check in `plan-gaps` (unrelated) and one `@llm` timing flake that passes on rerun
- [x] Mobile width: list, details, settings usable at 375 px
  - Test first: `e2e/mobile.spec.ts` › "admin views fit 375px, no horizontal scroll". Written after the UI code, so it was not seen failing first.
  - Verify: `just e2e mobile` → green; screenshots of each view (incl. the bottom of the settings view) in `tmp/08/` and looked at
- [x] README: GitHub token in settings (secret as fallback), vault structure, attach check
  - Test first: none, docs only.
  - Verify: `grep -n "Test token" README.md && grep -n "Sources/" README.md` → both match; `just check` → green

System docs are updated at `/spec:archive`.
