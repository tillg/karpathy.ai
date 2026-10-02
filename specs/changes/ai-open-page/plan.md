---
feature: ai-open-page
title: "Plan: the AI can open notes in the UI"
status: applied
order: 4
created: 2026-10-02
edited: 2026-10-02
---

# Plan: the AI can open notes in the UI

Each step is one red → green cycle. Backend tests run against a real opencode container
(`test/opencode-container.ts`). Nothing is mocked. `@llm` steps need the Ollama model from the existing
`llm` project.

Names follow `domain.md`: the tool is `open_note`, not `open_page` ("page" is not a domain term).

## Phase 1: the tool reaches opencode (spike)

The spike settled the route (architecture.md §1): `XDG_CONFIG_HOME=/opt/opencode-config`, with the
config dir pre-baked at image build. opencode writes `.gitignore`, `package.json` and `opencode.jsonc`
into every config dir and installs `@opencode-ai/plugin` there at startup, so a read-only dir works only
when it is already populated. Tests therefore run on the image built from `deploy/opencode/Dockerfile`,
not on the stock image with mounts.

- [x] Load a custom tool from the image, not from a vault
  - Test first: `apps/backend/test/opencode-tools.test.ts` › "opencode lists open_note as a tool".
    `startOpencode` runs the image built from `deploy/opencode/Dockerfile` (built once per run,
    layer-cached) **by default**, so every backend test, including the phase 3 `@llm` runs, sees the
    tool. The test asserts that `GET /experimental/tool/ids` contains `open_note`, with no network
    access needed at startup. It fails today: no tool file exists, and the tests run the stock image.
    (A vault's `.opencode/tools/` *is* loaded by opencode; the guard stays `HARNESS_CONFIG` in the
    backend, which disables chat for such vaults. That is already covered by the backend tests.)
  - Verify: `cd apps/backend && npx vitest run --project default test/opencode-tools.test.ts` → green,
    then `just test` → all green.

## Phase 2: the tool validates paths

- [x] `open_note` accepts an existing note and refuses anything else
  - Test first: `apps/backend/test/open-note-tool.test.ts` calls `resolveNote(dir, path)` on a real temp
    directory. Cases: `notes/a.md` → ok; `missing.md` → `no such note`; `../other/a.md` and
    `/etc/passwd` → `outside the vault`; `notes` (a directory) → `no such note`; `.git/config` and
    `notes/.hidden.md` → `no such note`. It fails today: the check doesn't exist. `resolveNote` lives in
    an import-free module `deploy/opencode/lib/resolve-note.ts` (outside `tools/`, because opencode
    registers every export of a file in `tools/` as a tool), so the backend test loads it without
    `@opencode-ai/plugin`.
  - Verify: `cd apps/backend && npx vitest run test/open-note-tool.test.ts` → green, then `just test` →
    all green.
- [x] Allow the tool for both vault agents
  - Test first: `opencode-tools.test.ts` › "open_note is allowed for vault and vault-readonly, hidden for
    commit-message". It reads the managed `deploy/opencode/opencode.json` (the file the image copies).
    It asserts `open_note: allow` in both agents and `"*": deny` in `commit-message`. It fails today:
    the config entry doesn't exist.
  - Verify: `just test` → green; `docker build -f deploy/opencode/Dockerfile .` succeeds.

## Phase 3: the backend maps the call

- [x] Capture a real `open_note` event as a fixture
  - Test first: `apps/backend/test/chat.llm.test.ts` › "open_note shows up as an opened note". It
    prompts "Open the note notes/Todo.md for me." and asserts a completed tool call with path
    `notes/Todo.md` and `opens === true`, using the `Inconclusive` retry pattern of "read tools show up
    as consulted files". It stays red on `opens` until the next step. Save the run's raw
    `message.part.updated` events for the call to `test/fixtures/opencode-events.jsonl`: append them,
    and rewrite the vault root to `/vaults/a`.
  - Verify: `grep -c '"tool": *"open_note"' apps/backend/test/fixtures/opencode-events.jsonl` → ≥ 1.
- [x] `mapToolPart` sets `opens`; opening never marks a note AI-touched; read-only turns can open
  - Test first: `apps/backend/test/harness-map.test.ts` › "open_note maps to opens: true, writes: false,
    vault-relative path" and › "writtenPaths ignores open_note", both on the captured part. They fail
    today: there is no `opens` field (add `ToolCall.opens?` to `packages/shared`). Extend the `@llm` test
    from the step before with a conflict case: put the vault into conflict as "denied in conflict" does,
    prompt an open, and assert a completed `opens` call that isn't `denied`.
  - Verify: `just test` → green; `cd apps/backend && npm run test:llm -- -t "open_note"` → green.

## Phase 4: the web app opens the note

- [x] `noteToOpen` picks live, completed, unseen open calls; opened notes aren't "changed"
  - Test first: `apps/web/src/lib/chat.test.ts` › `noteToOpen` cases:
    - a completed opens part → its path;
    - the same id again → null;
    - running or error → null;
    - a write or read part → null;
    - an id pre-seeded from history → null.

    Plus › "changedPaths excludes opened notes". This fails today: `noteToOpen` doesn't exist. (Whether
    the user is editing is decided in the store at open time, architecture.md §4, and is covered by the
    e2e step.)
  - Verify: `cd apps/web && npx vitest run` → green.
- [x] Wire `useChat` to `openNote` / toast via `isEditing()`, seed `seen` from history, add the "opened" chip button
  - Test first: `e2e/chat.spec.ts` `@llm` › "AI opens a note", in this order:
    1. Prompt "Open the note notes/Todo.md".
    2. Assert that the editor shows `notes/Todo.md` (route `#/<vault>/notes/Todo.md`).
    3. The user opens another note from the file tree.
    4. Reload, and assert the route stays on the other note.
    5. Go to the chat (on iphone: tap the chat tab), and assert the `opened notes/Todo.md` chip.
    6. Tap the chip, and assert Todo opens.

    Second case › "AI doesn't switch while the user edits":
    1. Open `notes/Other.md`.
    2. Type into the editor, and keep it focused.
    3. Prompt the open from the chat. On desktop the chat composer takes focus, so type into the editor
       again before the turn ends. Drive the prompt through the API, as `chat.llm.test.ts` does.
    4. Assert that the route stays on `notes/Other.md`, the typed text is kept, and the
       "AI opened notes/Todo.md" toast and the chip appear.

    It fails today: nothing opens at step 2 of the first case.
  - Verify: `just e2e --grep "AI opens a note"` on desktop, ipad and iphone → green. Screenshots of the
    editor and the chip go in `tmp/`.
  - As built: the tests live in `e2e/ai-open-note.spec.ts` (a fresh vault per test). Each device is its
    own test with its own viewport context (`AI opens a note (desktop|ipad|iphone)`), so the desktop and
    webkit-desktop projects run all three. The editing case runs on desktop. The phone's wait until the
    turn ends isn't observable with a fast model, so the test doesn't assert it.

## Phase 5: docs

- [x] README: the AI can open notes
  - Test first: none, because this step has no runtime surface.
  - Verify: `grep -n "open_note\|opens notes" README.md` matches; `just check` → green.

System docs are updated at `/spec:archive`.
