---
feature: 05_prod_env
title: "Prod security — desk notes"
status: applying
order: 5
created: 2026-09-28
edited: 2026-09-28
---

# Prod security — desk notes

Desk research for spec #05 (prod env). All sources fetched **2026-09-28**; source IDs `[Sn]` resolve
in §10. Claims not backed by a fetched primary source are marked **[unverified]**.

Scope: single user, iPad/iPhone Safari (installed home-screen PWA) + Mac. A rented VPS
(Hetzner / IONOS / Oracle) clones private GitHub vaults (sensitive personal life-wiki) and holds a
GitHub token + LLM provider API keys. Domain `karpathy.app`.

## 0. Today's model (read from the repo)

| Aspect | Current state | File |
|---|---|---|
| Network | Caddy publishes `443` **and `80`**; MVP assumed a home server reachable only via home VPN | `deploy/compose.yml`, `specs/01_mvp/mvp.md` §3.3 |
| TLS | Let's Encrypt via **DNS-01** (Cloudflare DNS token as Caddy secret) — works without any public port | `deploy/proxy/Caddyfile` |
| App auth | One bearer token, SHA-256 + `timingSafeEqual` compare, on every `/api` route; no rate limit | `apps/backend/src/auth.ts` |
| Token on device | `localStorage` (`apps/web/src/lib/api.ts`), sent as `Authorization: Bearer`, never in URLs | `apps/web/src/lib/api.ts` |
| XSS defence | DOMPurify + strict CSP (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`) | `Caddyfile` |
| GitHub creds | One token, backend only, sent as HTTP header via git env (never in `.git/config`), redacted in errors | `apps/backend/src/git.ts`, `vaults.ts` |
| Provider keys | opencode container via `env_file: opencode.env` (**env var, not a compose secret**) | `deploy/compose.yml` |
| Harness | opencode internal network only, no port, vault-borne config blocked, `.git` edits denied | mvp §3.2 |

The app layer is already reasonably hardened. The big change from MVP → prod is **"home server
behind home VPN" → "rented VPS on the internet"**: the network layer and data-at-rest assumptions
no longer hold by default.

## 1. Network access layer

Threats: (T1) internet scanning / exploit of Caddy, Node, Express or a backend bug before auth;
(T2) token guessing / stolen token used from anywhere; (T3) DoS / log noise.

### 1.1 Public 443 + bearer token only (today, if deployed as-is)

- Protects: T2 only (a 256-bit random token is not brute-forceable). Everything pre-auth
  (TLS stack, HTTP parser, the static PWA, `/health`) is exposed to the whole internet (T1).
- iOS PWA: works (it is what exists).
- Effort 0, cost 0. Acceptable only as a fallback.

### 1.2 Tailscale (recommended)

- Free **Personal** plan: "Up to 6 users", "Unlimited user devices", MagicDNS, ACLs, Funnel
  included [S1]. No inbound port needed on the server — NAT traversal, DERP relay fallback [S2].
- iOS: official app, VPN On Demand (since 1.48) can keep the tunnel up automatically; "you can
  only have one VPN app with On Demand enabled at any given time" [S3] — conflicts with a
  corporate VPN on the Mac/iPhone.
- HTTPS: `tailscale cert` issues Let's Encrypt certs, but only for `<machine>.<tailnet>.ts.net`,
  no custom domains; names land in CT logs [S4]. **Not needed here**: keep the existing Caddy
  DNS-01 setup and point `app.karpathy.app` (A record) at the server's Tailscale `100.x` IP.
  The cert is public-CA, so iOS trusts it with no profile. The name/IP is public in DNS/CT, but
  the IP can only be reached from inside the tailnet. (Some resolvers/routers filter private/CGNAT
  answers — "DNS rebind protection"; MagicDNS or a split-DNS entry avoids that [unverified].)
- Funnel would make the service **public** again on 443/8443/10000 [S5] — do not enable.
- Trust in Tailscale's coordination server: a malicious coordinator could inject nodes;
  **Tailnet Lock** closes that and is "available for the Personal and Enterprise plans" [S6]
  (Personal = the free plan).
- Protects: T1, T2 (token useless without a device in the tailnet), T3. Works for the PWA
  unchanged, because to Safari it is just HTTPS to a normal hostname.
- Effort: low (install on server + 3 devices, ACL `user devices → server:443`). Cost 0.

### 1.3 Self-managed WireGuard / Headscale

- Plain WireGuard: same protection as Tailscale, no third-party coordinator, but you manage keys,
  a listening UDP port on the VPS (one open port, but WireGuard does not answer unauthenticated
  packets [unverified]), and no NAT-traversal helpers. Official WireGuard iOS app supports
  on-demand rules [unverified].
- Headscale: self-hosted Tailscale control server, "a single Tailscale network … suitable for a
  personal use" [S7]; works with the official clients (iOS needs a custom control-server URL
  [unverified]). Removes Tailscale Inc. from the trust path, adds a public service (the
  control server) you must run and patch — on the same VPS that is circular.
- Verdict: only if distrust of Tailscale Inc. outweighs running more infra. Tailnet Lock gives
  most of that benefit for free.

### 1.4 Cloudflare Tunnel + Cloudflare Access

- Free Zero Trust plan: "up to 50 users at no cost" [S8]. `cloudflared` dials out, so the origin
  can block all inbound [S9].
- Access sets a `CF_Authorization` JWT cookie (default session 24 h) plus a `CF_Binding` cookie;
  SameSite `Strict` "can result in too many redirects" [S10].
- **iOS PWA issues:** home-screen web apps have their own isolated cookie/storage jar
  ("by design", Apple/WebKit) [S11], so login must happen inside the standalone window. Community
  reports: when the Access session expires, the service worker serves the cached shell and the
  PWA never follows the login redirect; SW update checks get redirected to the Access login and
  fail with CORS errors [S12][S13]. Our `fetch`-based NDJSON API would get a 302/HTML instead of
  JSON on expiry — needs explicit handling. Fixable (network-first navigations, detect expiry,
  long session) but fragile.
- **Bigger issue for this data:** Cloudflare's proxy terminates TLS, so Cloudflare sees every
  vault file and chat in plaintext [unverified in fetched docs; inherent to a TLS-terminating
  reverse proxy]; US company → CLOUD Act (§4.3).
- Verdict: good for "no open ports + SSO", worse than Tailscale for confidentiality here.

### 1.5 mTLS client certificates

- Caddy supports it natively: `tls { client_auth { mode require_and_verify; trust_pool file ca.pem } }` [S14].
- iOS: identities installed by profile/MDM go into an Apple-only keychain group that Safari can
  use; Safari shows an identity picker [S15]. Known bug: client cert not used for WebSockets
  [S15] (we use `fetch` streams, not WebSockets, so less relevant).
- **Home-screen PWA:** no primary source confirms that the standalone web-app process presents
  profile-installed client certs for navigations, service-worker fetches and SW updates
  [unverified]. Anecdotal reports of repeated cert prompts in Safari [S16]. Needs a spike on
  a real iPad before relying on it.
- Protects T1/T2 like a VPN (TLS handshake fails without cert) but 443 stays public and the
  TLS stack itself is still exposed.
- Effort: medium (own CA, `.p12` per device, `.mobileconfig`, renew). Cost 0.

### 1.6 Caddy `forward_auth` + Authelia (passkeys)

- `forward_auth` proxies each request to an auth gateway; Authelia is the documented example [S17].
  Authelia supports passwordless passkeys since v4.39 (may still ask for a password as 2nd
  factor unless an experimental option is set) [S18].
- Same PWA/session-expiry + SW caveats as Cloudflare Access (cookie session, redirects) [S12].
- Adds another internet-facing service with its own CVE history. Verdict: not worth it for one
  user when a VPN is available.

## 2. Application auth

- **Bearer token hardening** (keep as the second layer even behind a VPN):
  - ≥ 32 random bytes (`openssl rand -base64 32`) → brute force is infeasible; this makes
    rate limiting a DoS/log-noise concern, not a guessing concern.
  - Constant-time compare: already done (hash both sides then `timingSafeEqual`).
  - Rate limiting: none today. Caddy has no built-in rate limiter (needs the `caddy-ratelimit`
    plugin [unverified]); fail2ban/CrowdSec on Caddy 401 logs is the usual route. Moot if no
    public port.
  - Rotation: write a new `secrets/bearer_token`, restart backend, re-enter on 3 devices. Do it on
    device loss. A second, "list of tokens" format (one per device) would allow revoking one
    device — small change, optional.
  - Storage: `localStorage` is readable by any XSS; the strict CSP + DOMPurify is the defence.
    An `HttpOnly; Secure; SameSite=Strict` cookie would hide it from JS but adds CSRF surface
    and cookie-jar isolation quirks in the PWA [S11]. Not worth changing.
- **Passkeys instead of the token:** WebAuthn/passkeys are in Safari since iOS 16 [S19];
  whether the create/get ceremony works inside the standalone home-screen window has no primary
  source found [unverified] (widely reported to work). Would need a server-side
  challenge/credential store + session token — i.e. still a bearer/session secret on the
  device afterwards. Gain for one user behind a VPN: small (phishing resistance, no copy-paste
  token). Defer.

## 3. GitHub credential scope

What an attacker with the server's token can do: read every repo it covers (the whole life-wiki
history), push arbitrary commits, **force-push / delete branches** (rewriting history) unless
blocked. Blocking force pushes on private repos needs rulesets/branch protection, which the
fetched docs list for paid plans [S20] (GitHub Pro for personal accounts [unverified]).
Obsidian clones elsewhere are an implicit backup against history rewrite.

| Option | Scope | Lifetime | Fits current code? | Notes |
|---|---|---|---|---|
| Classic PAT `repo` | **all** repos of the account, broad | optional expiry | yes | avoid |
| **Fine-grained PAT** | selected repos only [S21]; *Contents: read & write* (+ mandatory *Metadata: read* [unverified]) | expiry configurable; "infinite lifetimes are allowed" unless org policy blocks [S21] | yes (HTTPS `x-access-token` header) | max 50 tokens per user [S21]. Set 90–365 d expiry, add each new vault repo to the token. |
| Deploy key per repo | exactly one repo, read-only by default, write optional; key can't be reused across repos [S22] | **no expiry**, usually no passphrase [S22] | no (needs SSH remote + key per vault) | narrowest blast radius per key, but all keys sit on the same server anyway |
| GitHub App installation token | selected repos + permissions, token "will expire after 1 hour" [S23] | 1 h | no (JWT from app private key → token minting) | the **app private key** on the server is long-lived, so a server compromise = same power; only helps against a leaked short token |

Verdict: **fine-grained PAT, selected repos, Contents RW only, expiry ≤ 1 year** is the right
baseline (no code change). Deploy keys / App only matter if the token might leak without the
whole server being compromised — unlikely here.

## 4. Data at rest

Threats: provider staff, disk/snapshot/backup leaks, decommissioned disks, a seized or
subpoenaed server, a stolen VPS image.

### 4.1 Provider encryption

- Hetzner TOM: "Encryption of Data (at rest) — Client's responsibility"; staff "do not access
  stored customer data" except with approval; deleted server images are purged within ~48 h [S24].
  Cloud Volumes are network block storage replicated across three servers [S25].
- IONOS / Oracle: not checked in primary docs [unverified]. Assume: no guaranteed
  customer-visible at-rest encryption for VPS disks on budget tiers.

### 4.2 Own encryption options

| Option | What it protects | Boot / unlock | Tradeoff |
|---|---|---|---|
| LUKS on a separate data volume (`/vaults`, `config`, `opencode-data`) | disk images, snapshots, volume detach, decommissioned disks | manual: after reboot, SSH in (over tailnet) and `cryptsetup open` → start compose; key only in RAM | app is down after every reboot (incl. unattended kernel updates) until you unlock |
| LUKS root + dropbear-initramfs | whole disk incl. logs, swap, Docker layers | SSH into the initramfs to type the passphrase [S26] | more setup; initramfs SSH is public unless provider firewall restricts it; provider web console is the fallback [unverified] |
| Clevis + Tang | same as LUKS | auto-unlock when the Tang server is reachable [S27] | Tang must live elsewhere (e.g. home); if Tang is on the same provider it protects little |
| gocryptfs / fscrypt on the vaults dir | file contents in that dir | mount with passphrase after boot | per-file overhead; filenames/sizes partly visible [unverified]; Docker volumes need bind-mount to the plaintext view |

Honest limit: **no at-rest encryption protects against the hypervisor owner of a running VM** — the
key and plaintext are in guest RAM, which the host can read [unverified; inherent to VPS]. It
protects against offline copies (snapshots, backups, disk reuse, seizure of a powered-off box).

### 4.3 Legal / jurisdiction

- CLOUD Act (18 USC 2713): US providers must disclose data in their "possession, custody, or
  control, regardless of whether … located within or outside of the United States" [S28][S29].
  → Oracle Cloud (US) is subject regardless of region; Hetzner / IONOS (German) are not directly
  [unverified for any US subsidiaries].
- **But:** the vault content already lives on **GitHub (US, Microsoft)** and every chat turn is
  sent to a **US LLM provider**. An EU VPS reduces the number of US copies; it does not remove
  them. EU hosting is still the better default (GDPR, no CLOUD Act on the VPS itself).

## 5. Host hardening

- SSH: keys only, `PermitRootLogin no`, `PasswordAuthentication no` [unverified — standard sshd].
  Better: **no public SSH at all**, SSH over the tailnet (or Tailscale SSH, 5 hosts free [S1]);
  keep the provider's web console as break-glass.
- Updates: Ubuntu Server enables unattended security upgrades by default; automatic reboot is
  off by default (`Unattended-Upgrade::Automatic-Reboot "true"` to enable) [S30]. Conflicts
  with manual LUKS unlock → choose one (or reboot-notify only).
- Firewall: **Docker publishing ports bypasses ufw** — traffic is NATed "before it reaches the
  INPUT and OUTPUT chains that ufw uses" [S31]; custom filtering belongs in `DOCKER-USER` [S32].
  Mitigations: (a) provider firewall in front of the VM — Hetzner Cloud Firewalls are free and
  block all inbound when no rule is set [S33]; (b) bind Caddy to the Tailscale IP only
  (`ports: ["100.x.y.z:443:443"]`) and drop `80:80` (DNS-01 needs no port 80).
- Containers: already non-root (`user: 1000:1000`) for backend/opencode. Add `read_only: true`
  + tmpfs where possible, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`
  [unverified syntax details]. Rootless Docker runs daemon and containers without root [S34];
  extra setup, optional (proxy binds 443 → needs `net.ipv4.ip_unprivileged_port_start` or
  a high port [unverified]).
- Secrets: compose secrets are files under `/run/secrets/<name>`, only for services that list
  them; env vars are "often available to all processes" and leak in logs [S35]. **Gap:** provider
  keys are passed via `opencode.env` (env). Move to secrets if opencode can read keys from a file
  (opencode config supports `{file:...}` substitution [unverified]).
- fail2ban / CrowdSec: useful only for public ports (SSH, 443). With VPN-only exposure, skip.

## 6. Data in transit to LLM providers

Every chat turn ships vault excerpts to the provider — this is the largest *intended* data flow.

| Provider | Default retention | Training | ZDR |
|---|---|---|---|
| Anthropic API | inputs/outputs deleted within 30 days (exceptions: policy violations up to 2 y, legal) [S36] | not by default for commercial/API [S37] | by agreement [S36] |
| OpenAI API | abuse-monitoring logs up to 30 days [S38] | not by default since 2023 [S38] | approval via sales; some endpoints ineligible [S38] |
| OpenRouter | OpenRouter itself doesn't retain prompts unless you opt in to logging [S39] | per-provider; account filter to exclude training providers [S40] | account-level or per-request `"zdr": true` routes only to ZDR endpoints [S39] |

For a single user without an enterprise contract, **OpenRouter with ZDR enforced** is the only
self-service way to get zero retention; direct Anthropic/OpenAI means ~30-day retention.
Provider-agnostic design (opencode) keeps this a config choice.

## 7. Backups

- Committed vault content: already on GitHub + Obsidian devices. No extra backup.
- **Needs backup:** `config` volume (vault list), `opencode-data` (chat history/sessions),
  **uncommitted edits** in `/vaults/*` (human + AI changes live only there until commit — ADR 0001),
  `secrets/` (or re-creatable), Caddy data (re-creatable).
- restic encrypts client-side with AES-256-CTR + Poly1305-AES, key from password via scrypt [S41]
  → the target (Hetzner Storage Box, B2, S3) sees only ciphertext. Daily `restic backup` of the
  volumes (`/vaults` incl. `.git` for uncommitted state), `forget --prune` policy. Password kept
  offline (password manager), not only on the server.

## 8. Recommended layered setup

### Baseline (do this)

1. **EU VPS** (Hetzner). Provider firewall: **no inbound rules at all**.
2. **Tailscale** on server + iPad/iPhone/Mac, VPN On Demand on iOS; ACL: owner's devices →
   server `tcp:443` (+ `tcp:22`). Tailnet Lock on. Funnel off.
3. DNS `app.karpathy.app` → server's Tailscale IP; keep Caddy DNS-01 (already built). Bind the
   proxy to the Tailscale IP; remove `80:80`. Use a DNS API token scoped to the one zone.
4. Keep the **bearer token** (32 random bytes) as a second factor behind the VPN.
5. GitHub **fine-grained PAT**, selected vault repos only, Contents RW, expiry ≤ 1 year.
6. Host: SSH only via tailnet, keys only, no root login; unattended-upgrades on; containers
   non-root, `no-new-privileges`, `cap_drop: ALL`.
7. **restic** encrypted daily backup of config, opencode-data and vault clones.
8. LLM: OpenRouter with ZDR enforced, or Anthropic direct (30 d, no training) — conscious choice.

Resulting attack surface from the internet: **zero open ports**.

### Paranoid (add on top)

- **LUKS data volume** for all three volumes, unlocked manually over the tailnet after each
  reboot; auto-reboot off, reboot-needed notification instead.
- Provider keys moved from env to file secrets; `read_only: true` containers.
- Per-device bearer tokens (revoke one lost iPad without re-keying the others).
- GitHub paid plan for a ruleset blocking force-push/deletion on the vault branches.
- Separate spend-capped provider keys per use; rotate GitHub + provider keys on a schedule.
- Optional mTLS on top of Tailscale only after an iPad spike proves it works in the
  standalone PWA — likely not worth it once the VPN is in place.

## 9. Option overview

| Option | Protects against | iOS PWA works? | Effort | Cost |
|---|---|---|---|---|
| Public 443 + bearer token (today) | token guessing | yes | none | 0 |
| **Tailscale (no Funnel)** | internet scanning, pre-auth exploits, stolen-token use off-tailnet, DoS | **yes** (normal HTTPS; one on-demand VPN limit) [S3] | low | 0 (≤ 6 users) [S1] |
| + Tailnet Lock | malicious/compromised Tailscale coordinator | yes | low | 0 [S6] |
| WireGuard self-managed | same as Tailscale, no third party | yes [unverified] | medium | 0 |
| Headscale | removes Tailscale Inc. from trust | yes [unverified] | medium-high | 0 |
| Cloudflare Tunnel + Access | open ports, unauthenticated access | partly — SW/session-expiry redirect issues [S12][S13] | medium | 0 (≤ 50 users) [S8] |
| mTLS client certs | unauthenticated access (TLS level) | **[unverified]** in standalone mode; spike needed | medium | 0 |
| Caddy forward_auth + Authelia passkeys | unauthenticated access, phishing | partly (same cookie/SW caveats) [unverified] | medium-high | 0 |
| Passkeys in-app | phishing, token copy/paste | likely [unverified] | medium (code) | 0 |
| Fine-grained PAT (selected repos) | token misuse on other repos | n/a | low | 0 |
| Deploy keys / GitHub App | leaked token outliving/overreaching | n/a | medium (code) | 0 |
| LUKS data volume (manual unlock) | snapshots, disk reuse, offline seizure | n/a (downtime after reboot) | medium | 0 |
| Provider firewall + bind to tailnet IP | Docker-bypasses-ufw exposure | n/a | low | 0 (Hetzner) [S33] |
| restic encrypted backups | loss of uncommitted edits/chats; leaky backup target | n/a | low | storage (few €/mo) [unverified] |
| OpenRouter ZDR | provider-side retention of vault excerpts | n/a | low (config) | provider pricing |

## 10. Sources (all fetched 2026-09-28)

- [S1] Tailscale pricing — https://tailscale.com/pricing
- [S2] Tailscale firewall ports — https://tailscale.com/kb/1082/firewall-ports
- [S3] Tailscale iOS VPN On Demand — https://tailscale.com/kb/1291/ios-vpn-on-demand
- [S4] Tailscale HTTPS certificates — https://tailscale.com/kb/1153/enabling-https
- [S5] Tailscale Funnel — https://tailscale.com/kb/1223/funnel
- [S6] Tailscale Tailnet Lock — https://tailscale.com/kb/1226/tailnet-lock
- [S7] Headscale README — https://github.com/juanfont/headscale
- [S8] Cloudflare blog, Zero Trust for everyone (free up to 50 users) — https://blog.cloudflare.com/teams-plans/
- [S9] Cloudflare Tunnel — https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- [S10] Cloudflare Access authorization cookie — https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/
- [S11] WebKit bug 181849, home-screen apps don't share storage with Safari — https://bugs.webkit.org/show_bug.cgi?id=181849
- [S12] Node-RED forum, PWA SW prevents Access redirect on expiry — https://discourse.nodered.org/t/dashboard-2-0-pwa-service-worker-prevents-authentication-redirect-when-session-expires/100574
- [S13] Cloudflare Community, PWA behind Access — https://community.cloudflare.com/t/pwa-application-behind-cloudflare-access/122050
- [S14] Caddy `tls` directive (`client_auth`) — https://caddyserver.com/docs/caddyfile/directives/tls
- [S15] Client certificate handling on iOS (M. Eidinger) — https://blog.eidinger.info/client-certificate-handling-on-ios ; Home Assistant iOS issue #27 — https://github.com/home-assistant/iOS/issues/27
- [S16] Apple Discussions, Safari keeps asking for client cert — https://discussions.apple.com/thread/253222560
- [S17] Caddy `forward_auth` — https://caddyserver.com/docs/caddyfile/directives/forward_auth
- [S18] Authelia passkeys — https://www.authelia.com/overview/authentication/security-key/
- [S19] passkeys.dev, iOS & iPadOS — https://passkeys.dev/docs/reference/ios/
- [S20] GitHub rulesets — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- [S21] GitHub personal access tokens — https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- [S22] GitHub deploy keys — https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys
- [S23] GitHub App installation tokens — https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- [S24] Hetzner Technical and Organizational Measures — https://docs.hetzner.com/general/others/technical-and-organizational-measures
- [S25] Hetzner Volumes — https://docs.hetzner.com/cloud/volumes/
- [S26] Debian `dropbear-initramfs` — https://packages.debian.org/stable/dropbear-initramfs
- [S27] Clevis — https://github.com/latchset/clevis
- [S28] 18 USC 2713 — https://www.law.cornell.edu/uscode/text/18/2713
- [S29] US DoJ CLOUD Act resources — https://www.justice.gov/criminal/cloud-act-resources
- [S30] Ubuntu Server automatic updates — https://ubuntu.com/server/docs/how-to/software/automatic-updates/
- [S31] Docker packet filtering and firewalls — https://docs.docker.com/engine/network/packet-filtering-firewalls/
- [S32] Docker with iptables (`DOCKER-USER`) — https://docs.docker.com/engine/network/firewall-iptables/
- [S33] Hetzner Cloud Firewalls — https://docs.hetzner.com/cloud/firewalls/overview/
- [S34] Docker rootless mode — https://docs.docker.com/engine/security/rootless/
- [S35] Docker Compose secrets — https://docs.docker.com/compose/how-tos/use-secrets/
- [S36] Anthropic data retention — https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- [S37] Anthropic training on commercial data — https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training
- [S38] OpenAI API "your data" — https://developers.openai.com/api/docs/guides/your-data
- [S39] OpenRouter ZDR — https://openrouter.ai/docs/guides/features/zdr
- [S40] OpenRouter privacy & logging — https://openrouter.ai/docs/features/privacy-and-logging
- [S41] restic design/references — https://restic.readthedocs.io/en/stable/100_references.html
