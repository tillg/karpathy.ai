---
feature: media-embeds-sticky-mode
title: "Plan: media embeds and a sticky Write/Read mode"
status: applying
order: 4
created: 2026-10-02
edited: 2026-10-03
---

# Plan: media embeds and a sticky Write/Read mode

Each step is one red → green cycle. Nothing is mocked. Test layers:

- **Web units:** vitest in `apps/web/src/lib/*.test.ts`: `npm test -w apps/web -- <file>`.
- **Backend:** vitest with the real app and a real vault clone (`apps/backend/test/api.test.ts`,
  `vaultApp()`): `npm test -w apps/backend -- api`.
- **e2e:** Playwright against the dev stack (`just dev` running): `just e2e <spec>`. Its `cspGuard`
  fails a test on any CSP violation. The CSP only exists in the prod proxy, so the CSP step also runs
  `just prodtest e2e`.

Media fixtures are tiny real files, checked in under `e2e/fixtures/media/`: `dot.png` (1×1),
`wide.png` (400×300), `clip.mp4` (1 s, H.264, made once with ffmpeg), `doc.pdf` (1 page). They reach a test vault through
`pushFromObsidian(bare, path, Buffer)`.

**Apply order:** `chat-main` and `ai-open-page` are `applying` and touch `store.tsx`. Apply this change
after them, or rebase phase 1 onto their state first.

## Phase 1: sticky mode

- [x] The mode survives opening another note from the tree
  - Test first: `e2e/sticky-mode.spec.ts` › "Read mode stays when opening from the tree, search and
    the Changes list". Open `Home.md`, click `mode-read`, open `Ideas.md` via `tree-item`: assert
    `mode-read` has `aria-pressed="true"` and `.cm-content` count is 0. Repeat via a `search-result`
    and a Changes-list open button. Fails today: `openNote` without `keepMode` resets to Write.
  - Verify: `just e2e e2e/sticky-mode.spec.ts e2e/notes.spec.ts e2e/fix-17.spec.ts` → green; `just check`
    → green.

- [x] The mode survives a reload; Write stays the default
  - Test first: `e2e/sticky-mode.spec.ts` › "mode preference survives a reload". In a fresh context,
    open a note and assert Write mode. Switch to Read, `page.reload()`, open a note: still Read.
    Switch to Write, reload: Write. Fails today: the mode is plain `useState('write')`.
  - Verify: `just e2e e2e/sticky-mode.spec.ts` → green; `just check` → green.

- [x] Remove the dead `keepMode` parameter
  - Test first: none, refactor. The existing `e2e/notes.spec.ts`, `fix-17.spec.ts`, `fix-55.spec.ts`
    and `sticky-mode.spec.ts` pass before and after. Also fix the now-wrong comment in
    `e2e/a11y.spec.ts:47` ("it opens in Write mode"). The test step itself stays.
  - Verify: `rtk grep -n keepMode apps/web/src` → no match; `just check` and
    `just e2e e2e/sticky-mode.spec.ts e2e/notes.spec.ts e2e/a11y.spec.ts` → green.

- [x] Read-mode blocks carry their source line
  - Test first: `apps/web/src/lib/markdown.test.ts` › "top-level blocks carry data-line". Render a
    note with a frontmatter of 3 lines, then `# A` on line 5, a paragraph on line 7, a 3-item list
    from line 9 and a fenced code block after it. Assert `<h1 data-line="5"`, `<p data-line="7"`,
    `<ul data-line="9"`, the `<pre` with its start line, and no `data-line` on the nested `<li>`.
    Assert that the HTML is otherwise unchanged against today's output: no wrapper elements. Fails
    today: no `data-line`.
  - Verify: `npm test -w apps/web -- markdown` → green; `just check` → green.

- [x] A search hit or `[[note#heading]]` in Read mode lands on its block
  - Test first: `e2e/sticky-mode.spec.ts` › "Read mode scrolls to the hit and highlights it". In Read
    mode, search a word that is only on line ~180 of `Long.md` and click the hit. Assert the block
    with the matching `data-line` is within the viewport of `.scroll` and has class `hit`, and that
    after 2 s it doesn't. Then follow `[[Long#<a heading near the end>]]` from another note in Read
    mode: that heading is in the viewport. Fails today: `goto` only runs in Write mode, so Read
    stays at the top.
  - Verify: `just e2e e2e/sticky-mode.spec.ts e2e/fix-4.spec.ts` → green; `just check` → green.

