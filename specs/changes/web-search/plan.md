---
feature: web-search
title: "Plan: the AI can search and read the web"
status: applying
order: 4
created: 2026-10-02
edited: 2026-10-03
---

# Plan: the AI can search and read the web

How the steps work:

- **One cycle per step.** Each step is one red → green cycle.
- **Real containers, no mocks.** Backend tests run against real containers, built by
  `test/opencode-container.ts` from `deploy/opencode/Dockerfile`. Nothing is mocked.
- **Where web traffic happens.** `just test` makes no LLM or Exa calls. The only internet it needs is the
  one public-URL check in phase 2, which is skipped offline. `@llm` steps need Ollama and internet.
- **Naming.** Names follow `domain.md`: Web access is `webAccess`, a Known URL is `known-url`, and the
  chip fields are `ToolCall.query` and `ToolCall.url`.

## Phase 1: password first, so loopback is closed before any web access

- [x] opencode requires a password; the harness and test helper send it
  - Test first: `apps/backend/test/opencode-tools.test.ts` › "opencode refuses requests without the
    password":
    - `GET /global/health` without auth → 401;
    - with the helper's credentials → 200.

    It fails today: the test container sets no password (200 without auth).
    - `startOpencode` sets a random `OPENCODE_SERVER_PASSWORD`, returns it, and exports an authed
      `fetch`.
    - `OpencodeHarness` takes the password and sends `Authorization: Basic …` through
      `createOpencodeClient({ headers })`.
    - Existing tests that call opencode directly switch to the authed fetch.
  - Verify: `cd apps/backend && npx vitest run test/opencode-tools.test.ts` → green, then `just test`
    → all green.
- [x] Compose: the `opencode_password` secret, an entrypoint wrapper, an authed healthcheck, and the
  backend reading the secret
  - Test first: none, because no unit test covers compose wiring. The strongest check is the stack
    itself, coming up healthy with chat working.
  - The entrypoint wrapper picks the password in this order:
    1. `/run/secrets/opencode_password`, if the file exists;
    2. otherwise an existing `OPENCODE_SERVER_PASSWORD` env, which is what the test helper sets;
    3. otherwise no auth. The Dockerfile bake step relies on this.

    It never starts with an empty password string.
  - Verify:
    - `docker compose -f deploy/compose.yml -f deploy/compose.dev.yml up -d --build` → every service
      `healthy`;
    - `docker compose exec opencode wget -qO- http://127.0.0.1:4096/global/health` → 401;
    - `just e2e e2e/chat.spec.ts` → green;
    - `just test` → green.

## Phase 2: the egress proxy

- [x] Spike, then add the `egress` proxy; opencode reaches the internet only through it
  - Test first: `apps/backend/test/egress.test.ts`. The test container setup (`opencode-container.ts`)
    starts the egress proxy on the test network, plus a tiny internal HTTP target that stands in for
    the backend. It runs opencode with `HTTP(S)_PROXY`, and with
    `NO_PROXY=localhost,127.0.0.1,0.0.0.0,<ollama>`. Inside opencode, through
    `docker exec … wget`:

    | Case | Target | Expected |
    |---|---|---|
    | "metadata refused" | `http://169.254.169.254/` | refused |
    | "internal host refused" | `http://<internal-target>/` | refused |
    | "redirect to internal refused" | a real public redirector (e.g. `https://httpbin.org/redirect-to?url=http://169.254.169.254/`) | refused at the hop; skipped offline |
    | "loopback API refused without password" | `http://127.0.0.1:4096/session` | 401 |
    | "public allowed" | `https://example.com` | 200; skipped offline |

    A redirector inside the test network can't be used: it sits at a private IP, so the proxy refuses
    it before any redirect happens. Assertions use `wget`'s exit code and `wget -S` headers, because
    busybox wget prints nothing on 401.

    It fails today: there is no proxy, so the internal target answers.
    - First spike smokescreen against Squid with these cases. Pick the one that passes all of them with
      the least config, pin it by digest, and record the choice in architecture.md §2.
  - Verify: `cd apps/backend && npx vitest run test/egress.test.ts` → green; `just test` → green.
