---
title: "Decisions"
created: 2026-10-02
edited: 2026-10-02
---

**Contents**

- [2026-10-02 17:16 — Clean up the specs/ sub-directories](#run-2026-10-02-1716)
  - [17:16 — Archive 08_vault_management and 06_md_to_html; keep 02, 03, 04, 05](#run-2026-10-02-1716-1)
  - [17:16 — Research results go to `specs/research/`, the open V1 plan to `specs/changes/v1/`](#run-2026-10-02-1716-2)
  - [17:16 — Keep 05_prod_env as research although its hoster decision is deployed](#run-2026-10-02-1716-3)
  - [17:16 — Rename 02_features despite the links in issues #64–#93](#run-2026-10-02-1716-4)
  - [17:16 — Archive by hand, without committing](#run-2026-10-02-1716-5)
  - [17:16 — No Playwright test marathon for a docs-only run](#run-2026-10-02-1716-6)
  - [17:21 — Put the feature report's hand-added menu bar into its build script](#run-2026-10-02-1716-7)

# 2026-10-02 17:16 — Clean up the specs/ sub-directories {#run-2026-10-02-1716}

- **Started by:** `/autonomous`
- **Task, as given:**

  > We have multiple sub-dirs in /sepcs. Pls clean up
  > - The ones that are done should be archives. Target is that they are gone and the what has been done is reflected in the system descriptoin
  > - The ones that are ope or research results remain but match our spec system

## 17:16 — Archive 08_vault_management and 06_md_to_html; keep 02, 03, 04, 05 {#run-2026-10-02-1716-1}

- **Status:** open
- **Context:** `specs/` held `02_features`, `03_browser_only`, `04_v1`, `05_prod_env`, `06_md_to_html`,
  `08_vault_management` next to `system/`. Their `status` keys were set inconsistently (research dirs
  carried `applied`/`applying`), so they could not decide the question.
- **Question:** which directories are "done" (archive) and which are open or research results (keep)?
- **Decision:** "done" = an implementation change that shipped. Archive `08_vault_management` (plan
  25/25 ticked, shipped in 5347702) and `06_md_to_html` (built as the md2html plugin, in use since
  2026-09-30). Keep `02_features` (research; result = issues #64–#93), `03_browser_only` (research, never
  to be built), `04_v1` (open draft plan), `05_prod_env` (research, see decision 3).
- **Why:** these are the only two whose outcome now lives in code; the others are reference material or
  plans still to act on.
- **Alternatives:** archive everything whose question was answered (02, 03, 05 too) — loses research that
  the user asked to keep.
- **Consequences:** 08 is folded into `specs/system/` (domain, architecture, functional, security). 06 has
  nothing app-level to fold: md2html is dev tooling and already documented in `CLAUDE.md`; links to the
  report now point to the pinned commit 5347702, like `01_mvp` does.

## 17:16 — Research results go to `specs/research/`, the open V1 plan to `specs/changes/v1/` {#run-2026-10-02-1716-2}

- **Status:** open
- **Context:** the spec plugin keeps open changes in `specs/changes/<kebab-name>/` (with `feature` = that
  name) and the system description in `specs/system/`; the repo used numbered `NN_snake_case` dirs.
  md2html's spec lint only treats `specs/changes/<name>/` as a change directory.
- **Question:** what does "match our spec system" mean for the kept directories?
- **Decision:** `04_v1` → `specs/changes/v1/` (an open plan = a change being explored). Research results →
  `specs/research/<kebab-name>/`: `features`, `browser-only`, `prod-env`. Their non-report notes drop
  `feature` and `status` (the lifecycle `exploring` → `applied` doesn't apply to research; outside
  `specs/changes/` md2html requires only `title`, `created`, `edited`) and keep `order` for the nav.
  `edited` is not bumped for this metadata-only change. `reports.json` → `specs.sources` now lists
  `specs/system/*.md`, `specs/changes/*/*.md`, `specs/research/*/*.md`.
- **Why:** research that will never be "applied" would otherwise sit in `specs/changes/` forever and show up
  in `/spec:overview` as an active change, and `/spec:propose` would ask to archive it first.
- **Alternatives:** all kept dirs into `specs/changes/` with `status: exploring` (strict plugin layout, but
  permanent overview noise); keep the numbered layout and only fix lint (least churn, but not the spec
  system's layout).
- **Consequences:** every relative link in the moved files gains one `../`; references in `README.md`,
  `CLAUDE.md`, `reports.json`, `specs/reports-nav.js`, `.gitignore`, `deploy/README.md`,
  `specs/system/security.md` and `build-report-html.mjs` are updated. Revisit if the spec plugin gets its
  own place for research. `specs/changes/v1/` holds only a report (`status: research`, not a spec
  status), so `/spec:overview` will show `v1` as an odd/inferred row and `/spec:propose` will suggest
  finishing it first; turning it into a real change (proposal, plan) is left to you.

## 17:16 — Keep 05_prod_env as research although its hoster decision is deployed {#run-2026-10-02-1716-3}

- **Status:** open
- **Context:** the prod-env report's decision (Hetzner, Tailscale, loop-mounted vault FS) is live and
  described in `specs/system/deployment.md`; its disk-space work items (check before adding a vault, clone
  cap) are not built (`functional.md` lists the gap).
- **Question:** archive 05 as done, or keep it as a research result?
- **Decision:** keep it, as `specs/research/prod-env/`.
- **Why:** it is a research report (frontmatter `status: research`); the hoster comparison, security
  reasoning and disk measurements are not in the system description and are still the basis for the open
  disk-space work; `security.md` and `deploy/README.md` link into it.
- **Alternatives:** archive it and fold its rationale into `deployment.md` (the decision is implemented),
  turning the disk items into a new change.
- **Consequences:** none for the code. If you consider it done, it can be archived later the same way as 08.

## 17:16 — Rename 02_features despite the links in issues #64–#93 {#run-2026-10-02-1716-4}

- **Status:** open
- **Context:** the 30 feature-research issues link to `specs/02_features/feature-report.md` on `main`.
- **Question:** move the feature research like the others, or leave it at its old path?
- **Decision:** move it to `specs/research/features/`.
- **Why:** one consistent layout; the links can be fixed in one loop.
- **Alternatives:** leave `02_features` where it is (no broken links, but one odd directory).
- **Consequences:** after the next push the issue links 404 until they are edited (`gh issue edit` over
  #64–#93, replacing `specs/02_features/` with `specs/research/features/`). Not done here: it is
  outward-facing.

## 17:16 — Archive by hand, without committing {#run-2026-10-02-1716-5}

- **Status:** open
- **Context:** `/spec:archive` commits twice after asking for the message; `/autonomous` forbids running
  `/spec:archive` and pushing, and the user didn't ask for a commit.
- **Question:** how to archive 08 and 06?
- **Decision:** do the archive steps by hand (tests, fold into `specs/system/`, delete the directory, fix
  references) and leave everything uncommitted in the working tree.
- **Why:** the user asked for the result explicitly; committing is left to them.
- **Alternatives:** the two-commit convention (`<message>` + `<message> - cleaned from change`).
- **Consequences:** review with `git status` / `git diff`, then commit.

## 17:16 — No Playwright test marathon for a docs-only run {#run-2026-10-02-1716-6}

- **Status:** open
- **Context:** `/autonomous` step 4 asks for end-to-end testing; this run changes no app code.
- **Question:** run the browser test marathon?
- **Decision:** no. Verification is: the test suite before archiving, md2html lint and `build --check`
  clean, no remaining references to the old paths, and the moved reports rendered and looked at.
- **Why:** an app e2e run would test code this run didn't touch (same call as decision D17 of the feature
  research run).
- **Alternatives:** full Playwright run against the stack.
- **Consequences:** none for the app.

## 17:21 — Put the feature report's hand-added menu bar into its build script {#run-2026-10-02-1716-7}

- **Status:** open
- **Context:** rebuilding `feature-report.html` after the move showed that the committed HTML had a
  `<script src="../reports-nav.js">` tag and a Created / Last edited / Status line that
  `build-report-html.mjs` doesn't produce (added by hand earlier).
- **Question:** rebuild and lose the menu bar, keep the stale HTML, or fix the script?
- **Decision:** add both to the build script's template (nav path now `../../reports-nav.js`); the
  rebuilt HTML matches the old one except for the deeper relative paths.
- **Why:** the moved report needs a rebuild for its new paths; the generator should reproduce what is
  committed.
- **Alternatives:** patch the HTML by hand again (drifts on the next build).
- **Consequences:** the meta line's dates are hard-coded in the script, as they were in the HTML.
  `feature-report.md` still has no frontmatter (md2html lint warning, unchanged; CLAUDE.md names it as the
  exception). Note: `md2html serve` doesn't serve `.js`, so this report's menu bar only shows when opened
  from disk or another server — unchanged by this run.