- [x] Back restores the scroll position of a note seen in this session
  - Test first: `e2e/sticky-mode.spec.ts` › "Back returns to the same place". In Read mode, open
    `Long.md`, scroll `.scroll` to about 60 %, and note `scrollTop`. Follow a `[[link]]` near there,
    then `page.goBack()`: `scrollTop` is within 10 px of before. Repeat in Write mode (scroll, open
    another note from the tree, Back). A fresh open of `Long.md` from the tree still lands at the
    top. Fails today: Back reloads the note at the top.
  - Verify: `just e2e e2e/sticky-mode.spec.ts e2e/fix-4.spec.ts` → green; `just check` → green.

- [x] Switching Write ↔ Read keeps the place
  - Test first: `e2e/sticky-mode.spec.ts` › "mode switch keeps the place". In `Long.md`, Read mode,
    scroll until a heading `H` far down is the first visible block. Tap Write: the line of `H` is
    within the top quarter of the editor's viewport, and the editor doesn't have focus
    (`document.activeElement` isn't `.cm-content`). Scroll the editor to another heading `K`, tap
    Read: `K`'s block is within the top quarter. Fails today: both switches land at the top.
  - Verify: `just e2e e2e/sticky-mode.spec.ts` → green on `desktop` and `webkit-desktop`; `just check` →
    green.

## Phase 2: media table and raw route

- [x] Shared media table: `mediaKind`
  - Test first: `packages/shared/src/media.test.ts`. The package has no test script yet: add vitest and
    `"test": "vitest run"`, and see one trivial test pass first. `mediaKind('a/B.PNG') === 'image'`, `'x.mov' → 'video'`, `'x.m4a' → 'audio'`,
    `'x.webm' → 'video'`, `'x.md' → null`, `'x.pdf' → null`, `'png' → null` (no dot). Fails today: the module doesn't exist.
  - Verify: `npm test -w packages/shared` → green; `just check` → green.

- [x] `GET /vaults/:id/raw` streams a media file with its type
  - Test first: `apps/backend/test/api.test.ts` › "raw: media file bytes with Content-Type and
    nosniff". Write `pic.png` bytes into the vault. `GET /raw?path=pic.png` → 200, body equals the
    bytes, `content-type: image/png`, `x-content-type-options: nosniff`, no `content-disposition`.
    `HEAD` → 200 with `content-length`. Fails today: 404, no route.
  - Verify: `npm test -w apps/backend -- api` → green; `just check` → green.

- [x] Non-media files download, never render; path rules hold
  - Test first: `api.test.ts` › "raw: pdf and unknown types are attachments; escapes are refused".
    `doc.pdf` → `application/pdf` + `content-disposition: attachment`. `x.bin` →
    `application/octet-stream` + attachment. `Home.md` → attachment. `../x`, `.git/config`, a symlink
    → 400. Missing → 404, a directory → 400. No token → 401. Fails today: no route.
  - Verify: `npm test -w apps/backend -- api` → green; `just check` → green.

## Phase 3: embeds in Read mode

- [x] Duplicate names: note's folder, then shortest path, then A–Z (links and embeds)
  - Test first: `apps/web/src/lib/wikilink.test.ts` › "prefers the note's folder, then the
    shortest path". Paths `['z/deep/image.png', 'a/image.png', 'Notes/image.png', 'Notes/n.md',
    'b/image.png']`. `resolveWikilink('image.png', paths, 'Notes/n.md')` → `Notes/image.png`.
    Without `from`, or from `Other/x.md` → `a/image.png` (shortest, then A–Z beats `b/`). The same
    rule applies to note names (`Idea.md` in two folders). The existing wikilink tests stay green.
    Fails today: the first match in list order, `z/deep/image.png`.
  - Verify: `npm test -w apps/web -- wikilink` → green; `just check` and
    `just e2e e2e/notes.spec.ts e2e/fix-55.spec.ts` → green.

- [x] `parseEmbed` for both embed forms
  - Test first: `apps/web/src/lib/media.test.ts` › parseEmbed: `![[a.png]]` → wiki, target `a.png`.
    `![[a.png|300]]` → width 300. `![[a.png|300x200]]` → width 300. `![[clip.mp4|200]]` → width 200
    (the width is kept for every kind). `![[a.png|Caption]]` → alt
    `Caption`. `![x](b%20c.png)` → md, target `b c.png`, alt `x`. `[[a.png]]` (no `!`) → null. Fails
    today: no module.
  - Verify: `npm test -w apps/web -- media` → green.

- [x] `resolveEmbed` maps an embed to media, file, note, missing or remote
  - Test first: `media.test.ts` › resolveEmbed with paths `['Notes/n.md', 'raw/media/a.png',
    'Notes/img/b.png', 'doc.pdf', 'Other.md']` and note `Notes/n.md`. `![[a.png]]` → media
    `raw/media/a.png` (basename). `![](img/b.png)` → `Notes/img/b.png` (relative). `![](/doc.pdf)` →
    file. `![](../../x.png)` → missing. `![[Other]]` → note. `![](https://x/y.png)` → remote.
    `![[nope.png]]` → missing. With `notePath` null, `![](raw/media/a.png)` → media. Fails today: no
    function.
  - Verify: `npm test -w apps/web -- media` → green.

- [x] The renderer emits placeholders, never `<img src>`
  - Test first: `apps/web/src/lib/markdown.test.ts` › "embeds become sanitized placeholders".
    `renderMarkdown('![[a.png|300]] and ![](https://t.example/p.gif)', ctx)` contains
    `<span class="embed" data-path="raw/media/a.png" data-kind="image" data-width="300">`, an `<a`
    with `href="https://t.example/p.gif"`, and no `<img`. `![[Other]]` still renders `a.wl`. Update
    the existing callers' signature (`exists` → ctx). Fails today: marked emits `<img src>`, and
    `![[…]]` renders as `!` + wikilink.
  - Verify: `npm test -w apps/web -- markdown` → green; `just check` → green.

- [x] Object-URL cache with size cap, dedupe and invalidation
  - Test first: `e2e/media.spec.ts` › "embedded image renders in Read mode and is fetched once". Push
    `dot.png` to `raw/media/`, a note with two `![[dot.png]]`. In Read mode, assert two
    `.embed img` with `naturalWidth === 1` and exactly one `/raw` request (`page.on('request')`).
    Freshness: a note embedding `ring.svg`, written with `api.write` (SVG is text, so the file API can
    write it, and the vault watcher sends `files-changed`). Rewrite it with another width, and assert
    a second `/raw?path=ring.svg` request and the new `naturalWidth`. A unit test can't
    cover this: `createObjectURL` and the authed fetch need the real browser and backend. Fails today:
    no embeds render.
  - Verify: `just e2e e2e/media.spec.ts` → green; `just check` → green.

- [x] Video, audio, PDF and missing embeds in Read mode
  - Test first: `e2e/media.spec.ts` › "video plays inline, pdf and missing files show a file card".
    Push `clip.mp4` and `doc.pdf`, plus a note with `![[clip.mp4|200]]`, `![[doc.pdf]]` and
    `![[gone.png]]`. Assert a `video[controls][playsinline]` whose `readyState >= 1` (metadata
    loaded) and whose rendered width is ≤ 200 px. Assert a `[data-testid="file-card"]` for `doc.pdf`
    with a Download button; clicking it fires a `download` event named `doc.pdf`. Assert a file card
    with class `miss` and no Download for `gone.png`. Offline: `context.setOffline(true)`, open
    another note with `![[dot.png]]` from the offline cache. Its embed is a file card containing
    "offline", and no error toast appears. Fails today: no embeds.
  - Verify: `just e2e e2e/media.spec.ts` → green (`desktop` and `webkit-desktop`); `just check` → green.

- [x] Open a PDF in the browser's viewer in a new tab
  - Test first: `e2e/media.spec.ts` › "Open shows a pdf in a new tab". In the note with `![[doc.pdf]]`,
    click the file card's `file-open` button inside `context.waitForEvent('page')`. Assert the new
    page's URL starts with `blob:` and that `fetch(url)` from it returns type `application/pdf`. The
    file card of a non-PDF binary (`![[x.bin]]`) has Download but no `file-open`. Fails today: no
    file card, no Open.
  - Verify: `just e2e e2e/media.spec.ts` → green (`desktop` and `webkit-desktop`); `just check` → green.

- [x] Media over 50 MB shows a file card with Load anyway
  - Test first: `e2e/media.spec.ts` › "large media loads only on request". Create a 51 MB `big.mp4`
    in the vault via `backendExec` (`truncate -s 51M`), then a note embedding it. Assert a file card
    with "Load anyway (51 MB)" and no `video` element. Assert the `/raw` response was aborted and the
    body never fully transferred (`request.sizes()` far below 51 MB). Click `file-load`: a `video`
    element appears with a `blob:` src, after one full `/raw` transfer. (The file isn't a playable
    video, so assert the element and the src, not playback.) Fails today: no embeds.
  - Verify: `just e2e e2e/media.spec.ts` → green; `just check` → green.

## Phase 4: other surfaces

- [x] Open a media file from the tree
  - Test first: `e2e/media.spec.ts` › "tapping a media file shows it, a pdf shows a file card". Click
    the tree item `raw/media/dot.png`: an `img` in `#detail`, no "Binary file" text, no `mode-toggle`.
    The delete button's title is "Delete file", and on a `.md` it stays "Delete note". Delete works:
    the pane closes and `api.changes` lists the deletion. Then `doc.pdf` → file card. Then open a
    `.md`: the mode is unchanged. Fails today: the "Binary file" placeholder.
  - **Spec change to an existing test:** `e2e/fix-20.spec.ts` asserts that a `.png` shows "Binary
    file". That behavior is what this step changes on purpose. Point the test at a non-media binary
    (`media/blob.bin`, same bytes). Its file card keeps `data-testid="binary-file"` and the label
    "Binary file", so #20's guarantee still holds: binary is never editable and never saved. Keep
    every other assertion. Add a second case for the `.png`: an image, still no editor, no PUT.
  - Verify: `just e2e e2e/media.spec.ts e2e/fix-20.spec.ts` → green; `just check` → green.

- [x] Embeds in Write mode as a block below the line, text untouched
  - Test first: `e2e/media.spec.ts` › "Write mode shows the embed below its line, text stays
    editable". Open the image note in Write mode: `.cm-embed img` is visible, and its top is below
    the `![[dot.png]]` line's bottom. Type a character at the end of the embed line; assert the saved
    file (via `api.read`) is the old text plus that character. Assert the same `img` element is still
    attached (not recreated: tag it with a `data-` marker before typing). Fails today: no widget.
  - Verify: `just e2e e2e/media.spec.ts e2e/editing.spec.ts e2e/fix-4.spec.ts e2e/fix-19.spec.ts` →
    green; `just check` → green.

- [x] Tapping an embedded image opens it; Back returns to the same place
  - Test first: `e2e/media.spec.ts` › "tap an image to open it, Back restores the scroll". A long
    note with `![[dot.png]]` near the end, in Read mode. Scroll to it and note `.scroll`'s
    `scrollTop`. Click the image: the pane shows the media view for `raw/media/dot.png` (the
    `note-title` is `dot.png`). `page.goBack()`: the note is back in Read mode with `scrollTop`
    within 10 px of before. This uses the Back restore from Phase 1. Use a note with several
    `![[wide.png]]` (a 400×300 fixture) above the scroll position, so a restore that ignores image
    heights fails. Repeat in Write mode via `.cm-embed img`, and assert the cursor didn't
    move to the embed line. A `video` embed doesn't navigate on click. A second test with the same
    body, tagged `@iphone`, runs it on the phone projects (tap instead of click). Fails today: no
    embeds, no scroll restore.
  - Verify: `just e2e e2e/media.spec.ts` → green on `desktop`, `webkit-desktop`, `iphone` and
    `webkit-iphone`; `just check` → green.

- [x] Embeds in chat answers
  - Test first: `e2e/media.spec.ts` › "@llm an embed in an assistant answer renders". Assistant text
    only exists after a real model turn (user prompts render as plain text), so the test is `@llm`.
    Push `dot.png`, then ask the dev model to "Reply with exactly this and nothing else:
    ![[dot.png]]". Assert `.atext .embed img` with `naturalWidth === 1`. Fails today: the chat renders
    `!` + a link.
  - Verify: `just e2e e2e/media.spec.ts --grep @llm` with the dev model → green; `just check` → green.

## Phase 5: production CSP and docs

- [x] Allow `blob:` media in the prod CSP
  - Test first: run `just prodtest e2e e2e/media.spec.ts` before changing the Caddyfile. The video test
    fails through `cspGuard` (`media-src` falls back to `default-src 'self'`). Then add
    `media-src 'self' blob:` to `deploy/proxy/Caddyfile`.
  - Verify: `just prodtest` (rebuild), then `just prodtest e2e e2e/media.spec.ts e2e/sticky-mode.spec.ts`
    → green; `rtk grep -n "media-src 'self' blob:" deploy/proxy/Caddyfile` → one match.

- [x] Visual check on phone and desktop
  - Test first: none, visual. Covered by the e2e above, then checked by eye per the global rule.
  - Verify: Playwright MCP screenshots at 1× of Read and Write mode with image and video embeds, at
    iPhone width and at 1280 px. Look at the last embed in a long note and the right edge (no
    overflow). Save them to `tmp/`, and name in the report what was checked. Also tap **Open** on a PDF
    in the installed iOS home-screen app on a real device (ask the user), and note what happens.

- [x] README: mention media embeds and the sticky mode
  - Test first: none, docs.
  - Verify: `rtk grep -n -i "embed" README.md` → matches the new lines; `just check` → green.

System docs are updated at `/spec:archive`.