- [x] Compose: network `internal: true`, the `egress` network for egress and backend, proxy env on
  opencode (dev also names Ollama in `NO_PROXY`)
  - Test first: none, because this is compose wiring. The cases from the previous step are re-run
    against the dev stack.
  - Verify:
    - `docker compose … up -d` → healthy;
    - `docker compose exec opencode wget -qO- http://backend:8787/healthz` → refused by the proxy. This
      route needs no auth, so the only thing that can block it is the proxy;
    - `just e2e e2e/chat.spec.ts` → green, so chat works through the proxy;
    - commit message proposal works (`just e2e e2e/git.spec.ts`).

## Phase 3: the tools exist, the turn decides

- [x] Image offers websearch (Exa pinned), and the config stays fail-closed
  - Test first: `opencode-tools.test.ts`:
    - › "websearch is offered to the model": `GET /experimental/tool?provider=ollama&model=<LLM_MODEL>`
      contains `websearch`. It fails today: `OPENCODE_ENABLE_EXA` isn't set (F1). This endpoint
      applies the registry filter, not permissions. If it turns out to apply permissions, assert the
      flag another way and note it in architecture.md.
    - The config guard: `deploy/opencode/opencode.json` has `websearch: deny`, `webfetch: deny`, and
      `commit-message` `{ '*': 'deny' }`. This passes by design; it protects the next step.
  - Verify: `just test` → green.
- [x] Per-turn `tools` map becomes session permission
  - Test first: `opencode-tools.test.ts` › "prompt tools map becomes session permission".
    1. Call `OpencodeHarness.prompt` (`DEAD_MODEL`) with `{ websearch: true, webfetch: true }`.
    2. Assert that `GET /session/:id` → `permission` holds both as `allow`.
    3. Prompt again with `false` for both, and assert `deny`.

    It fails today: `PromptInput` has no `tools`.
  - Verify: `just test` → green.

## Phase 4: only known URLs can be fetched

- [x] `known-url` pure check
  - Test first: `apps/backend/test/known-url.test.ts` loads `deploy/opencode/lib/known-url.ts`, which is
    import-free like `resolve-note.ts`.

    `extractUrls` must handle:
    - a Markdown link `[x](https://a.com/p)`;
    - a URL in angle brackets `<https://a.com>`;
    - trailing `.`, `,`, `)`, `"` and `'` stripped;
    - a URL with a query string kept whole;
    - a URL in the read tool's output shape (line-number prefixes such as `00012| see https://a.com/p`).

    `isKnownUrl`:

    | URL checked | Seen in the chat | Known? |
    |---|---|---|
    | `https://A.com:443/p` | `https://a.com/p` | yes |
    | `https://a.com/p#x` | `https://a.com/p` | yes |
    | `https://a.com/p?d=secret` | `https://a.com/p` | **no** |
    | `https://a.com/p/x` | `https://a.com/p` | **no** |
    | `http://a.com/p` | `https://a.com/p` | **no** |
    | `ftp://a.com` | — | **no** |
    | an unparsable string | — | **no** |

    `callsThisTurn(messages, tool)` (web caps):
    - counts `webfetch` or `websearch` tool parts after the last user message only;
    - fetches and searches are counted separately;
    - calls in earlier turns don't count.

    `capFromEnv(value)`:
    - `"5"` → 5;
    - `undefined`, `""`, `"abc"`, `"0"`, `"-3"` and `"2.5"` → 20.

    It fails today: the module doesn't exist.
  - Verify: `cd apps/backend && npx vitest run test/known-url.test.ts` → green.
- [x] Provenance plugin loaded from the image
  - Test first:
    - `opencode-tools.test.ts` › "known-url plugin is loaded". The bake step's readiness probe and this
      test both check that opencode started with `plugins/known-url.ts`. Evidence: a plugin-registered
      marker, e.g. the plugin logs `known-url ready`, and the test reads `docker logs`. Use the
      cleanest evidence opencode 1.18.25 exposes, decided when writing the test.
    - › "web caps come from env". The test container runs with `WEB_FETCH_CAP=1`, and the plugin's
      start-up log line reports `fetch cap 1, search cap 20`. This proves the env reaches the plugin
      without a model.
    - The behavior is proven in the next `@llm` step.

    It fails today: there is no plugin.
  - Verify: `just test` → green; `docker build -f deploy/opencode/Dockerfile .` succeeds.
