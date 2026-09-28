# Decisions & assumptions — autonomous run (2026-09-28)

Task: `/autonomous` + `/implement spec #05` ([`prod_env.md`](prod_env.md)).

## Outcome

[`prod-env-report.html`](prod-env-report.html). Verdict: **Hetzner CX23 (≈ €10/mo incl. VAT with
backups + vault volume) behind Tailscale (zero open ports), disk check before each vault clone.**
Oracle Always Free is the only real free tier that fits, but idle reclamation makes it a staging
option, not prod. Backed by 4 desk-research notes (`notes-*.md`, primary sources, fetched
2026-09-28), 6 spikes in `spikes/`, 2 diagrams in `docs/diagrams/prod-env-*`.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Deliverable is a **research report** + desk notes + spikes, no app code. | Spec: "research project only, we don't build it yet!!!". `/implement`'s TDD step has no seam here. |
| D2 | HTML in the default layout from `CLAUDE.md`, CSS copied from the browser-only report. | Repo convention. |
| D3 | "Test forever with Playwright" reduced to: verify the report (desktop light, phone 390 px dark, top + bottom, tables, figures at 1×) + spikes against the real prod images. No app regression run. | No app code changed; an app e2e run proves nothing about this change. |
| D4 | Sizing from the measured prod-image footprint (spike `footprint.sh`), using cgroup `anon` memory. | `docker stats` showed the backend at 1.9 GB, but 4.6 GB of that cgroup was reclaimable page cache from the clone; anon was 96 MB. |
| D5 | Research split into 4 parallel agents (EU hosters, global hosters, security, disk); I ran the footprint spike and wrote the report. | Independent topics. |
| D6 | Recommend **CX23 (x86)** over CAX11 (ARM). | €0.50 cheaper, no multi-arch build needed; ARM works too (verified: stack runs on arm64 here, opencode image is multi-arch). |
| D7 | Recommend **Tailscale** as the network layer, not Cloudflare Access / mTLS. | Keeps the MVP's "behind a VPN" property on a rented VPS; PWA unaffected; Cloudflare terminates TLS (sees notes) and has PWA session-expiry issues; mTLS in the standalone PWA is unverified. |
| D8 | Keep Caddy DNS-01 + DNS record pointing at the Tailscale IP. | Already built; public-CA cert, no profile on iOS; no open port needed. |
| D9 | Disk: pre-add estimate `2 × tree bytes + 1 MiB`, reserve max(2 GiB, 10 %), 5 GiB per-vault cap, `ulimit -f` during clone, `/vaults` on its own FS. | Spike numbers (estimate within ~1 %, ulimit stop verified). Values are defaults to discuss, not requirements. |
| D10 | Verified the "github.com has no IPv6" claim myself (`dig AAAA` empty) before stating it. | Agent had it as [unverified]; it drives the "IPv4 required" line item. |
| D11 | Add-vault diagram simplified to one decision node. | The detailed version was unreadable at 1× (checked in Playwright). |
| D12 | README links the report. | User-visible doc. |
| D13 | (Follow-up, on request) Report §4.1 "Oracle as a €0 prod": 4 GB shape so memory stays above 20 %, plus a `Nice=19` stress-ng timer, 1 h every 6 h, as a CPU safety net. On the VM, not a GitHub Action. | Oracle reclaims only if CPU, network and memory are all below 20 %. 1 h per 6 h keeps the CPU 95th percentile above 20 % even if Oracle samples hourly averages. A GitHub Action would need a Tailscale key in GitHub, and GitHub turns off schedules in public repos after 60 days without activity. Timer syntax, stress-ng flags and `systemd-analyze verify` were checked in an Ubuntu 24.04 arm64 container. Not verified: how Oracle's memory metric counts page cache, and whether gaming the rule breaks Oracle's terms. |
| D14 | **User decision (2026-09-28): Hetzner CX23** is prod. | Asked "why not IONOS/OVH, they're ~€5?", then chose Hetzner. IONOS S+ is €5 but has only 2 GB (M+ with 4 GB is €12). OVH is really cheaper; see D15. |
| D15 | Correction: OVH "VPS-1 €4.53, backup included" was wrong. Verified from OVH's public order catalog API (`eu.api.ovh.com/1.0/order/catalog/public/vps?ovhSubsidiary=DE`, plan `vps-2027-model1`): 2 vCore / 4 GB / 40 GB, no setup fee, €5.34 incl. VAT monthly (€5.07 on 6 months, €4.53 on 12), plus a **required** daily-backup add-on at €0.42. | The product page shows only the 12-month price and "backup". OVH stays in the report as the cheapest alternative (€5.76 vs €8.44 with backups). |
| D16 | Report §8 "Guide: book, install and set up Hetzner", for today's repo with no code changes: Cloudflare DNS (the proxy image is built with that module; a token can be limited to one zone); a temporary SSH firewall rule until Tailscale is up, then no inbound rules at all; a server-only `deploy/compose.hetzner.yml` that publishes 443 on the tailnet IP only, drops port 80, rotates logs and bind-mounts `vaults` to `/srv/vaults`; a Docker drop-in that starts Docker after Tailscale; images built on the server. | The override was validated with `docker compose config` against `compose.yml`, and the hcloud flags against hetznercloud/cli docs. `DNS_PROVIDER` is a build arg the compose file doesn't pass, so Hetzner DNS would need `build.args`. The Hetzner DNS token controls the whole project, so it would need its own project. |
| D17 | `/vaults` on a **20 GB loop-mounted ext4 file on the server disk** instead of a Hetzner Volume. | Keeps the fixed-size filesystem from the disk research, costs nothing, and Hetzner server backups include it. They don't include Volumes, which would make restic mandatory. Total drops to €8.44 incl. VAT. |
## Assumptions / open for the user

