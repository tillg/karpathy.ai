# Browser-only variant — desk research notes

Date: 2026-09-27. Scope: can karpathy.ai (vault = GitHub repo, git sync, ripgrep search, opencode agent
loop with skills/MCP) work as a pure browser app with no server of our own?

Method: primary sources only (MDN / MDN browser-compat-data, WebKit blog, vendor docs, GitHub
READMEs/source, npm registry). Where docs were silent, I probed the live endpoints with `curl`
(CORS preflight `OPTIONS` + real request with an `Origin: https://example.app` header) on
2026-09-27; those results are marked **[probe]** and can be re-run with the commands in §10.

Browser-support numbers come from MDN browser-compat-data **v8.1.3** (2026-09-24),
<https://github.com/mdn/browser-compat-data> (via `https://unpkg.com/@mdn/browser-compat-data/data.json`).
The MDN page for each API is linked inline.

---

## 1. Storing the vault in the browser

### 1.1 Origin Private File System (OPFS)

- `navigator.storage.getDirectory()`: Chrome 86, Firefox 111, **Safari/iOS 15.2** (BCD).
  <https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory>
- `FileSystemFileHandle.createSyncAccessHandle()`: Chrome 102, Firefox 111, **Safari/iOS 15.2** (BCD).
  It works **only in dedicated Web Workers**, needs a secure context, and has been Baseline since
  March 2023. It has lock modes: `readwrite` (exclusive, the default), `read-only`, and
  `readwrite-unsafe` (several handles, e.g. across tabs).
  <https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle>
