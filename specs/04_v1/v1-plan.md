---
title: V1 plan (draft)
created: 2026-09-27
edited: 2026-09-28
status: research
subtitle: 'Status: **draft, 2026-09-27.** Nothing here is decided yet. Issue numbers refer to [tillg/karpathy.app](https://github.com/tillg/karpathy.app/issues). Inputs: [`../01_mvp/mvp.md`](../01_mvp/mvp.md), [`../01_mvp/plan-status.md`](../01_mvp/plan-status.md), [`../02_features/feature-report.md`](../02_features/feature-report.md) (ranking = "#R" below).'
description: "Draft plan for karpathy.app V1: state of the issues, goal and success criteria, scope, milestones, risks."
---

**V1** = the first release after the MVP (M4) that the user can rely on **daily on iPad and phone with the real vault**: an LLM wiki with \~5.6k files / 1.2 GB, German content, `.claude/skills` inside the vault, film/actor/source pages, and Instagram/mail ingest skills.

:::tldr
**V1 = the daily LLM-wiki loop (capture → ingest via skills → query → edit → commit) on iPad and iPhone, against the real vault, on a deployed server.**

- **Where we are:** MVP (M4) done; 0 open bugs; 35 open enhancements (30 ranked feature ideas, 3 from e2e, 2 ops). Never happened yet: real-device run, real deploy, skills (M5), a non-Ollama model.
- **Must-have scope:** deploy under the new name ([#94](https://github.com/tillg/karpathy.app/issues/94), [#95](https://github.com/tillg/karpathy.app/issues/95)), real-vault hardening, skills running (M5), plus the top-ranked loop features: slash commands, capture inbox, per-turn undo, save-to-wiki, quick switcher, citations, auto-fetch, search accents, image embeds.
- **Order:** V1.0 ship & harden → V1.1 skills → V1.2 query · V1.3 capture + ingest · V1.4 trust & sync (in parallel) → V1.5 dogfood week → tag v1.0.
- **Decisions needed from you:** server and access model, production model and cost, mail/Instagram ingest in V1 or not, plan mode or not ([§5](#s5)).
:::

## Where we are {#s1}

**MVP (M4) is implemented.** [`plan-status.md`](../01_mvp/plan-status.md): 56 plan rows → 44 done, 4 partly, 5 deviated, 3 not done. The three "not done" rows are exactly what V1 must close first:

- `compose.dev.yml` HMR has no test (minor).
- End-to-end run on a **real iPhone + iPad** never happened (D5).
- **Deploy** to a real server never happened (D5, D16) → now tracked as [#94](https://github.com/tillg/karpathy.app/issues/94) (domain `karpathy.app`).

Also open from the status review: `plan-gaps.llm.test.ts` (3 tests) not yet green (CPU contention, not a finding); the default model (Claude Sonnet 5) and any non-Ollama provider **never ran** (D3); the nightly CI job (`@github`, `@llm`) never ran.

**M5 (skills) has not started.** The opencode image is stock (`deploy/opencode/Dockerfile`: "Skill deps come in M5"): no Python, bash + webfetch denied, no skill credentials.

**Issues (95 total, as of 2026-09-27):**

| Group | Count | Issues |
| --- | --- | --- |
| Done (closed) — all bugs | 60 | #1–[#58](https://github.com/tillg/karpathy.app/issues/58), [#62](https://github.com/tillg/karpathy.app/issues/62), [#63](https://github.com/tillg/karpathy.app/issues/63) (incl. 3 security [#27](https://github.com/tillg/karpathy.app/issues/27) [#30](https://github.com/tillg/karpathy.app/issues/30) [#31](https://github.com/tillg/karpathy.app/issues/31), 14 a11y [#39](https://github.com/tillg/karpathy.app/issues/39)–[#47](https://github.com/tillg/karpathy.app/issues/47) [#50](https://github.com/tillg/karpathy.app/issues/50)–[#52](https://github.com/tillg/karpathy.app/issues/52)) |
| **Open bugs** | **0** | — |
| Open enhancements from e2e dogfooding | 3 | [#59](https://github.com/tillg/karpathy.app/issues/59) image/PDF embeds, [#60](https://github.com/tillg/karpathy.app/issues/60) templates, [#61](https://github.com/tillg/karpathy.app/issues/61) search AND + accent folding |
| Open feature research (ranked 1–30) | 30 | [#64](https://github.com/tillg/karpathy.app/issues/64)–[#93](https://github.com/tillg/karpathy.app/issues/93) |
| Open ops | 2 | [#94](https://github.com/tillg/karpathy.app/issues/94) deploy to karpathy.app, [#95](https://github.com/tillg/karpathy.app/issues/95) rename project to karpathy.app |
| In progress | 0 assigned, 0 PRs | — (the 3 demo-vault fixes and the browser-only research are merged on `main`, no issues filed) |

The bug backlog is empty: every e2e/security/a11y finding so far is closed. The risk for V1 is therefore not known bugs but **unknown ones on the real vault and real devices** (V1.0).

## V1 goal & success criteria {#s2}

**Goal:** the daily LLM-wiki loop — **capture → ingest via skills → query → edit → commit** — works on iPad and iPhone against the real vault, on the deployed server, without falling back to the Mac terminal.

| # | Criterion | Measure |
| --- | --- | --- |
| S1 | Deployed | `https://karpathy.app` ([#94](https://github.com/tillg/karpathy.app/issues/94)) reachable with TLS; `/api/health` = backend + opencode ok; restart survives (volumes) |
| S2 | Real vault loads | Clone of the 1.2 GB vault completes; file tree of \~5.6k files interactive < 2 s on iPad; open note < 500 ms (p95, warm) |
| S3 | Search is usable | Search p95 < 1 s on the real vault; `Luhmann Zettel`, `memoire`, `erganzung` find their notes ([#61](https://github.com/tillg/karpathy.app/issues/61)) |
| S4 | Skills run | `query`, `lint`, `ingest` complete on mobile with the prod model; ≥ 1 Instagram URL and ≥ 1 mail ingested end-to-end, or explicitly deferred with a documented Mac fallback |
| S5 | Capture in ≤ 3 taps | Share/paste a URL or text into `raw/` inbox from iPhone ([#65](https://github.com/tillg/karpathy.app/issues/65)) and trigger ingest with one tap ([#64](https://github.com/tillg/karpathy.app/issues/64)) |
| S6 | AI edits are trustworthy | Every turn's changes reviewable and undoable per turn ([#66](https://github.com/tillg/karpathy.app/issues/66)) before Commit & Push |
| S7 | Dogfood week | 7 consecutive days of real use with **0 data-loss** and **0 open P1 bugs**; every new finding filed as `e2e-found` |
| S8 | Green gates | `npm test`, Playwright (Chromium + WebKit, phone + iPad viewports) and the `@llm` tier against local Ollama green in CI; nightly job has run |

## Scope {#s3}

Open bugs first: **none open** — so "bugs first" means V1.0 hunts them on the real vault and real devices before any feature work. Ranking/effort from the feature report (#R, S/M/L).

### IN (must)

| Item | Issues | #R / effort | Why (loop step) |
| --- | --- | --- | --- |
| Deploy to a real server under the new name | [#94](https://github.com/tillg/karpathy.app/issues/94), [#95](https://github.com/tillg/karpathy.app/issues/95) | ops / M | Precondition for any daily use; rename before deploy so URLs, images, repo move once |
| Real-vault + real-device hardening | (new `e2e-found` bugs) | — / M | S2, S7; before 2026-09-27 the MVP only ran with test vaults (≤ 130 notes). A first pass on the real vault (dev stack, headless browsers, 2026-09-27) found 3 bugs, all fixed: emptied folders after delete and after discard, and the editor keeping discarded text |
| M5 skills: bash allowlist, Python + deps in image, `query`/`lint`/`ingest` checked | mvp.md §4, M5 | — / L | **Ingest** and **query** are the loop; without them the app is an editor |
| Slash commands + skill chips | [#64](https://github.com/tillg/karpathy.app/issues/64) | 1 / S | One tap to run `/ingest`, `/query`, `/lint` on a phone keyboard |
| Clip into `raw/` + ingest inbox | [#65](https://github.com/tillg/karpathy.app/issues/65) | 2 / M | **Capture** from iOS share sheet / paste |
| Per-turn review + undo of AI edits | [#66](https://github.com/tillg/karpathy.app/issues/66) | 3 / M | **Commit** safely: ingest touches 5–15 pages per source |
| "Save to wiki" (answer → synthesis page) | [#67](https://github.com/tillg/karpathy.app/issues/67) | 4 / S | **Query** results become wiki pages (CLAUDE.md query workflow step 4) |
| Quick switcher | [#69](https://github.com/tillg/karpathy.app/issues/69) | 6 / S | Navigating 5.6k files on a phone without the tree |
| Clickable citations / provenance | [#72](https://github.com/tillg/karpathy.app/issues/72) | 9 / S | Query answers must link the pages they cite |
| Auto-fetch + "behind remote" badge | [#74](https://github.com/tillg/karpathy.app/issues/74) | 11 / S | Obsidian on Mac/phone writes the same remote; avoid conflicts |
| Search AND + accent folding | [#61](https://github.com/tillg/karpathy.app/issues/61) | e2e / S | German content typed without umlauts on iOS keyboards (S3) |
| Image embeds + PDF open | [#59](https://github.com/tillg/karpathy.app/issues/59) | e2e / S | Film/actor/source pages and Instagram ingests embed `raw/media` images |

### SHOULD (if V1 has room, in this order)

| Item | Issues | #R / effort | Note |
| --- | --- | --- | --- |
| @-mention notes/folders as context | [#73](https://github.com/tillg/karpathy.app/issues/73) | 10 / S | Shares the fuzzy matcher with [#69](https://github.com/tillg/karpathy.app/issues/69) — cheap after it |
| Per-file history + restore | [#75](https://github.com/tillg/karpathy.app/issues/75) | 12 / S | Complements [#66](https://github.com/tillg/karpathy.app/issues/66) for older mistakes |
| Quick capture + daily notes | [#78](https://github.com/tillg/karpathy.app/issues/78) | 15 / S | Shares the capture endpoint with [#65](https://github.com/tillg/karpathy.app/issues/65) |
| Markdown toolbar above keyboard | [#70](https://github.com/tillg/karpathy.app/issues/70) | 7 / M | High help on phone; iOS keyboard geometry is fiddly |
| Backlinks + unlinked mentions | [#68](https://github.com/tillg/karpathy.app/issues/68) | 5 / M | Introduces the link index (reused by 7 features) — the best V2 enabler |
| Templates for new notes | [#60](https://github.com/tillg/karpathy.app/issues/60) | e2e / S | Source-page template; partly obsoleted by ingest skills |
| Model switcher / cost meter | [#84](https://github.com/tillg/karpathy.app/issues/84), [#85](https://github.com/tillg/karpathy.app/issues/85) | 21, 22 / S | Useful while choosing the prod model (§5) |
| Outline / note info | [#79](https://github.com/tillg/karpathy.app/issues/79) | 16 / S | Long German source pages |
| Plan mode | [#71](https://github.com/tillg/karpathy.app/issues/71) | 8 / M | Overlaps with [#66](https://github.com/tillg/karpathy.app/issues/66); decide after using [#66](https://github.com/tillg/karpathy.app/issues/66) for a week |
| Reopen the last note per vault after switching | (new, from demo-vault testing 2026-09-27) | — / S | Switching vaults and back currently lands on the empty state |

### OUT (V2 or later)

| Item | Issues | Why later |
| --- | --- | --- |
| Scheduled jobs, push notifications | [#76](https://github.com/tillg/karpathy.app/issues/76), [#77](https://github.com/tillg/karpathy.app/issues/77) | Need a job runner + Web Push infra; valuable once the manual loop is solid (#R 13/14) |
| Safe rename, properties editor, tag browser, link preview, dashboards, local graph | [#80](https://github.com/tillg/karpathy.app/issues/80), [#82](https://github.com/tillg/karpathy.app/issues/82), [#90](https://github.com/tillg/karpathy.app/issues/90), [#89](https://github.com/tillg/karpathy.app/issues/89), [#91](https://github.com/tillg/karpathy.app/issues/91), [#92](https://github.com/tillg/karpathy.app/issues/92) | Build on the link index from [#68](https://github.com/tillg/karpathy.app/issues/68) (V2 wave) |
| Semantic search | [#81](https://github.com/tillg/karpathy.app/issues/81) | L effort; embeddings over 1.2 GB; revisit after S3 is measured |
| Inline AI edit, deep research | [#83](https://github.com/tillg/karpathy.app/issues/83), [#86](https://github.com/tillg/karpathy.app/issues/86) | M effort, lower fit than the core loop |
| Attach photos/PDFs, voice memos | [#87](https://github.com/tillg/karpathy.app/issues/87), [#88](https://github.com/tillg/karpathy.app/issues/88) | Capture via [#65](https://github.com/tillg/karpathy.app/issues/65) first; media pipelines later |
| Fork chat | [#93](https://github.com/tillg/karpathy.app/issues/93) | Rank 30 |
| Browser-only architecture | specs/03_browser_only/ | Research only (§6) |

## Milestones (tracer-bullet slices, each shippable) {#s4}

Each slice ends deployed on `karpathy.app` and verified on a real iPhone + iPad. Verify = mechanical first (Vitest / Playwright on phone + iPad viewports, WebKit where possible; `@llm` tier with the local Ollama dev model), then a manual device check.

| Slice | Content | Depends on | Effort | Verify |
| --- | --- | --- | --- | --- |
| **V1.0 Ship & harden** | [#95](https://github.com/tillg/karpathy.app/issues/95) rename; [#94](https://github.com/tillg/karpathy.app/issues/94) deploy (prod compose, DNS-01 TLS, secrets, backups of config + opencode volumes); make `plan-gaps.llm` green; nightly CI runs; add the real vault; perf pass (file list, tree virtualisation, search, watcher on 5.6k files, clone of 1.2 GB) | — | M–L | S1, S2 measured and recorded; Playwright against a generated 6k-file / 1 GB fixture vault (tree render, open, search timings); `/api/health` from phone; every finding filed `e2e-found` and fixed or triaged |
| **V1.1 Skills run (M5)** | Bash allowlist, Python + deps in the opencode image, per-skill check of mvp.md §4; `query` + `lint` on mobile; [#64](https://github.com/tillg/karpathy.app/issues/64) slash commands + chips | V1.0 | L | `@llm` test: `/query` on fixture wiki returns an answer citing a page; `/lint` finds a seeded dead link; allowlist test: disallowed command denied, allowed Python script runs; Playwright: chip → prompt sent |
| **V1.2 Query loop** | [#67](https://github.com/tillg/karpathy.app/issues/67) save to wiki, [#72](https://github.com/tillg/karpathy.app/issues/72) citations, [#61](https://github.com/tillg/karpathy.app/issues/61) search AND/accents, [#69](https://github.com/tillg/karpathy.app/issues/69) quick switcher | V1.1 (skills), V1.0 | M | Playwright: answer → "Save to wiki" → new `wiki/synthesis/*.md` with frontmatter; citation tap opens page; search `memoire` finds `mémoire`; switcher opens a note in ≤ 3 keystrokes on the 6k fixture |
| **V1.3 Capture + ingest** | [#65](https://github.com/tillg/karpathy.app/issues/65) clip/inbox (iOS share target, paste URL/text), `ingest` skill end-to-end, [#59](https://github.com/tillg/karpathy.app/issues/59) image embeds; Instagram/mail skills: credentials as compose secrets + webfetch/network decision (§5) | V1.1 | L | Playwright: share URL → file in `raw/` → inbox shows it → `/ingest` chip → source page + entity pages changed; `@llm` ingest on a fixture article; image from `raw/media` renders in Read mode |
| **V1.4 Trust & sync** | [#66](https://github.com/tillg/karpathy.app/issues/66) per-turn review/undo, [#74](https://github.com/tillg/karpathy.app/issues/74) auto-fetch badge | V1.1 | M | Playwright: AI turn edits 3 files → turn diff lists them → "Undo turn" restores them byte-exact, other edits kept; remote commit pushed from outside → badge appears → one-tap pull |
| **V1.5 Dogfood week** | Daily use on the real vault; SHOULD items pulled in by observed pain ([#73](https://github.com/tillg/karpathy.app/issues/73), [#75](https://github.com/tillg/karpathy.app/issues/75), [#78](https://github.com/tillg/karpathy.app/issues/78), [#70](https://github.com/tillg/karpathy.app/issues/70), [#68](https://github.com/tillg/karpathy.app/issues/68) …) | V1.0–V1.4 | M | S7: 7 days, 0 data loss, 0 open P1; all S1–S8 green → tag `v1.0` |

Order rationale: deploy first (nothing else is testable for real without it); skills before capture/query because slash commands, ingest and query all run through them; trust ([#66](https://github.com/tillg/karpathy.app/issues/66)) before the dogfood week because ingest edits many pages per turn. V1.2 and V1.4 can run in parallel after V1.1.

```
V1.0 ──► V1.1 ──┬─► V1.2 ──┐
                ├─► V1.3 ──┼─► V1.5 (dogfood → v1.0 tag)
                └─► V1.4 ──┘
```

## Risks & open questions {#s5}

| # | Risk / question | Impact | Mitigation / decision needed |
| --- | --- | --- | --- |
| R1 | **Skills not portable** (mvp.md §4): Python scripts (`film-import.py`, `serien-import.py`, `reel-film-extract.py`, `normalize-film-frontmatter.py`), `ingest-email` (Gmail creds), `instascraper` (Instagram session) | S4 fails for mail/Instagram | Per-skill matrix in V1.1; Python + deps in the image; credentials as compose secrets for opencode only. Decide: allow network/webfetch for opencode (weakens the confinement model) or run scrapers as a backend job that drops files into `raw/` |
| R2 | **Bash allowlist vs confinement**: the subfolder confinement relies on opencode having **no git** (D25, spike finding 1); adding a shell must not add git or escape the vault | Security | Allowlist exact commands (python scripts, `rg`), no git binary; regression test in the image test suite |
| R3 | **Prod model choice**: Claude Sonnet 5 (default) never ran; only local `qwen2.5:3b`; tool-calling quality varies by model (mvp §6) | Skills unreliable | V1.1 bake-off on 3 fixed prompts (query, lint, ingest) across 2–3 providers; record cost per ingest; [#84](https://github.com/tillg/karpathy.app/issues/84)/#85 help |
| R4 | **Public exposure**: mvp.md assumed a home server behind VPN; [#94](https://github.com/tillg/karpathy.app/issues/94) means a public domain with a single bearer token | Security | Decide: VPN only / Cloudflare Access / public + rate limit + token rotation. CSP already in prod ([#31](https://github.com/tillg/karpathy.app/issues/31)) |
| R5 | **Big-vault performance**: 5.6k files, 1.2 GB (mostly media under `Sources/`) — clone time, `GET /files` payload, tree render, watcher (inotify limits), ripgrep, offline cache size on iOS (Safari storage quota) | S2/S3 fail | **First measurement (2026-09-27, dev stack, demo vault = real vault's HEAD):** local clone < 1 min; ripgrep search 0.16 s via API; the whole browse scenario (open app, tree, deep note, Read mode, follow link, Back) runs in 3–12 s in headless WebKit/Chromium; the Wiki/ expansion test (1.2k entries + two binary files) 5 s; bulk create/edit/delete of 20 notes + 2 commits \~1 min, all through the UI. No blocker found; still to do: real iPad, real network clone from GitHub, watcher limits. Fixture vault of the same shape in CI; exclude media from offline cache |
| R6 | **Git on a large repo**: pull/stash/commit latency; Obsidian on other devices committing concurrently; LFS? | Conflicts, slow commit | Measure in V1.0; [#74](https://github.com/tillg/karpathy.app/issues/74) reduces conflicts; check whether the real repo uses LFS |
| R7 | **Skills that commit** (mvp §4) or reference Claude Code tool names | Breaks "AI never commits" (ADR 0001) | Audit the vault's `.claude/skills` in V1.1; adapt in the vault repo, not in the app |
| R8 | **iOS specifics**: share target for PWAs is limited on iOS (no Web Share Target) | [#65](https://github.com/tillg/karpathy.app/issues/65) capture path | Fallbacks: paste field, iOS Shortcut posting to a capture endpoint, bookmarklet |
| R9 | Rename [#95](https://github.com/tillg/karpathy.app/issues/95) touches repo name, image names, volume names, docs | Broken deploy | Do it in V1.0 before the first real deploy; volumes renamed with a migration note |

Open questions for the user:

1. Server + access model for [#94](https://github.com/tillg/karpathy.app/issues/94) (VPS vs home server; VPN vs public)?
2. Which provider/model is acceptable for daily cost (R3)?
3. Mail/Instagram ingest in V1 (R1), or keep them on the Mac for V1 and document the fallback?
4. Is [`#66`](https://github.com/tillg/karpathy.app/issues/66) enough, or is plan mode ([#71](https://github.com/tillg/karpathy.app/issues/71)) also required before trusting ingest on mobile?

## Related: browser-only architecture {#s6}

A server-less, browser-only variant (files in the browser, git in the browser, LLM calls from the client) was researched in [`../03_browser_only/browser-only-report.md`](../03_browser_only/browser-only-report.md). Verdict: technically possible, but it would replace opencode (skills with scripts, turns that survive backgrounding), so **V1 stays on the server architecture**. A local-first hybrid (browser clone for offline edit/search, opencode on the server) is the candidate for after V1.
