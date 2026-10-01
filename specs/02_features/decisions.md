---
feature: 02_features
title: "Decisions & assumptions — feature research run (2026-09-26)"
status: applied
order: 1
created: 2026-09-27
edited: 2026-09-27
---

# Decisions & assumptions — feature research run (2026-09-26)

Autonomous run: research similar projects → ≥20 GitHub feature requests → ranked report with diagrams.

| # | Decision / assumption | Why |
|---|---|---|
| 1 | Report + decisions live in `specs/02_features/`; diagrams in `docs/diagrams/` (`.mmd` + `.svg`). | Matches repo layout (`specs/01_mvp/`) and global diagram policy. |
| 2 | Existing open enhancements #59 (image embeds), #60 (templates), #61 (search AND/accents) are not re-filed. | Avoid duplicates. |
| 3 | Research split into 4 parallel slices: AI-notes apps, PKM/markdown web tools, LLM-wiki & agent UIs, git/mobile note apps. | Independent sub-tasks → parallel agents. |
| 4 | Diagrams: Mermaid source (`.mmd`) rendered to `.svg` via `@mermaid-js/mermaid-cli`; "screen drawings" = ASCII wireframes inline in the report (phone/iPad frames). | Global diagram policy; wireframes stay diffable in Markdown. |
| 5 | Pending uncommitted work in the tree (fix-53…63 etc.) is not touched or committed. | Not part of this task. |
| 6 | ~50 raw candidates deduped into **30 features**; merged overlaps (e.g. share target + URL clip + inbox → one; per-turn undo + hunk review + change gutter → one; semantic search + related notes + qmd → one; pinned/recent notes folded into quick switcher). | ≥20 asked; 30 keeps each distinct and actionable. |
| 7 | Ranking = judgement on (fit to mobile LLM-wiki loop × helpfulness × coolness) ÷ effort; cheap features that opencode already supports rank high. Scores in report overview. | "Sort by what makes more sense, is most helpful, and cool." |
| 8 | Not filed (listed in report appendix): focus/typewriter mode, iPad shortcut cheat-sheet, offline editing queue, PR-based review, static-site publish, NotebookLM-style audio overviews/flashcards. | Lower value/effort ratio or conflict with current model; keep backlog lean. |
| 9 | Issues labelled `enhancement` + new label `feature-research` (purple). `needs-triage` doesn't exist in the repo, so not used. Issue body carries rank N/30, effort, acceptance criteria, prior-art links. | Groups the batch; filterable. |
| 10 | Issues link to `specs/02_features/feature-report.md` on `main`; the report is **not committed** (no commit permission given) — link works once you commit/push. | Global rule: commit only when asked. |
| 11 | iOS facts drive design: no Web Share Target in Safari → Apple Shortcut fallback; no Web Speech in installed PWA → server STT; Web Push only for installed apps (iOS 16.4+). | Verified by research agent against WebKit/MDN sources. |
| 12 | Chapters written by 3 parallel agents (ranks 1–10 / 11–20 / 21–30) from one shared brief and one feature data file; assembled by script (TOC, ranking table with Fit/Help/Cool scores 1–5). | Independent chapters → parallel; single data source keeps issues and report consistent. |
| 13 | Where research named no endpoint, chapters propose new backend routes (e.g. `/vaults/:id/jobs`, `/push/subscriptions`, `/related`, `/tags`, `/graph`, `/chats/:chatId/fork`), marked as sketches. | Makes the "How it works" diagrams concrete; not binding. |
| 14 | README gets a one-line pointer to the report (Status section). | Global rule: user-visible docs → README. |
| 15 | Verification: all 34 Mermaid diagrams (4 overview + 30 per feature) render with mermaid-cli **and** in a browser (mermaid 11, headless Chromium via repo's Playwright; the Playwright MCP browser was locked by another session). 0 parse errors, 0 broken SVG links, all TOC anchors resolve. Screenshots of chapters 3 and 7 checked by eye. | "Test before claiming done." |
| 16 | ASCII wireframes: frame edges can wobble by a char in fonts where glyphs like ✦ ‹ ↶ aren't monospace; accepted. | Cosmetic, font-dependent. |
| 17 | **No app e2e test marathon.** This run changed no app code (docs + issues only), so Playwright regression testing of the stack would test the pre-existing, uncommitted WIP (fix-53…63), not this work. Skipped; can run on request. | Autonomous skill's test phase targets features just built; none were built. |

## Output

- Report: `specs/02_features/feature-report.md` (TOC, overview diagrams, 30 chapters, 3 appendices)
- Diagrams: `docs/diagrams/overview-*.{mmd,svg}` (4) + `docs/diagrams/fNN-<slug>.{mmd,svg}` (30)
- Issues: #64–#93, label `feature-research` + `enhancement`
- Nothing committed.
