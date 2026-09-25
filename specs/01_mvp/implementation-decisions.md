# MVP implementation — autonomous decisions & assumptions

Log of decisions and assumptions made while implementing the MVP unattended
(started 2026-09-25 16:43 Europe/Berlin). Review these with the user.

| # | Decision / assumption | Why | Reversible? |
|---|---|---|---|
| 1 | Committed + pushed the pending spec/skill changes as one commit on `main` (`7a8ce18`). | User asked "commit and push our repo" first. | yes |
| 2 | Work happens directly on `main` (no branch). | Global rule: never create/switch branches without permission; `/implement` says "commit to the current branch". | yes |
| 3 | No Anthropic API key on this machine; `OPENAI_API_KEY` is. `@llm` tests and live e2e chat use an OpenAI model via opencode. The server default model stays **Claude Sonnet 5** (`anthropic/claude-sonnet-5`) per spec; the dev `.env` overrides it. | Only available provider key. Provider-agnostic design makes this a config value. | yes |
| 4 | Dev proxy publishes **https://localhost:8443** (not 443). | Keep off privileged/likely-used ports; 3000/8080 are taken by other local projects. | yes |
| 5 | Phase 5 steps "real device via VPN" and "deploy to home Ubuntu server" are **not done** (no access). Prod compose + Caddy DNS-01 config are written and `caddy validate`d only. | Out of reach from this machine. | — |
| 6 | Created the throwaway GitHub repo **`tillg/karpathy-ai-test-vault`** (private; `README.md`, `Note A.md`, `wiki/` subfolder variant, `outside.md`). `@github` tests use `TEST_VAULT_TOKEN` or fall back to `gh auth token`; they push only to a temporary `test-<ts>` branch and delete it afterwards. | Plan's `@github` tier requires it. Private, never real data. Delete with `gh repo delete tillg/karpathy-ai-test-vault` if unwanted. | yes |
| 7 | TypeScript **5.9** (not 7.0 "tsgo", which is `latest` on npm). Vitest 5, Express 5, zod 4, Vite 8, React 19. | 5.9 has the widest tooling compatibility. | yes |
| 8 | Backend runs TS directly via `tsx` (no build step), in dev (`tsx watch`) and prod. | Fewer moving parts for a single-user app. | yes |
| 9 | Clone URL = `GIT_REMOTE_BASE` + `owner/name.git` (default `https://github.com/`). Tests and the dev stack point it at local bare repos (`file://…`). GitHub token is passed per git call via `GIT_CONFIG_*` env (`http.extraheader`), never written to `.git/config`; clone errors are token-redacted. | Real git in tests without GitHub; no credential on disk in the vault. | yes |
| 10 | Unresolved **Conflict paths are persisted** in the config store (`conflicts[vaultId]`), while the *state* is still derived from the `karpathy-ai-pull` stash entry. Recomputed from git if the record is missing. | After "keep theirs" on an untracked clash the file no longer differs from HEAD, and tracked unmerged entries stay until the final `git reset`, so git alone can't tell resolved from unresolved paths. | yes |
| 11 | `DELETE /vaults/:id` is also blocked (409) while **unpushed commits** exist, not only uncommitted changes. | Removing the clone would silently lose them. | yes |
| 12 | Extra routes not in the spec: `DELETE /vaults/:id/file?path=&version=` (delete a note), `GET /vaults/:id/conflicts/sides?path=` (mine/theirs for the resolution UI), `DELETE /vaults/:id/chats/:chatId`, unauthenticated `GET /healthz` (container liveness; no data; outside `/api`). `PUT /file` accepts `force: true` for the stale-save "Overwrite" choice. | Needed for a usable UI (create/edit/delete notes) and for Docker health checks. | yes |
| 13 | File tree hides dot-entries (`.git`, `.obsidian`, `.claude`, …). Search = ripgrep fixed-string, case-insensitive (respects `.gitignore`), plus file-name matches (line 0), max 200 hits. | Obsidian-like; skills/config aren't notes. | yes |
| 14 | Commit `Co-authored-by` trailer: `Co-authored-by: karpathy.ai agent <agent@karpathy.ai>`. Author/committer = `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env of the backend. | Spec says "an agent trailer" without naming one. | yes |
| 15 | Commit / push: if the pre-commit pull can't reach the remote ("offline"), the commit is still made locally and becomes an unpushed commit. | Matches plan P3 "remote unreachable → commit local, 1 unpushed". | yes |
| 16 | Prod proxy image builds Caddy with a DNS provider module via `xcaddy` (build arg `DNS_PROVIDER`, default **cloudflare** — assumption, the DNS provider isn't named anywhere). DNS token via `{file.*}` from a compose secret. | DNS-01 needs a provider module. | yes |
| 17 | Named volumes get their ownership from the images (mount points pre-created as `APP_UID:APP_GID`, default 1000:1000) instead of an init container. | Keeps the stack at the three specified services (+ a dev-only `web` Vite service). | yes |
| 18 | Dev stack adds a 4th service **`web`** (Vite dev server, HMR) behind the proxy; prod serves the static build from the proxy. | Spec: "dev override bind-mounts the sources for hot reload". | yes |