- Guide not run end to end against a real Hetzner account (no account or credentials here). The risky
  steps were checked offline: the compose override, the hcloud flags and the systemd syntax. Not checked:
  whether Hetzner's Ubuntu image gives the first added user uid 1000 (the guide checks it and has a
  fallback), and the exact Caddy log wording when it gets the certificate.

- Prices are from vendor pages on 2026-09-28; Hetzner changed prices twice in 2026. Hetzner volume price
  (≈ €0.057/GB) is from a third-party list.
- The opencode memory growth (1 GB after 2 h / 14 vaults in dev) is one observation, not a
  soak test.
- Not tested on a real iPad: Tailscale On Demand + installed PWA (expected to work; it's plain HTTPS),
  mTLS in standalone mode (unknown).
- Decisions for you are listed in the report §7 (Hetzner vs Oracle, Tailscale mandatory, paranoid
  extras, default for media-heavy vaults).

## Noticed, not changed

- `deploy/compose.yml` publishes `80:80` although DNS-01 needs no port 80; no log rotation;
  provider keys via env (`opencode.env`) not secrets. Listed as work item 1 in the report.
- A mis-parse in my first spike runs (waiting on `cloned` instead of `state: ready`, `id` instead
  of `chatId`) was fixed; only the final run's output is kept in `spikes/footprint.out.txt`.

## Review (`/spec-review`, two axes) — fixed

- Spec: sparse cone on the root was marked "OK" but spike 01 F shows `add -A` failing → now
  "partial, needs `git add --sparse`"; "all but video" passed in the spike → now "all OK, media
  hidden". `ulimit -f` is per file, not total → report now says so and adds timeout / `du` watchdog.
  Chat-turn RAM used a page-cache sample → anon 480 MB. Hetzner vs IONOS compared net with gross →
  both incl. VAT. GitHub-for-static got only one line → short paragraph on a Pages + VPS split.
- Standards: Hetzner price moves wording aligned with the notes; Caddy memory column labelled as
  `docker stats`; build-cache figure marked as shared by all projects on this Mac; statfs 0.02 ms;
  `footprint.sh` header documents `KEEP=1` and the ready-wait now has a timeout; 02's `du` label.
- Not changed (judgement calls): white figure background in dark mode (same as the reference
  report), duplicated helpers in throwaway spike scripts, vendor terms like "MwSt" in the EU notes,
  and the next-steps table (kept, as a plan if you go ahead — nothing was built).