- `FileSystemFileHandle.createWritable()` (async writes from the main thread): Chrome 86,
  Firefox 111, **but Safari/iOS only from 26**. It became Baseline in Sept 2025 (BCD +
  <https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable>).
  The Safari 26 release notes list the "File System WritableStream API"
  (<https://webkit.org/blog/17333/webkit-features-in-safari-26-0/>).
  → **Implication:** on iOS < 26, OPFS writes must run in a Worker through sync access handles.
- `FileSystemObserver` (change notifications): Chrome 133 only. Not in Firefox or Safari (BCD).
  So there is no cross-tab file watching; use BroadcastChannel instead (§8).
- `removeEntry`: Safari 15.2. `FileSystemHandle.remove()`: Chrome only (BCD).
- OPFS is invisible to the user. It is not a folder in Files.app, and Obsidian mobile cannot see
  it. The browser vault is its own clone that syncs only through git.

### 1.2 File System Access API (real folders on disk)

- `window.showDirectoryPicker()`: **Chrome/Edge 86+ only. Firefox: no. Safari/iOS: no** (BCD).
  MDN marks it "Limited availability", and it needs transient user activation.
  <https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker>
- → It cannot be the storage layer for the iPad/phone target. It could be a desktop-Chromium
  extra ("open my local Obsidian folder"), which is what Logseq's web app does
  (<https://github.com/logseq/logseq/blob/master/docs/docker-web-app-guide.md>).

### 1.3 IndexedDB

- It is available everywhere. It is the default backend of `@isomorphic-git/lightning-fs` (§2.1),
  of ZenFS `IndexedDB` (<https://github.com/zen-fs/dom>) and of wasm-git `IDBFS`
  (<https://github.com/petersalomonsen/wasm-git>).
- ITP's 7-day rule (§1.4) applies to IndexedDB just as it does to OPFS.

### 1.4 Quotas and eviction on Safari/iOS

- WebKit storage policy (Safari 17 / iOS 17 / iPadOS 17 / macOS Sonoma+):
  <https://webkit.org/blog/14403/updates-to-storage-policy/>
  - Browser apps (Safari): the **origin quota is up to 60 % of the disk** and the overall quota
    up to 80 %. Other apps that embed WebKit get 15 % / 20 %. Cross-origin frames get 10 % of the
    main frame's quota.
  - "When a web app is running standalone (as Home Screen Web App on iOS …) it has the same origin
    quota and overall quota as when it is opened in a browser app."
  - Eviction is LRU by last interaction or storage use. **Origins with active pages or persistent
    mode are excluded from eviction.**
  - `navigator.storage.estimate()`, `persisted()` and `persist()` are supported.
    BCD: `persist()` Safari 15.2, `estimate()` Safari 17.
- ITP 7-day cap (2020): "deleting all of a website's script-writable storage after seven days of
  Safari use without user interaction on the site". It covers IndexedDB, LocalStorage,
  SessionStorage, and SW registrations/cache. **Home-screen web apps are exempt**: "their days of
  use will match actual use of the web application", so first parties should not expect deletion.
  <https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/>
  (OPFS came later than this post. The 2023 storage-policy post puts all origin storage under one
  quota and one eviction model.)
- Safari 26: every site added to the Home Screen now opens as a web app by default
  (<https://webkit.org/blog/17333/webkit-features-in-safari-26-0/>). The ITP exemption is
  therefore the default for installed use.
- **Verdict:** install to the Home Screen and call `navigator.storage.persist()`. Then quota is not
  a problem for a Markdown vault; 60 % of the disk is far more than needed. Still, treat
  local-only data as disposable: **push often**, because the remote is the source of truth.

---

## 2. Git in the browser

### 2.1 isomorphic-git

- A pure-JS git (npm `isomorphic-git` 1.42.3, published 2026-09-27; it is actively released). It
  supports clone, fetch, push, pull, merge, commit, checkout, stash, tags, notes and more. It is
  "community-driven with volunteer maintenance": the original author left, and two volunteers
  (@jcubic, @mojavelinux) run it. "If you want a feature … you need to do this yourself."
  <https://github.com/isomorphic-git/isomorphic-git>
- The fs is bring-your-own. It needs readFile, writeFile, unlink, readdir, mkdir, rmdir, stat,
  lstat (and optionally readlink, symlink, chmod), and it prefers a `promises` API.
  Recommendations: **LightningFS**, BrowserFS/ZenFS, or Filer.
  <https://isomorphic-git.org/docs/en/fs>
- `@isomorphic-git/lightning-fs` (4.10.3, 2026-09-25) stores data in **IndexedDB**. Directory ops
  are in-memory (0 ms), file ops are throttled by IndexedDB, and the superblock is persisted with
  a 500 ms debounce. Access is serialised by a mutex across tabs and workers. It accepts a custom
  `backend`. <https://github.com/isomorphic-git/lightning-fs>
- **There is no official OPFS adapter.** Options:
  - ZenFS `@zenfs/dom` (1.2.14) `WebAccess` backend on `navigator.storage.getDirectory()`
    (<https://github.com/zen-fs/dom>)
  - a thin custom adapter over OPFS (~200 LOC; the required method list is above)
  - small wrappers such as `opfs-tools` (npm 0.7.4) or <https://github.com/mickaelvieira/opfs>

  → This needs a spike, especially the speed of the many small `.git/objects` writes on WebKit.

### 2.2 CORS: github.com smart-HTTP has no CORS

- The isomorphic-git README says isomorphic-git can only clone from the page's own origin
  unless the git server sends CORS headers. GitHub, GitLab and Bitbucket don't; Gitea, Gogs and
  Azure DevOps do. You need a proxy.
  <https://github.com/isomorphic-git/isomorphic-git>
- **[probe]** `GET https://github.com/tillg/karpathy.ai.git/info/refs?service=git-upload-pack`
  with an Origin header gives **200 with no `Access-Control-Allow-Origin`**. The preflight
  `OPTIONS` gives **405**. **Confirmed: a browser cannot talk to github.com git directly.**
- Proxies:
  - The public `https://cors.isomorphic-git.org` is "sponsored by Clever Cloud" and "blocks
    requests that don't look like valid git requests".
    <https://github.com/isomorphic-git/cors-proxy>
    A 2018 post said it accepts **only `https://isomorphic-git.github.io`**
    (<https://isomorphic-git.org/blog/2018/07/08/cors-proxy-origin-limited>).
    **[probe] That no longer holds:** a request with `Origin: https://example.app` got
    `access-control-allow-origin: *` and a valid upload-pack advertisement. It still is **not
    something to rely on in production**. It is a third party that sees the PAT in `Authorization`
    and has no SLA.
  - Self-host `@isomorphic-git/cors-proxy` (3.0.2): `cors-proxy run`, or Express middleware with
    `ALLOW_ORIGIN`. Git credentials pass through in `Authorization`, and proxy auth goes in
    `X-Authorization`. <https://github.com/isomorphic-git/cors-proxy>
    Logseq runs its own fork (<https://github.com/logseq/cors-proxy>).
  - A Cloudflare Worker version is not documented upstream. It is easy to write (it forwards
    `/info/refs`, `git-upload-pack` and `git-receive-pack` and adds CORS), but **it is a server**,
    just a stateless and cheap one.

### 2.3 wasm-git (libgit2 compiled to WASM)

- Backends: MEMFS, IDBFS, NODEFS, and OPFS in three variants:
  - pthreads/WASMFS: fastest, **needs COOP/COEP**
  - JSPI: SAB-free, needs JSPI
  - ASYNCIFY: universal fallback, biggest binary

  The sync build must run in a Worker. It supports clone, add, commit, push, pull and status, and
  it has been in production at Y42 since 2020. **It has the same CORS problem**: the git server
  must allow CORS or be same-origin. <https://github.com/petersalomonsen/wasm-git> (npm 0.0.17)
- JSPI support per BCD: Chrome 137, Firefox 153, **Safari 27**. Safari < 27 needs the ASYNCIFY
  or pthreads variant.

### 2.4 GitHub REST / GraphQL API (CORS-enabled, no git protocol needed)

- **[probe]** `api.github.com` (REST and `/graphql`) answers preflights with
  `access-control-allow-origin: *` and allows Authorization and Content-Type with
  GET/POST/PATCH/PUT/DELETE. It also exposes `X-RateLimit-*` and `ETag`.
  `raw.githubusercontent.com` also sends `ACAO: *`.
  **But** `codeload.github.com` (the tarball/zipball download) sends
  `ACAO: https://render.githubusercontent.com` only, so an archive download cannot be read
  cross-origin.
- Contents API: files ≤ 1 MB are fully supported; 1–100 MB need the raw media type; > 100 MB are
  unsupported. A directory listing caps at **1,000 files**. PUT/DELETE are one commit per file,
  need the blob `sha` for updates, and must be sent **serially**.
  <https://docs.github.com/en/rest/repos/contents>
- Git Data API: a recursive tree fetch caps at **100,000 entries / 7 MB** (`truncated`).
  Creating a tree accepts inline `content` and `base_tree`, and `sha: null` deletes. This lets
  **one commit hold N file changes**: create tree → create commit → update ref.
  <https://docs.github.com/en/rest/git/trees>
- GraphQL `createCommitOnBranch`: sends `fileChanges` (additions with base64 contents, and
  deletions) plus `expectedHeadOid`, which works like optimistic locking and fails if the branch
  moved. The commit is **signed/verified by GitHub** as the token owner.
  <https://docs.github.com/en/graphql/reference/mutations#createcommitonbranch>,
  <https://github.com/orgs/community/discussions/24599>
- Rate limits: 60 requests/h unauthenticated, **5,000/h authenticated**. Secondary limits:
  **80 content-creating requests/min and 500/h**, 100 concurrent requests, 900 REST points/min.
  <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
  → A first "clone" of a 2,000-file vault costs 1 tree call plus about 2,000 blob GETs
  (≈ 40 % of the hourly budget). `raw.githubusercontent.com` with a token is an alternative for
  blob reads.
- The trade-off against real git: the API route needs **no proxy**. But you lose local history,
  offline commits, the git 3-way merge (you would write your own "remote changed since base"
  detection using blob SHAs), and it ties you to GitHub. That fits ADR 0001 ("vault = GitHub
  repo") but not "any git remote".

---

## 3. GitHub authentication without a server

| Method | Works from a pure browser? | Evidence |
|---|---|---|
| **Fine-grained PAT** pasted by the user | **Yes.** It can be scoped to a single repo with `contents:read/write` and expires after at most 366 days, or never (orgs can require approval and cap the lifetime). | <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens> |
| OAuth **web flow** (+PKCE) | **No.** PKCE is supported (S256 only) since 2025-07-14, but the code exchange still **requires `client_secret`** and the token endpoint has **no CORS**. | Changelog <https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/>; OAuth docs <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>; GitHub App docs ("client_secret … Required") <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app> |
| OAuth **device flow** | **No** (CORS). It needs no secret, but GitHub docs say "CORS pre-flight requests (OPTIONS) are not supported". **[probe]** A POST to `github.com/login/device/code` returns 200 **without ACAO**, so the browser cannot read the response. `OPTIONS` → 404. | same OAuth docs page |
| GitHub App user tokens | They need the same endpoints, so the same verdict applies. Tokens expire after 8 h and refresh tokens after 6 months. | GitHub App docs above |

- → Your assumption holds: **device flow has no CORS**. Also note: **PKCE does not make a
  secret-less SPA flow possible on GitHub.** "GitHub does not distinguish between public and
  confidential clients" (changelog). A proper "Sign in with GitHub" therefore needs a small
  token-exchange endpoint, the classic pattern of Prose's gatekeeper
  (<https://github.com/prose/gatekeeper>) and StackEdit's `server/github.js` →
  `/oauth2/githubToken` (<https://github.com/benweet/stackedit>). A proxy for `github.com/login/*`
  would also work; it is the same kind of tiny stateless function.
- Token storage risk: any XSS or malicious dependency in the page can read tokens from
  localStorage, IndexedDB or memory. The Anthropic and OpenAI SDKs gate browser use behind
  `dangerouslyAllowBrowser` for exactly this reason (§4). Mitigations:
  - fine-grained PAT limited to the vault repo, with an expiry
  - a strict CSP (`connect-src` allow-list)
  - no third-party scripts
  - optionally encrypting at rest with a WebCrypto key derived from a passphrase (this protects
    against casual device access, not against XSS)

---

## 4. LLM calls from the browser

### 4.1 CORS per provider ([probe] 2026-09-27, preflight from `Origin: https://example.app`)

| Provider | Endpoint | ACAO | Notes |
|---|---|---|---|
| Anthropic | `api.anthropic.com/v1/messages` | `*` (allows `x-api-key`, `anthropic-version`, `anthropic-dangerous-direct-browser-access`) | The request **must** send `anthropic-dangerous-direct-browser-access: true`, which was introduced in Aug 2024 for BYOK/internal tools (<https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/>). The TS SDK sets it when `dangerouslyAllowBrowser: true` (<https://github.com/anthropics/anthropic-sdk-typescript>). |
| OpenAI | `/v1/chat/completions` (echoes origin), `/v1/responses` (`*`) | yes | openai-node: browsers are "disabled by default … Enable … `dangerouslyAllowBrowser`" (<https://github.com/openai/openai-node>) |
| OpenRouter | `/api/v1/chat/completions` | `*` | allows `HTTP-Referer`, `X-Title` |
| Google Gemini | `generativelanguage.googleapis.com` native + `/v1beta/openai/` | echoes origin | `x-goog-api-key` allowed |
| Mistral | `api.mistral.ai/v1/chat/completions` | `*` | |
| Groq | `api.groq.com/openai/v1/chat/completions` | `*` | |
| Ollama (local) | `localhost:11434` | By default only `127.0.0.1`/`0.0.0.0` (and localhost-type) origins. A hosted PWA origin **must be added to `OLLAMA_ORIGINS`**. | <https://docs.ollama.com/faq> |
| LM Studio (local) | `localhost:1234` | Off by default. Enable it with `lms server start --cors` or the "Enable CORS" toggle. | <https://lmstudio.ai/docs/cli/serve/server-start>, <https://lmstudio.ai/docs/developer/core/server/settings> |

- Extra caveat for local models: an `https://` PWA calling `http://<LAN-IP>:11434` is **mixed
  content** and gets blocked. `http://localhost` counts as potentially trustworthy, but on an iPad
  the model is never on localhost. You would need TLS on the Ollama host (reverse proxy), and
  that brings back a server.
- **Pattern: BYOK.** The user pastes their own provider key. It is stored locally and sent
  straight to the provider. Risk: the same exfiltration surface as §3. Since each user pays for
  their own key, the blast radius is that one user. That is acceptable for the current
  single-user product.

### 4.2 In-browser models

- WebGPU: **Safari/iOS 26** (BCD; Safari 26 notes: "WebGPU … shipping on all platforms"
  <https://webkit.org/blog/17333/webkit-features-in-safari-26-0/>). Chrome 113+ on desktop
  (platform details in BCD notes) and Chrome Android 121. Firefox is partial (Windows 141+, Apple
  silicon macOS 145+). → **Your guess is confirmed: Safari 26 ships WebGPU, including on iOS.**
- WebLLM (`@mlc-ai/web-llm` 0.2.85) needs WebGPU and has an OpenAI-compatible API. Model
  families: Llama 3, Phi 3, Gemma, Mistral, Qwen. It runs in a Web Worker or Service Worker and
  caches models in the Cache API, IndexedDB or OPFS. **Function calling is "WIP"** (only manual
  prompting is supported). <https://github.com/mlc-ai/web-llm>
- transformers.js (`@huggingface/transformers` 4.3.0): "Enable WebGPU for Safari 26 and above",
  with a WASM fallback. <https://github.com/huggingface/transformers.js/releases/tag/4.3.0>
  It is useful for **embeddings and semantic search** (§6) rather than for the agent LLM.
- Chrome built-in AI (Prompt API / Gemini Nano):
  - It is desktop-only (Windows 10/11, macOS 13+, Linux, ChromeOS Plus) and needs **22 GB free**
    and 16 GB RAM or a GPU with more than 4 GB VRAM. **No Android and no iOS.**
    <https://developer.chrome.com/docs/ai/prompt-api>
  - The docs say stable in Chrome 138. BCD lists `LanguageModel` for web pages from Chrome 148;
    that gap is probably extensions vs. web pages.
  - Safari and Firefox: no.
  - The docs do not mention tool calling.
- → On-device models on iPad are **not a realistic agent backend**. The limits are memory
  pressure in WebContent, small models, and weak or unreliable tool calling. Keep cloud providers
  through BYOK.

---

## 5. The agent loop in the browser

### 5.1 Libraries

| Library | Browser? | Evidence |
|---|---|---|
| **Vercel AI SDK** (`ai` 7.0.118) | Yes (fetch-based). Multi-step tool loop via `stopWhen` (`isStepCount(n)` with a default of 20, `hasToolCall`, `isLoopFinished`), plus `prepareStep`. Without `stopWhen` there is a single generation. The docs present Core as server-first. | <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>, <https://github.com/vercel/ai/blob/main/content/docs/03-agents/04-loop-control.mdx>. A code search found **no** built-in Anthropic browser header; pass `headers: {'anthropic-dangerous-direct-browser-access':'true'}` yourself. |
| **pi-ai / pi-agent-core** (now `@earendil-works/pi-ai` / `pi-agent-core` 0.87.1; repo `earendil-works/pi`, formerly badlogic/pi-mono) | **Yes, explicitly.** pi-ai: "supports browser environments … pass API keys explicitly — or inject a `CredentialStore`". Bedrock and OAuth logins are Node-only. The earlier `pi-web-ui` package is no longer in the monorepo (last npm publish 0.75.3, May 2026). | <https://github.com/earendil-works/pi> (packages/ai README, section "Browser Usage") |
| **OpenAI Agents SDK JS** (`@openai/agents` 0.18.0) | Partly. The official list is Node 22+, Deno, and Bun. Browser: "The core SDK can be bundled for browser use, but tracing is disabled by default there." Responses-WebSocket transport does not work in browsers (no custom headers). It is OpenAI-centric, and other providers need the AI SDK adapter. | <https://github.com/openai/openai-agents-js/blob/main/docs/src/content/docs/guides/troubleshooting.mdx> |
| **LangChain.js** | Browser is listed as supported, but `createAgent` fails in browsers because of `node:async_hooks`. The suggested alternative is the `deepagents/browser` entrypoint. | <https://blog.langchain.com/js-envs/>, <https://forum.langchain.com/t/browser-compatibility-issue-createagent-fails-due-to-node-async-hooks-dependency/2713>, <https://github.com/langchain-ai/deepagentsjs> |
| **Mastra** | It is server-centric; `MastraClient` talks to a Mastra server. There is a blog post "Introducing Browser Support for Mastra Agents". | <https://mastra.ai/docs/server/mastra-client>, <https://mastra.ai/blog/introducing-browser-support> |
| **Anthropic TS SDK** | It works with `dangerouslyAllowBrowser: true`. It is a raw client; you write the tool loop yourself, or use its tool runner helper. | <https://github.com/anthropics/anthropic-sdk-typescript> |

A client-side tool loop is a solved problem. Once the file tools are functions over the
browser fs (§1/§2), `read_file`, `write_file`, `list`, `search` and `load_skill` are trivial. The
AI SDK or pi-ai also gives provider-agnosticism, which matches the CLAUDE.md "never hard-wire a
provider" rule.

### 5.2 Can opencode itself run in the browser? **No.**

- The `opencode-ai` npm package (1.18.32) ships a native binary: `bin/opencode.exe` plus
  `optionalDependencies` for linux, darwin and windows on x64/arm64/musl/baseline, and **no WASM
  or browser build** (`npm view opencode-ai`). "opencode web" is a browser UI that connects to a
  local server started by `opencode web` (<https://opencode.ai/docs/web/>).
- WebContainers (StackBlitz):
  - They run **Node, not Bun**. The Bun runtime request is an open issue, and an earlier one was
    closed as not planned (<https://github.com/stackblitz/webcontainer-core/issues/1891>).
  - They need SharedArrayBuffer plus cross-origin isolation, specifically **COEP
    `credentialless`**, which works only in Chromium. Firefox support is alpha and Safari 16.4+
    is beta (<https://webcontainers.io/guides/browser-support>). BCD: COEP `credentialless` is
    Chrome 96 and Firefox 119, **Safari no**.
  - A commercial license is required for "production usage … in a commercial, for-profit
    setting" (<https://webcontainers.io/enterprise>).
  - → WebContainers are not a way to run opencode on iPad.
- `@opencode-ai/sdk` is a client for a running server (`./client`, `./server`, `./v2/*` exports),
  not the loop itself.
- **Consequence:** browser-only means **replacing opencode** with an in-page loop (AI SDK or
  pi-agent-core). That runs against CLAUDE.md's "do not reimplement the loop, tools, or skills".
  This is the central architectural cost of browser-only.

### 5.3 Prior art: browser-based agents

- bolt.new: an AI app builder running on WebContainers, Chromium-first
  (<https://github.com/stackblitz/bolt.new>).
- Claude Code on the web: **it is not in-browser**. "A cloud session … runs on cloud
  infrastructure", in an isolated sandbox, with a git proxy service for GitHub
  (<https://code.claude.com/docs/en/claude-code-on-the-web>). This is the same shape as the
  current server design.
- Logseq web: File System Access plus isomorphic-git plus its own cors-proxy fork (§1.2, §2.2).

### 5.4 MCP from the browser

- The Streamable HTTP transport is plain POST/GET plus optional SSE, with the `Mcp-Session-Id`
  and `MCP-Protocol-Version` headers. Servers **MUST validate `Origin`**. stdio needs a
  subprocess, so it is **impossible in a browser**.
  <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- The TS SDK (`@modelcontextprotocol/sdk` 1.30.1) "sets no CORS headers itself". Browser clients
  need the server to add `cors()` with `exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate',
  'Last-Event-Id', 'Mcp-Protocol-Version']`
  (<https://github.com/modelcontextprotocol/typescript-sdk/blob/main/examples/legacy-routing/server.ts>).
- **[probe]** The remote GitHub MCP server `api.githubcopilot.com/mcp/` answers preflights with
  `ACAO: *` and `allow-headers: *`.
- → **Only remote MCP servers that opt into CORS are usable**, and local stdio MCP is gone.

---

## 6. Vault search in the browser (ripgrep replacement)

| Option | Notes | Source |
|---|---|---|
| Brute-force scan | Read every `.md` file from OPFS or an in-memory cache and run a JS regex, ideally in a Worker. This is fine for a few thousand notes. | — |
| MiniSearch 7.2.0 | "Tiny but powerful **in-memory**" engine with prefix and fuzzy search, field boosting and incremental add/remove. | <https://github.com/lucaong/minisearch> |
| FlexSearch 0.8.x | Fastest. v0.8 adds **persistent indexes**, including IndexedDB in the browser. | <https://github.com/nextapps-de/flexsearch> |
| Orama 3.1.18 | Full-text plus **vector and hybrid** search, typo tolerance, and a persistence plugin. It pairs with transformers.js embeddings. | <https://github.com/oramasearch/orama> |
| lunr 2.3.9 | Last published 2023, effectively unmaintained. | npm |
| SQLite-WASM + FTS5 (`@sqlite.org/sqlite-wasm` 3.53.4) | The canonical build includes **FTS5** (not FTS3/4). The `opfs` VFS needs COOP/COEP plus a Worker and **Safari 17+**. The `opfs-sahpool` VFS needs **no COOP/COEP** and works on Safari 16.4+, but allows only one connection (coordinate with Web Locks). | <https://sqlite.org/wasm/doc/trunk/persistence.md>, <https://sqlite.org/forum/info/28402061cb> |
| ripgrep-wasm | Community ports: `ripgrep` on npm (wasm32-wasip1 build) and <https://github.com/corychainsman/ripgrep-wasm> (in-memory API with browser demos). They lose ripgrep's main advantage (mmap and parallel fs walk) and add little over a JS scan. | <https://www.npmjs.com/package/ripgrep> |

→ Use a MiniSearch or FlexSearch index kept in sync on each write, plus a regex scan for exact or
regex queries. If semantic search is wanted, add Orama with transformers.js embeddings.

---

## 7. Skills portability

- The spec (<https://agentskills.io/specification>) defines a `SKILL.md` with frontmatter `name`
  (≤ 64 chars, must match the directory) and `description` (≤ 1024 chars), plus optional
  `license`, `compatibility`, `metadata` and `allowed-tools`. Optional directories are
  `scripts/`, `references/` and `assets/`. Progressive disclosure has three tiers:
  1. metadata, about 100 tokens, at startup
  2. the body, under 5,000 tokens, on activation
  3. resources, on demand
- The integration guide (<https://agentskills.io/integrate-skills>) explicitly covers
  **agents without a filesystem**:
  - use a dedicated `activate_skill` tool whose `name` parameter is an enum of valid skills
  - put the catalog (`<available_skills>`) in the system prompt or the tool description
  - wrap activated content in `<skill_content>`, list resources without reading them eagerly,
    and protect skill content from compaction
  - scan `.agents/skills/` and, pragmatically, `.claude/skills/`
  - gate project skills on trust

  → **A browser loop can implement this completely.** The vault is in OPFS, so discovery is a
  directory walk and activation is a file read.
- Scripts are the gap:
  - JS scripts could run in a Worker or iframe sandbox.
  - Python needs **Pyodide** (npm 314.0.7). It has no threads, multiprocessing or sockets.
    `requests`/`urllib3` work but are subject to CORS. Streaming downloads work only in a Worker
    on a cross-origin-isolated page.
    <https://pyodide.org/en/stable/usage/wasm-constraints.html>
  - Bash and CLI tools (`gh`, `rtk`, scrapers with credentials) are **not portable**.
  - This matches the caveats already listed in `specs/01_mvp/mvp.md` §4, and they get
    strictly worse in the browser.

---

## 8. iOS PWA runtime constraints

- **No background execution.** An Apple Frameworks Engineer said: "If you are trying to keep
  running UI when the app itself is in the background, you cannot control this … On iOS it is
  very intentional to prevent this kind of behavior."
  (<https://developer.apple.com/forums/thread/777860>).
  → **A long agent turn (many tool calls and streaming) stops when the user switches apps or
  locks the iPad**, and the WebContent process may be killed. The loop must therefore:
  - checkpoint after every step (persist messages and tool results to IndexedDB/OPFS)
  - be resumable on `visibilitychange`
  - make tool calls idempotent

  Today's server design does not have this problem, because opencode keeps running server-side.
- Background Fetch: Chrome 74 only. Background Sync and Periodic Sync: Chrome only.
  **Safari/iOS: none** (BCD). → Push-on-close and scheduled sync are impossible, and pushes
  happen only while the app is in the foreground.
- Push API: iOS 16.4+, **home-screen web apps only** (BCD note). This is not useful without a
  server that sends pushes anyway.
- Screen Wake Lock: iOS 18.4 (BCD). It can keep the screen on during a long turn, which is a
  mitigation.
- Web Locks: Safari 15.4 (BCD; <https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API>).
  BroadcastChannel: Safari 15.4 (BCD). → These give single-writer coordination across tabs for
  the git repo, the search index and sqlite-sahpool.
- Service workers are fine for the offline app shell. Cross-origin isolation (COOP/COEP) works in
  Safari 15.2+ with `require-corp`, but **not `credentialless`** (BCD). Requiring isolation
  therefore makes loading third-party resources painful. Prefer the libraries' non-SAB variants
  (sqlite `opfs-sahpool`, wasm-git ASYNCIFY or JSPI).

---

## 9. Prior art: browser-first Markdown/PKM with git or GitHub sync

| App | Model | Is it really serverless? |
|---|---|---|
| **StackEdit** | Browser Markdown editor that syncs with GitHub, GitLab, Google Drive, Dropbox and others | **No.** GitHub OAuth goes through its own server (`server/github.js`, `/oauth2/githubToken`). Last push 2023-07. <https://github.com/benweet/stackedit> |
| **Prose.io** | Editor for GitHub content using the GitHub API from the browser | Uses **gatekeeper** ("Enables client-side applications to dance OAuth with GitHub"). Looking for maintainers. <https://github.com/prose/prose>, <https://github.com/prose/gatekeeper> |
| **Logseq web** | File System Access (Chromium only) plus isomorphic-git | Needs its own **cors-proxy** fork. <https://github.com/logseq/logseq/blob/master/docs/docker-web-app-guide.md>, <https://github.com/logseq/cors-proxy> |
| GitJournal, Obsidian (Git plugin) | Native apps | Not browser. Listed only to set the scope. |
| SilverBullet | Server-backed PWA | Has a server. It shows that "PWA + thin server" is the established pattern. |

The common theme: every GitHub-syncing browser editor still runs **one tiny server** for the
OAuth code exchange and/or the git CORS proxy.

---

## 10. Re-running the probes

```bash
O=https://example.app
curl -si -X OPTIONS "$URL" -H "Origin: $O" -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: content-type,authorization" | grep -i '^access-control'
curl -si "$URL" -H "Origin: $O" | grep -i '^access-control-allow-origin'   # real response
```

URLs probed: `github.com/login/device/code`, `github.com/login/oauth/access_token`,
`github.com/<o>/<r>.git/info/refs?service=git-upload-pack`, `api.github.com/{graphql,repos/…}`,
`raw.githubusercontent.com`, `codeload.github.com`, `cors.isomorphic-git.org/…`,
`api.anthropic.com/v1/messages`, `api.openai.com/v1/{chat/completions,responses}`,
`openrouter.ai/api/v1/chat/completions`, `generativelanguage.googleapis.com/…`,
`api.mistral.ai/v1/chat/completions`, `api.groq.com/openai/v1/chat/completions`,
`api.githubcopilot.com/mcp/`.

---

## 11. Summary table

| Requirement | Browser-only option(s) | Maturity | iOS Safari support | Verdict |
|---|---|---|---|---|
| Store vault files | OPFS (sync handles in a Worker); IndexedDB (lightning-fs) | OPFS Baseline 2023; IDB very mature | OPFS 15.2+, `createWritable` 26+; IDB yes | **Go.** OPFS in a Worker. Install to Home Screen + `persist()` |
| Use the user's real Obsidian folder | File System Access `showDirectoryPicker` | Chromium only | **No** | **No-go on iPad** (desktop-Chromium extra only) |
| Quota / eviction | `persist()`, home-screen install | Documented (WebKit 2023) | 60 % of disk per origin; ITP 7-day exempt for home-screen apps | **Go**, but push often |
| Clone / pull / push the GitHub repo | isomorphic-git or wasm-git **+ CORS proxy** | isomorphic-git mature but volunteer-run; wasm-git niche | Works (pure JS/WASM) | **Needs a proxy** (self-hosted Worker = a server) |
| Commit without git protocol | GitHub Git Data API / `createCommitOnBranch` | Stable, official | Yes (CORS `*`) | **Go** if GitHub-only. No proxy, but no local history/merge; rate limits |
| Merge / conflicts | isomorphic-git `merge`; or custom SHA-based conflict detection over the API | Medium | Yes | **Hard.** A re-implementation of today's backend logic |
| GitHub sign-in | Fine-grained PAT (paste) | Stable | Yes | **Go (PAT only).** OAuth web/device flow need a server (secret + no CORS) |
| LLM calls | BYOK direct: Anthropic (header), OpenAI, OpenRouter, Gemini, Mistral, Groq | Stable | Yes | **Go.** Key-in-browser risk accepted for single user |
| Local LLM (Ollama/LM Studio) | `OLLAMA_ORIGINS` / `--cors` | Stable | Blocked by mixed content unless the host has TLS | **Hard** from iPad |
| On-device LLM | WebLLM, transformers.js, Chrome Prompt API | Young; tool calling WIP | WebGPU 26+; Prompt API no | **No-go** for the agent; OK for embeddings |
| Agent loop | AI SDK `stopWhen`, pi-agent-core, OpenAI Agents (partial) | AI SDK / pi mature | Yes | **Go**, but **replaces opencode** (against CLAUDE.md principle) |
| Run opencode itself | WebContainers | Commercial license; Node only | No (COEP credentialless missing; Safari beta) | **No-go** |
| File tools (read/write/list/edit) | Own functions over OPFS | Trivial | Yes | **Go** |
| Search | MiniSearch/FlexSearch + regex scan; SQLite-WASM FTS5 (`opfs-sahpool`) | Mature | Yes (sahpool 16.4+) | **Go** |
| Skills (SKILL.md) | Catalog in the prompt + `activate_skill` tool (agentskills.io guide) | Spec documents this path | Yes | **Go** for instruction-only skills |
| Skill scripts | Pyodide (Python), Worker sandbox (JS) | Pyodide mature | Yes (heavy download) | **Partial.** No bash/CLI/subprocess/sockets |
| MCP | Remote Streamable HTTP servers with CORS | Spec stable; CORS opt-in per server | Yes | **Partial.** No stdio/local MCP |
| Long agent turns | Checkpoint + resume on `visibilitychange`; Wake Lock | — | No background execution; Wake Lock 18.4+ | **Hard.** Turns die when backgrounded |
| Background sync / push | Background Sync/Fetch | Chromium only | **No** | **No-go** |
| Multi-tab consistency | Web Locks + BroadcastChannel | Stable | 15.4+ | **Go** |
