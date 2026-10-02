---
feature: chat-main
title: "Plan: swap note and chat columns"
status: applied
order: 4
created: 2026-10-02
edited: 2026-10-02
---

# Plan: swap note and chat columns

Each step is one red → green cycle. All tests are Playwright e2e in the new
`e2e/chat-main.spec.ts`. They run against the dev stack (`just dev` running), using `openApp` and the
`vault` fixture from `e2e/helpers.ts`. The desktop viewport is 1280 × 800, so the chat column is open by
default. Nothing is mocked.

## Phase 1: the button

- [x] Show the swap button on the divider, wide layout with the chat open
  - Test first: `e2e/chat-main.spec.ts` › "swap button sits on the note/chat divider". The test asserts
    that `main-swap` is visible, has `aria-pressed="false"` and has the accessible name "Move chat to
    main column". Its box centre x must be within 2 px of `#chat`'s left edge, and its top must be inside
    the 52 px bar. It fails today: no such button exists.
  - Verify: `just e2e e2e/chat-main.spec.ts` → green on `desktop` and `webkit-desktop`; then `just check`
    → green.

- [x] The button doesn't cover the bar buttons next to the divider
  - Test first: `e2e/chat-main.spec.ts` › "bar buttons next to the divider stay clickable". Open a note
    and a chat. For `chat-toggle` and the chat bar's first control (`chat-back`), take three points at
    mid-height (2 px inside the left edge, the centre, 2 px inside the right edge) and assert that
    `document.elementFromPoint` returns that element (or a descendant) at each, not `main-swap`. The
    centre alone is not enough: it is 28 px from the divider, outside the 22 px overlap. It fails after
    the previous step, because the 44 px tap box covers the inner edge of both.
  - Verify: `just e2e e2e/chat-main.spec.ts` → green.

- [x] Hide the button where there is nothing to swap
  - Test first: `e2e/chat-main.spec.ts` › "no swap button while the chat is closed". The test clicks
    `chat-toggle` and expects `main-swap` to have count 0. It also adds "@ipad no swap button" and
    "@iphone no swap button" (count 0 with the chat overlay or tab open). They fail if the button is
    rendered unconditionally.
  - Verify: `just e2e e2e/chat-main.spec.ts` → green on all six projects.

## Phase 2: the swap

- [x] Clicking the button swaps the main and side columns
  - Test first: `e2e/chat-main.spec.ts` › "swap puts the chat in the main column and back". After the
    click, `#chat`'s box must be left of `#detail`'s and wider than it, and `#detail` must be 380 px ±1.
    The button must have `aria-pressed="true"` and the name "Move note to main column", and its centre
    must be on `#detail`'s left edge (±2 px). The `elementFromPoint` check from phase 1 must hold for the
    chat's close ✕ and `sidebar-toggle`. A second click must restore the original boxes. It fails after
    phase 1: the button exists but nothing moves the columns.
  - Verify: `just e2e e2e/chat-main.spec.ts` → green.

- [x] Swapping moves no DOM node
  - Test first: `e2e/chat-main.spec.ts` › "swap keeps the editor and the chat composer alive". Open a
    long note and a chat with enough messages to scroll. Type in the editor and in `chat-composer`,
    scroll the editor and the message list to a non-zero `scrollTop`, and tag both DOM nodes
    (`.cm-editor`, the composer) with `el.__mark = 1` via `evaluate`. Focus the composer and trigger the
    swap with `el.click()` via `evaluate` (a real mouse click would move focus to the button). Swap twice.
    The same nodes must still carry `__mark`, both texts must be unchanged, both `scrollTop` values
    must be unchanged (±1), and `document.activeElement` must still be the composer. The test must fail
    for a keyed JSX reorder of the panes. Confirm this once with a throwaway keyed reorder before writing
    the CSS version.
  - Verify: `just e2e e2e/chat-main.spec.ts` → green.

- [x] Swap by touch on a large iPad
  - Test first: `e2e/chat-main.spec.ts` › "@ipad iPad Pro 13" landscape: tap swaps the columns" and
    "@ipad iPad Pro 13" portrait: tap swaps the columns". Both use `test.use({ viewport })` set to
    1376 × 1032 and 1032 × 1376, and run in the touch projects `ipad` / `webkit-ipad`. Each test expects
    `#app` to have class `wide`, opens the chat with `chat-toggle` if it is closed (it is in portrait),
    and asserts a `main-swap` box of at least 44 × 44 px. It then calls `tap()` and checks that `#chat`
    is left of `#detail` and `#detail` is 380 px ±1. Only landscape also asserts that `#chat` is wider:
    in portrait with the sidebar open the main column is 1032 − 280 − 380 = 372 px, the accepted
    limitation from the proposal. The tests fail before this step if the button is a 28 px box. Check
    that once by tapping a 28 px version and asserting the box size.
  - Verify: `just e2e e2e/chat-main.spec.ts` → green on all six projects.

## Phase 3: the choice is remembered

- [x] Persist the main pane across reloads
  - Test first: `e2e/chat-main.spec.ts` › "chat in main survives a reload". Swap, reload, and expect
    `#app` to have class `chatmain` and `#chat` to be left of `#detail`. Then swap back, reload, and
    expect the note in main. It fails today: the state is in memory only.
  - Verify: `just e2e e2e/chat-main.spec.ts` → green.

- [x] Closing and reopening the chat keeps the chat in main
  - Test first: `e2e/chat-main.spec.ts` › "closing the chat while it is in main, then reopening it,
    puts it back in main". Swap, close the chat, and expect `#detail` to take the full width beside the
    sidebar. Reopen the chat and expect `#chat` to be in the main column again. This guards against a
    `setChatOpen` reset slipping in.
  - Verify: `just e2e e2e/chat-main.spec.ts` → green.

## Phase 4: docs and final checks

- [x] Mention the feature in `README.md`
  - Test first: none, this is a docs-only step.
  - Verify: `grep -n "swap" README.md` → one line in the Status / features paragraph.

- [x] Full suite and visual check
  - Note (2026-10-02, accepted by the user): `just check` is green. `just e2e` has 219 passed and 6
    failed: the 3 `plan-gaps.spec.ts` tests (health check, opencode `$HOME` tmpfs mount, prod Caddyfile
    missing `dns.providers.godaddy`) in both engines. They failed in the baseline before this change and
    are unrelated to it. Visual check done by script (Chromium + WebKit, light + dark, 1×). The check on a
    real iPad Pro 13" is still open, by hand.
  - Test first: none, because the existing suites cover regressions in the wide, tablet and phone layouts
    (`e2e/mobile.spec.ts`, `e2e/a11y-keyboard.spec.ts`, `e2e/a11y.spec.ts`, `e2e/chat.spec.ts`). The axe
    suite also checks that the icon-only button has an accessible name.
  - Verify: `just check && just e2e` → all green. Then use Playwright MCP to take 1× (`scale:"css"`)
    screenshots of the divider area with each pane in main, saved to `tmp/`, and read them. The button
    must sit on the hairline, the hairline must run the full height down to the bottom edge, and the bar
    buttons on both sides must be fully visible next to the button. Repeat in WebKit, and on the real
    iPad Pro 13" in both orientations (by hand).

System docs are updated at `/spec:archive`.