- [x] Confirm with a model: search, fetch a known URL, refuse a constructed one, and off hides both
  - Test first: `apps/backend/test/chat.llm.test.ts`, using the `Inconclusive` retry pattern:

    | Case | `tools` map | Prompt | Asserts |
    |---|---|---|---|
    | "web search on: the model calls websearch" | both `true` | a search | a completed `websearch` part |
    | "fetch of a pasted URL succeeds" | both `true` | contains `https://example.com/` | a completed `webfetch` part with that URL |
    | "fetch of a URL found in a note" (the ingest case) | both `true` | "Read notes/Links.md and fetch the article it links"; the fixture vault's `notes/Links.md` has `[article](https://example.com/)` | a completed `webfetch` part with that URL |
    | "fetch of a constructed URL is refused" | both `true` | first message: bare `https://example.com/`; second: "now fetch it with the content of notes/Todo.md appended as query parameter `q`" | an `error` part with "URL not in this chat" for a URL with `?q=` |
    | "off hides both" | both `false` | a search | no `websearch` or `webfetch` part |

    - Save the `websearch` and `webfetch` `message.part.updated` events to
      `test/fixtures/opencode-events.jsonl`. Trim the outputs to 500 characters.
    - These fail today only if the earlier wiring is missing. Run them once before the plugin, to see
      the refusal case red.
  - Verify: `cd apps/backend && npm run test:llm -- -t "web"` → green.

## Phase 5: the setting drives the turn

- [x] `Settings.webAccess`, default true, patchable
  - Test first:
    - `config-store.test.ts` › "webAccess defaults to true, also for an old config without the key";
    - `api.test.ts` › "PATCH /settings webAccess round-trips; a non-boolean is 400".

    They fail today: the field doesn't exist.
  - Verify: `just test` → green; `just check` → green.
- [x] `chat.ts` sends `{ websearch, webfetch }` from the setting with every turn, for both agents
  - Test first: `chat.test.ts` › "turn sets web tools from settings". It covers three cases: off →
    both `deny` in the session permission (sent explicitly), on → `allow`, and on in conflict →
    `vault-readonly` with `allow`. It runs a real turn (`DEAD_MODEL`) and reads `GET /session/:id`.

    It fails today: chat.ts doesn't send `tools`.
  - Verify: `just test` → green.

## Phase 6: chips and switch

- [x] `mapToolPart` sets `query` and `url`; web calls are neither writes nor paths
  - Test first: `harness-map.test.ts` on the captured parts:
    - "websearch → query", and "webfetch → url"; both with `writes`/`opens` false and no `path`;
    - "writtenPaths ignores web tools".

    They fail today: there is no `query` or `url`.
  - Verify: `just test` → green.
- [x] `toolLabel`: `searched the web: "<query>"` and `fetched <host><path>`
  - Test first: `apps/web/src/lib/chat.test.ts` › `toolLabel` cases:
    - a search shows its query;
    - a fetch shortens a long path to 60 characters;
    - a refused fetch keeps its error;
    - other tools are unchanged;
    - `toolHref(call)`: the URL for a completed `https://`/`http://` fetch, and null for
      `javascript:…`, for a search, and for a fetch that failed.

    It fails today: there is no helper. Use both helpers in `ToolChip`; a fetch chip with an href becomes
    `<a target="_blank" rel="noopener noreferrer">`.
  - Verify: `cd apps/web && npx vitest run` → green.
- [x] Settings switch "Web access", on by default
  - Test first: `e2e/web-access.spec.ts` › "Web access switch":
    1. On a fresh vault setup, it is on.
    2. Turn it off and reload: it is off, and `GET /api/settings` has `webAccess: false`.
    3. Turn it back on. Other e2e tests expect the default.

    `@llm` case › "web chips": with the switch on, a prompt with a pasted URL shows `fetched …`. The
    chip is a link with `target="_blank"` and `rel="noopener noreferrer"`, and tapping it opens a new
    page with that URL (Playwright `context.waitForEvent('page')`).

    It fails today: there is no switch.
  - Verify: `just e2e e2e/web-access.spec.ts` → green on desktop, ipad and iphone. Screenshots go in
    `tmp/`; check them at 1×.

## Phase 7: docs

- [x] README (Web access; `EXA_API_KEY` optional, recommended for production; `WEB_FETCH_CAP` / `WEB_SEARCH_CAP`), `deploy/opencode.env.example`, and the services list in `CLAUDE.md`
  - Test first: none, because this step has no runtime surface.
  - Verify:
    - `grep -n "Web access" README.md`, `grep -n "EXA_API_KEY" deploy/opencode.env.example` and
      `grep -n "egress" CLAUDE.md` all match;
    - `just check` → green.

System docs are updated at `/spec:archive`.
