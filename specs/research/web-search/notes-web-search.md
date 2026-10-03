---
title: "Notes: how agent tools give an LLM web search"
created: 2026-10-02
edited: 2026-10-02
---

# Notes: how agent tools give an LLM web search

Collected 2026-10-02 for the `web-search` change. The findings come from WebFetch summaries of primary
sources. The opencode facts were cross-checked locally against the pinned image
`ghcr.io/anomalyco/opencode:1.18.25`: `rg` is present, and the tool ids are `invalid`, `question`, `bash`,
`read`, `glob`, `grep`, `edit`, `write`, `task`, `webfetch`, `todowrite`, `websearch`, `skill` and
`apply_patch`. The websearch schema strings in the binary (`query`, `numResults` default 8, `livecrawl`)
match the source.

## 1. opencode 1.18.25

- **Sources:** `packages/opencode/src/tool/websearch.ts`, `mcp-websearch.ts`, `webfetch.ts` and
  `registry.ts` (<https://github.com/anomalyco/opencode/tree/v1.18.25>), plus the
  [tools docs](https://opencode.ai/docs/tools/).
- **`websearch` is a client tool.** It is not a provider tool. It sends JSON-RPC `tools/call` to a
  hosted MCP endpoint:
  - Exa: `https://mcp.exa.ai/mcp`, with `?exaApiKey=` added when `EXA_API_KEY` is set;
  - or Parallel: `https://search.parallel.ai/mcp`.

  `OPENCODE_WEBSEARCH_PROVIDER` picks the provider. Without it, the runtime flags decide, and failing
  that a 50/50 split by session hash.
- **Parameters:** `query`, `numResults` (default 8), `livecrawl`, `type`, `contextMaxCharacters`
  (default 10 000). The tool returns text, times out after 25 s, and asks permission through
  `ctx.ask`.
- **When it is enabled:** the provider is `opencode` or `opencode-go`, or `OPENCODE_ENABLE_EXA=1`, or
  `OPENCODE_ENABLE_PARALLEL=1`. With OpenRouter or Ollama one of these env flags is needed.
- **Privacy:** queries go to Exa or Parallel. The public endpoint needs no key, and we have no
  contract with either company.
- **`webfetch`:** always registered.
  - Arguments: `url` (http and https only), `format` (default markdown), `timeout` (at most 120 s).
  - Limits: responses are capped at 5 MB, and the permission pattern is the URL.
  - Gaps: no domain allowlist and no redirect restriction were found.
- **Permissions:** `permission.websearch` and `permission.webfetch` each take `allow`, `deny` or `ask`,
  with wildcard patterns.
- **Verified at the tag:**
  - **Redirects.** `webfetch` follows them: Effect `FetchHttpClient` calls global `fetch` without a
    `redirect` option.
  - **Plugins.** They load from `{plugin,plugins}/` in a config dir. A throwing `tool.execute.before`
    hook makes that tool call fail; the turn goes on.
  - **Truncation.** Tool output over 50 KB or 2000 lines is stored as a preview.
  - **Server password.** `OPENCODE_SERVER_PASSWORD` turns on Basic auth for every route, including
    `/global/health`.
  - **Proxy.** The bundled Bun 1.3.14 honours `HTTP(S)_PROXY`/`NO_PROXY`, and doesn't bypass loopback
    on its own.
  - **Where to look.** The details are in the `web-search` change, architecture.md "Facts" F1–F8.

## 2. Anthropic (Claude API, Claude Code)

- **[web_search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) is a
  server tool.**
  - Versions: `web_search_20250305`, `_20260209` (dynamic filtering) and `_20260318`
    (`response_inclusion`).
  - Results: url, title, page_age and `encrypted_content`. Citations carry `cited_text` (up to 150
    characters).
  - Cost: $10 per 1 000 searches plus tokens.
  - Controls: `allowed_domains` or `blocked_domains` (not both), `max_uses`, and org-level
    restrictions.
  - ZDR applies only to the older versions by default.
  - Not available on Bedrock.
- **[web_fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool):** costs
  nothing extra.
  - It fetches only URLs that already appear in the conversation (user text, tool results, earlier
    search results). This is a provenance rule against exfiltration.
  - It refuses URLs that look like credentials.
  - Anthropic still warns of a residual risk.
- **Claude Code** ([tools reference](https://code.claude.com/docs/en/tools-reference)):
  - `WebSearch` returns titles and URLs only.
  - `WebFetch(domain:…)` permission rules limit fetching to listed domains.
  - A separate summarizer model sits between the page and the agent.
  - Redirects to another host are not followed.

## 3. OpenAI

- **[Responses API `web_search`](https://developers.openai.com/api/docs/guides/tools-web-search) is a
  server tool.**
  - Controls: `allowed_domains` and `blocked_domains` (up to 100 each), `external_web_access: false`
    (cached index only), `user_location` and `search_context_size`.
  - Output: inline `url_citation` annotations plus `sources`.
  - Cost: $10 per 1 000 calls plus tokens.
- **Codex CLI:** `web_search = "cached"` (default), `"live"` or `"disabled"`
  ([config](https://developers.openai.com/codex/config-basic)).

## 4. OpenRouter (our provider)

- [Web search](https://openrouter.ai/docs/guides/features/server-tools/web-search) comes in two kinds.
  It runs natively for OpenAI, Anthropic, Google, Perplexity and xAI models. Every other model,
  GLM included, falls back to Exa at about $0.007 per request; Parallel and Perplexity engines also
  exist.
- **Ways to turn it on:**
  - `tools: [{type: "openrouter:web_search"}]` (current);
  - `plugins: [{id: "web"}]` (deprecated);
  - the `:online` model suffix.
- **Through opencode:** opencode allows custom model ids and per-model `options`, so a `…:online` slug
  should work, but this is **untested**. That route ties search to one provider, which goes against
  the provider-agnostic rule (ADR 0002).

## 5. Gemini and Perplexity

- **Gemini:** grounding with `{"type": "google_search"}` returns `url_citation` annotations. Search
  suggestions must be shown to the user ([docs](https://ai.google.dev/gemini-api/docs/google-search)).
- **Perplexity:** the Search API costs $5 per 1 000 calls. Sonar costs tokens plus $5–14 per 1 000
  requests ([pricing](https://docs.perplexity.ai/guides/pricing)).

## 6. Standalone search APIs for a client tool

| API | Price | Free tier | Privacy and notes |
|---|---|---|---|
| [Brave Search API](https://brave.com/search/api/) | $5 / 1k | $5 credit per month | ZDR offered, SOC 2 Type II, independent index |
| [Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search) | $0.008 per credit (basic = 1) | 1 000 credits per month | LLM-ready snippets; `include_domains` (up to 300) and `exclude_domains` |
| [Exa](https://exa.ai/pricing) | $4 / 1k | $10 credit per month | ZDR on the enterprise plan only |
| [SearXNG](https://docs.searxng.org/dev/search_api.html) | free, self-hosted | n/a | Meta-search: queries still go to upstream engines; JSON output must be enabled in `settings.yml` |
| Kagi | not retrieved | not retrieved | unverified |

## 7. Security

- **The lethal trifecta.** Web search counts as untrusted input and also as an outbound channel. In a
  vault with private notes, the agent then has all three parts of the
  "[lethal trifecta](https://simonwillison.net/2025/Sep/19/notion-lethal-trifecta)". Exfiltration
  through search queries has been demonstrated ([arXiv 2510.09093](https://arxiv.org/abs/2510.09093)).
- **URL controls don't cover queries.** The query itself can carry private data. Fetch-style URL
  controls don't help against that. What does help:
  - an approval step that shows the query;
  - domain-restricted or self-hosted search;
  - a search context that never sees the notes.
- **How the vendors mitigate:**
  - Anthropic: URL provenance rule, allow and block lists, `max_uses`.
  - Claude Code: a summarizer between the page and the agent, plus permission prompts.
  - OpenAI: domain lists and a cached-only mode.
