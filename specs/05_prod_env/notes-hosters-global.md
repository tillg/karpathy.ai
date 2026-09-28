# Hosting notes: global / non-European providers

Desk research, fetched **2026-09-28** (all URLs below fetched that day unless marked otherwise).
Primary sources only (vendor pricing pages, docs, terms, vendor APIs). Anything not confirmed on a
primary source is marked **[unverified]**. Prices in USD, excl. VAT. "Month" = 730 h unless the
vendor defines it otherwise.

## Workload recap (what we must fit)

- docker compose, 3 always-on containers: Caddy (80/443, auto-TLS), Node/Express backend (git CLI,
  ripgrep, file watcher), `opencode serve` (outbound HTTPS to LLM APIs).
- **Backend and opencode share one persistent volume** (vault clones). 5–20 GB disk.
- Always-on; NDJSON streams that stay open for minutes; outbound HTTPS; ~1–2 GB RAM (to be
  measured); no GPU.

Two consequences that decide most of this document:

1. **PaaS volumes attach to exactly one service/machine** (Render, Railway, Fly, Koyeb — sources in
   each section). The shared volume therefore forces us to either merge backend + opencode into a
   single container image (process supervisor) on a PaaS, or use a plain **VM** where compose runs
   unchanged. On PaaS, Caddy is also redundant (platform terminates TLS).
2. Anything that **sleeps / scales to zero / has an ephemeral disk / caps request duration** is out.

---

## 1. Oracle Cloud (OCI) Always Free

Sources: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>,
<https://www.oracle.com/cloud/free/>, <https://www.oracle.com/cloud/free/faq/>

**Important correction to the brief:** the docs page now says the Ampere A1 allowance is
**"the first 1,500 OCPU hours and 9,000 GB hours per month … For Always Free tenancies, this is
equivalent to 2 OCPUs and 12 GB of memory"** — i.e. **2 OCPU / 12 GB**, not the widely quoted
4 OCPU / 24 GB (which was 3,000 OCPU-h / 18,000 GB-h). "You can create one or two OCI Ampere A1
Compute instances, 2 OCPUs total."

| Item | Always Free limit (verbatim/primary) |
|---|---|
| Arm A1 (VM.Standard.A1.Flex) | 1,500 OCPU-h + 9,000 GB-h / month = 2 OCPU, 12 GB RAM, 1–2 instances |
| AMD micro (VM.Standard.E2.1.Micro) | up to 2 instances, 1/8 OCPU, 1 GB RAM, "up to 50 Mbps" internet bandwidth |
| Block storage | 200 GB total (boot + block), min boot volume 47 GB, 5 backups; home region only |
| Egress | 10 TB / month |
| Trial | US$300 credit, 30 days; Always Free continues afterwards |
| Card | Required; "We do not accept debit cards with a PIN or virtual, single-use, or prepaid cards." |
| Regions | Free Tier "generally available in regions where commercial OCI is available"; you pick one **home region** at sign-up (EU regions such as Frankfurt/Amsterdam exist) — capacity per region varies |

**Can it run us?** Yes — it's a real VM; docker compose + a local volume run unchanged. 2 OCPU /
12 GB / ~150 GB usable disk is far more than we need. **arm64**: all images must be multi-arch
(Caddy and Node are; opencode arm64 image/binary **[unverified]** — check before committing).

**Caveats (primary):**
- **Idle reclamation:** "Idle Always Free compute instances may be reclaimed by Oracle … idle if,
  during a 7-day period, the following are true: CPU utilization for the 95th percentile is less
  than 20%; Network utilization is less than 20%; Memory utilization is less than 20% (applies to A1
  shapes only)." A single-user app will be idle most of the week → real risk. (A 12 GB VM with our
  measured ~1 GB footprint (prod-env-report.html §1) sits far below the 20 % memory line.)
- **Capacity:** "An 'out of host capacity' error indicates a temporary lack of Always Free shapes in
  your home region … it might take several days before additional capacity is available."
- **Abandoned accounts:** "Accounts left idle for 30 days or more may be deemed abandoned and become
  eligible for suspension or termination." One free account per person.
- **No support / no SLA:** "Oracle Cloud Free Tier does not include SLAs … Customers using only
  Always Free resources are not eligible for Oracle Support."
- **End of trial:** if more A1 than the free limit is provisioned when the trial ends, "all existing
  Ampere A1 instances are disabled and then deleted after 30 days unless you upgrade."

**PAYG upgrade trick:** Oracle states you can "upgrade your account to Pay as You Go … Oracle
doesn't charge for Always Free resources after you upgrade, and will only charge you for resource
usage above the Always Free limits", and "Pay As You Go accounts are subject to different capacity
limits than Always Free accounts." Community claims that PAYG accounts (a) get A1 capacity much more
easily and (b) are **exempt from idle reclamation** — (b) is **[unverified]**: the docs text does not
state an exemption. Set a budget alert if you upgrade.

**Account-termination stories** (sudden tenancy termination without explanation, mostly free-only
accounts) are widespread on forums/Reddit — **[unverified]**, no primary source. Mitigation: keep
everything reproducible (compose + git remote = vault is already backed up on GitHub).

---

## 2. Google Cloud free tier

Source: <https://docs.cloud.google.com/free/docs/free-cloud-features>,
<https://docs.cloud.google.com/compute/docs/general-purpose-machines>

- **1 non-preemptible e2-micro** per month, **US only**: `us-west1`, `us-central1`, `us-east1`.
- e2-micro = "2 vCPUs, each for 12.5% of CPU time totaling 25% CPU time" (fractional 0.25 vCPU),
  bursts ~30 s at 100 %; **1 GB RAM**.
- **30 GB-months standard persistent disk.**
- **1 GB egress / month** from North America (excl. China/Australia).
- $300 trial credit, 90 days; "you must provide a credit card or other payment method".
- External IPv4 cost on the free VM: **[unverified]** (not stated on the free-tier page).

**Fit:** VM, so compose works — but **1 GB RAM and 0.25 vCPU** is below our 1–2 GB estimate
(opencode + Node + ripgrep over a 1.2 GB tree), 30 GB disk is tight for 5–20 GB of vaults plus
images, US-only, and 1 GB egress is small. Usable as a toy/staging box only.

---

## 3. IBM Cloud

Source: <https://www.ibm.com/cloud/free>, <https://cloud.ibm.com/docs/codeengine?topic=codeengine-pricing>

- Lite plans (40+ products) "never expire", but "service instances are deleted after 30 days of
  inactivity".
- US$200 credit, **30 days**, new PAYG accounts; card required (≈$1 verification hold).
- Code Engine has "a free tier" and scales to zero; exact free allowance not on the fetched page
  **[unverified]**; persistent volumes for Code Engine apps **[unverified]**.
- No always-free general-purpose VM found (a "Hyper Protect Virtual Server" 1 vCPU free listing
  exists; terms **[unverified]**).

**Fit:** no always-free VM with persistent disk → ruled out.

---

## 4. Fly.io

Sources: <https://docs.fly.io/about/pricing/>, <https://docs.fly.io/about/free-trial/>,
<https://docs.fly.io/volumes/overview/>

- **Free trial only:** "2 hours of machine runtime or 7 days of access, whichever comes first";
  trial machines "automatically stop after 5 minutes of runtime"; max 20 GB volume. Adding a card
  ends the trial. Old free allowances are listed as discontinued plans.
- **Pricing formula** (from the page's own calculator code): shared vCPU $0.00000075/s, RAM beyond
  the included 0.25 GB/vCPU $0.00000193/GB-s, month = 2,592,000 s, region markup
  (ams ×1.038, fra ×1.154, iad ×1.0). Computed:

  | shared-cpu-1x | iad | ams | fra |
  |---|---|---|---|
  | 1 GB | $5.70 | $5.92 | $6.58 |
  | 2 GB | $10.70 | $11.11 | $12.35 |

  (The rendered page's text was not machine-readable; numbers above are my calculation from the
  page's published constants.)
- Volumes $0.15/GB-month; dedicated IPv4 $2/month; egress $0.02/GB (NA/EU).
- **Volume constraints:** "A volume can attach to one Machine … A Machine can only mount one volume
  at a time"; "Fly.io does not automatically replicate data"; docs recommend ≥2 volumes per app;
  max 500 GB; extend-only.
- **No docker compose.** Must ship backend + opencode as one image (multiple processes) on one
  Machine with one volume. Caddy not needed.

**Cheapest fit:** shared-cpu-1x 2 GB in ams + 20 GB volume ≈ $11.11 + $3.00 (+ $2 IPv4 optional)
≈ **$14–16/month**. EU: yes (ams, fra, lhr, …).

---

## 5. Render

Sources: <https://render.com/docs/free>, <https://render.com/pricing>, <https://render.com/docs/disks>

- **Free web service:** spins down "after 15 minutes without receiving any inbound traffic", ~1 min
  cold start; 750 instance-hours/month per workspace; **"Free web services cannot" use persistent
  disks**; "Render might restart a Free web service at any time"; 512 MB / 0.1 CPU.
- Paid instances: Starter $7 (512 MB, 0.5 CPU), **Standard $25 (2 GB, 1 CPU)**, Pro $85 (4 GB, 2 CPU).
- Persistent disk **$0.25/GB-month**; Hobby workspace $0 + compute, bandwidth "5 GB included per
  month then $0.15 per GB".
- Disk constraints: "accessible by only a single service instance"; no scaling; "Adding a disk to a
  service prevents zero-downtime deploys".
- docker compose: not supported as such (Docker images per service; `render.yaml` blueprints)
  **[unverified re compose]**. Regions incl. Frankfurt **[unverified]** (not on fetched pages).

**Cheapest fit:** Standard 2 GB + 20 GB disk ≈ **$30/month**, single merged container.

---

## 6. Railway

Sources: <https://railway.com/pricing>, <https://docs.railway.com/reference/pricing/plans>,
<https://docs.railway.com/reference/volumes>, <https://docs.railway.com/guides/dockerfiles>

- **Trial:** "$5 one-time credit (30 days)", no card. Free plan afterwards: "$1 of free credit per
  month", 0.5 GB RAM, 0.5 GB volume.
- Hobby $5/month incl. $5 usage; Pro $20/month incl. $20 usage.
- Usage: $20/vCPU-month, $10/GB-RAM-month, volumes $0.15/GB-month, egress $0.05/GB.
- Volumes: "Each service can only have a single volume" — **cannot be shared across services**;
  no replicas; redeploy causes downtime. **Max size: Free/Trial 0.5 GB, Hobby 5 GB, Pro 50 GB.**
- **Compose import exists:** "drag and drop your Compose file onto your project canvas" — but the
  shared volume still won't map (one volume per service).
- Regions: EU (Amsterdam) **[unverified]** — not on fetched pages.

**Cheapest fit:** Hobby's 5 GB volume cap is too small for 5–20 GB → **Pro**. 2 GB RAM ($20) +
~0.1–0.25 vCPU average ($2–5) + 20 GB ($3) ≈ $25–28 usage, covered partly by the $20 included →
≈ **$25–30/month**.

---

## 7. Koyeb

Sources: <https://www.koyeb.com/docs/reference/instances>, <https://www.koyeb.com/docs/reference/volumes>,
<https://www.koyeb.com/pricing>

- **Free instance:** "512MB of RAM, 0.1 vCPU, and 2GB of SSD"; "scales down to zero when [it] doesn't
  receive any traffic for 1 hour"; Frankfurt or Washington only; **no volumes on Free**.
- Standard: small 1 vCPU / 1 GB $0.0144/h (≈ $10.51/month); medium 2 vCPU / 2 GB $0.0288/h
  (≈ $21.02/month). Eco instances are cheaper but **cannot take volumes**.
- Volumes: "must be between 1 and 10 Gigabytes"; only `was` and `fra`; only standard/GPU services;
  scale of one; **public preview** ("back up any data that you cannot afford to lose"); cannot be
  re-attached to another service. Volume price **[unverified]** (not on fetched pages).

**Cheapest fit:** standard medium + ≤10 GB volume ≈ **$21+/month**, single merged container; the
10 GB cap is below our upper estimate. EU: Frankfurt.

---

## 8. Northflank

Sources: <https://northflank.com/pricing>, <https://northflank.com/docs/v1/application/billing/pricing-on-northflank>

- **Developer Sandbox (free):** 2 services, 1 database/addon, 2 cron jobs, "Always-on compute (no
  auto-sleep)", up to 1 BYOC cluster. **Contradiction:** pricing page says "No credit card
  required"; docs say "all users must add a payment method to start creating resources". Sandbox
  compute size and whether volumes are allowed on it: **[unverified]**.
- Paid: nf-compute-100-1 (1 vCPU, 1 GB) $18/month; **nf-compute-100-2 (1 vCPU, 2 GB) $24/month**;
  base $0.01667/vCPU-h, $0.00833/GB-h.
- Volumes $0.15/GB-month; egress $0.06/GB. Regions include **EU West**.
- BYOC: can deploy into your own cloud account for a flat fee.

**Cheapest fit:** ≈ **$24 + $3 (20 GB) ≈ $27/month**. The free sandbox is the most interesting
free PaaS (no sleep), but its RAM/volume limits must be checked in the dashboard.

---

## 9. Cloudflare (Workers, Containers, Tunnel)

Sources: <https://developers.cloudflare.com/workers/platform/limits/>,
<https://developers.cloudflare.com/containers/pricing/>,
<https://developers.cloudflare.com/containers/platform-details/architecture/>,
<https://developers.cloudflare.com/containers/platform-details/limits/>,
<https://developers.cloudflare.com/fundamentals/reference/connection-limits/>,
<https://blog.cloudflare.com/tunnel-for-everyone/>,
<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/>

- **Workers:** 128 MB per isolate; CPU 10 ms (Free) / up to 5 min (Paid) per request; no
  subprocesses (git/ripgrep) — cannot run our backend.
- **Containers:** need Workers Paid ($5/month; incl. 25 GiB-h memory, 375 vCPU-min, 200 GB-h disk,
  1 TB egress). Instance types lite (1/16 vCPU, 256 MiB, 2 GB) … standard-4 (4 vCPU, 12 GiB,
  20 GB). **"All disk is ephemeral. When a Container instance goes to sleep, the next time it is
  started, it will have a fresh disk"**; default `sleepAfter` 10 min. Persistence only via FUSE to
  R2 ("performance won't match native SSD"); snapshots "coming soon". → Not a fit for git clones.
- **Tunnel:** free on all plans (Cloudflare blog "Free Tunnels for Everyone"); `cloudflared` makes
  "outbound-only connections", so a VM needs no open inbound ports / public IP. Useful in front of
  any VM here (e.g. Oracle).
  - Streaming gotcha: proxied traffic has a **Proxy Read Timeout of 125 s** (only configurable for
    Enterprise) and a 900 s proxy idle timeout. Exact semantics for long NDJSON streams with gaps
    **[unverified]** → emit heartbeat lines well under 100 s.
  - Quick Tunnels (trycloudflare) "do not support Server-Sent Events" and cap 200 in-flight
    requests — use a named tunnel instead.
  - With Tunnel, Caddy's ACME/TLS becomes redundant (Cloudflare terminates TLS).

---

## 10. DigitalOcean

Sources: <https://www.digitalocean.com/pricing/droplets>, <https://www.digitalocean.com/pricing/volumes>,
<https://www.digitalocean.com/community/questions/signup-and-get-200-in-credit-for-your-first-60-days-cffec92b-5b4a-44ba-88df-4e0c8ccee7ea>

| Basic Droplet | vCPU | RAM | SSD | Transfer | $/month |
|---|---|---|---|---|---|
| | 1 | 512 MiB | 10 GB | 500 GB | 4 |
| | 1 | 1 GB | 25 GB | 1,000 GB | 6 |
| **fit** | 1 | 2 GB | 50 GB | 2,000 GB | **12** |
| | 2 | 2 GB | 60 GB | 3,000 GB | 18 |

- Block storage volumes from 100 GiB for $10/month. Per-second billing since 2026-01-01 (60 s min).
- Regions incl. **Amsterdam, Frankfurt, London**.
- No always-free tier. New-user credit: DO community page states **$200 / 60 days, card required**
  (vendor site, but not the pricing page); volumes FAQ mentions a "$5 credit for 90 days" variant.
- VM → compose runs unchanged. **Fit: $12/month** (2 GB, 50 GB disk covers vaults + images).

---

## 11. Vultr

Sources: public plans API <https://api.vultr.com/v2/plans?type=vc2> and `?type=vhp` (unauthenticated,
queried 2026-09-28); <https://www.vultr.com/free-tier-program/> (403 to fetcher; content via
vendor search snippet → **[unverified]** details).

| Plan id | vCPU | RAM | SSD | Transfer | $/month | FRA |
|---|---|---|---|---|---|---|
| vc2-1c-0.5gb-free | 1 | 512 MB | 10 GB | – | **0** | yes |
| vc2-1c-1gb | 1 | 1 GB | 25 GB | 1 TB | 5 | yes |
| **vc2-1c-2gb** | 1 | 2 GB | 55 GB | 2 TB | **10** | yes |
| vc2-2c-2gb | 2 | 2 GB | 65 GB | 3 TB | 15 | yes |
| vhp-1c-2gb-amd (high perf.) | 1 | 2 GB | 50 GB | 3 TB | 12 | yes |

- Free Tier: 1 vCPU / 512 MB / 10 GB, application-based, limited quantity, weighted random admission
  **[unverified details]** — 512 MB is too small anyway.
- Account-wide 2 TB free egress pooling **[unverified]** (blog, not fetched).
- **Fit: vc2-1c-2gb $10/month in Frankfurt** — cheapest mainstream VM that fits.

---

## 12. Akamai Cloud (Linode)

Source: <https://www.akamai.com/cloud/pricing/europe> (linode.com/pricing redirects there)

- Nanode 1 GB: $5 (1 vCPU, 25 GB, 1 TB). **Linode 2 GB: $12 (1 vCPU, 50 GB, 2 TB).** Linode 4 GB:
  $24 (2 vCPU, 80 GB, 4 TB). Overage egress $0.005/GB.
- New accounts: "US$100 in credits" (duration **[unverified]**, commonly 60 days).
- Block storage price: page extraction showed "$0.01/GB" — looks wrong, **[unverified]**.
- EU regions: yes (Europe price list). VM → compose unchanged. **Fit: $12/month.**

---

## 13. Heroku

Sources: <https://www.heroku.com/pricing>, <https://devcenter.heroku.com/articles/dynos>,
<https://devcenter.heroku.com/articles/dyno-restarts>

- No free tier. Eco $5 (0.5 GB, "Sleeps after 30 minutes of inactivity"); Basic $7 (0.5 GB, always on).
- "Any files written get discarded the moment the dyno stops or restarts"; dynos restart "once every
  24 hours (plus up to 216 random minutes)". No persistent volumes, no compose.
- → **Ruled out** (ephemeral FS kills git clones).

## 14. Zeabur

Source: <https://zeabur.com/pricing>, <https://zeabur.com/docs/en-US/billing/pricing>

- Free $0 (1 "manageable server", 48 h logs); Developer $5/month after 14 days free (3 servers);
  Pro $19; Team $79.
- The model is increasingly a **control plane for servers "you purchased and own elsewhere"**;
  shared-cluster resource prices, volumes and regions not on fetched pages **[unverified]**.
- → Adds nothing over running compose on a VM ourselves.

## 15. Deno Deploy / Vercel — why not

- **Vercel** (<https://vercel.com/docs/functions/limitations>): functions; Hobby max duration
  **300 s** (Pro 800 s, 1800 s beta), 2 GB / 1 vCPU, 4.5 MB request/response body; no persistent
  disk, no long-running process (file watcher, opencode server). → No.
- **Deno Deploy** (<https://docs.deno.com/deploy/pricing_and_limits/>, <https://deno.com/deploy/pricing>):
  512 MB max memory, 1 GB deployment size; free 1M req, 10 h CPU, 150 GiB-h memory; idle apps
  "automatically shut down after ~20-30 seconds". No docker, no persistent disk. → No.

## 16. GitHub Codespaces — why not

Sources: <https://docs.github.com/en/billing/concepts/product-billing/github-codespaces>,
<https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces>

- Free personal: 120 core-hours + 15 GB-month storage (Pro: 180 h / 20 GB). On a 2-core machine
  that is 60 h/month.
- Idle timeout default 30 min, "between 5 minutes and 240 minutes (4 hours)". → Dev environment,
  not an always-on host. **No.**

## 17. Alibaba Cloud / Tencent Cloud

- **Alibaba** (<https://www.alibabacloud.com/help/en/user-center/product-overview/learn-about-free-trials>):
  ECS free trial for **new compute users only**; verified phone + card required; after the trial,
  instances "will be stopped and locked … released after 15 days". Specs per vendor search snippet
  of alibabacloud.com/free: individual 1 vCPU/1 GB for 12 months or 2 vCPU/2 GB for 3 months
  **[unverified]**. Frankfurt/London regions exist **[unverified]**.
- **Tencent Cloud** Lighthouse free trial: not verified (fetches 404) **[unverified]**.
- Both are time-limited trials, not always-free; data-jurisdiction concerns (China-HQ vendors)
  make them a poor fit for a private knowledge vault. → Not pursued.

## 18. RackNerd / LowEndBox-style VPS

Source: <https://racknerd.com/kvm-vps>

- Listed: $26.99/**year** — 512 MB, 1 vCore, 30 GB, 500 GB; monthly from $17.99 (1 GB, 2 vCore,
  50 GB, 1 TB). Locations incl. **Amsterdam, France, Dublin**.
- The famous deals (e.g. 2–3 GB RAM for ~$20–30/year) are seasonal LowEndBox promos
  **[unverified]**, not on the standard product page.
- Gotchas: small providers, oversold hosts, minimal support, no managed snapshots guaranteed
  **[unverified]**. Fine as a cheap VM if backups are external (vaults already live on GitHub).

## 19. Student / startup credit programs (brief)

- **GitHub Student Developer Pack** (<https://education.github.com/pack>): Azure $100 credit + free
  services; **Heroku $13/month for 24 months** (still no persistent disk); domains (Namecheap .me,
  Name.com, .TECH). DigitalOcean credit not listed on the fetched page **[unverified]**.
- **Render:** "up to $10K in migration credits" (application; business migrations).
- Cloud startup programs (Google for Startups, Oracle for Startups, DO Hatch, etc.) require a
  company/stage fit **[unverified terms]** — not relevant for a personal single-user app.

---

## Ranked shortlist (fit for this workload)

Cost estimate = ~2 GB RAM, 20 GB persistent data, EU region where possible.

| # | Option | Type | Compose + shared volume as-is | EU | ~$/month | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Vultr vc2-1c-2gb** (FRA) | VM | yes | yes | **10** | go — cheapest solid fit |
| 2 | **Oracle Always Free A1** (2 OCPU / 12 GB / 200 GB) | VM (arm64) | yes | yes (home region) | **0** (PAYG optional) | partial — best specs, but idle reclamation, capacity, arm64, account-risk |
| 3 | **DigitalOcean** Basic 2 GB (AMS/FRA) | VM | yes | yes | 12 | go |
| 4 | **Akamai Linode 2 GB** | VM | yes | yes | 12 | go |
| 5 | **Fly.io** shared-cpu-1x 2 GB + 20 GB vol (ams) | PaaS/microVM | no — merge backend+opencode into one image | yes | 14–16 | partial |
| 6 | **Koyeb** standard medium + ≤10 GB vol (fra) | PaaS | no — merged image; 10 GB cap, preview | yes | 21+ | partial |
| 7 | **Northflank** 1 vCPU/2 GB + 20 GB | PaaS | no — merged image | yes | ~27 | partial (free sandbox worth a test) |
| 8 | **Railway Pro** | PaaS | compose import, but no shared volume | [unverified] | 25–30 | partial |
| 9 | **Render** Standard + 20 GB disk | PaaS | no — merged image | [unverified] | ~30 | partial |
| 10 | RackNerd promo VPS | VM | yes | yes | ~2–3 | partial — cheap, low trust |
| 11 | Google e2-micro | VM | yes, but 1 GB RAM / 0.25 vCPU / 30 GB | **no** (US only) | 0 | no for prod; toy/staging |

Recommendation from this global set: a **plain 2 GB VM** (Vultr / DO / Linode, $10–12) is the
lowest-effort match — compose, Caddy and the shared volume work unchanged. **Oracle Always Free** is
the only genuinely free option that fits; worth it only with the PAYG upgrade, a keep-alive/heartbeat
mindset, multi-arch images, and accepting account risk. Optionally front any VM with a free
**Cloudflare Tunnel** (no open ports), minding the 125 s proxy read timeout.

## Why ruled out

- **AWS / Azure free tier** — used up (given).
- **GitHub Pages** — static only (given).
- **Render Free** — spins down after 15 min, no persistent disk.
- **Koyeb Free** — 512 MB, scale-to-zero after 1 h, no volumes.
- **Railway Trial/Free, Fly trial** — $5 one-off / $1/month; 2 VM-hours or 7 days; volume caps 0.5 GB.
- **Heroku** — ephemeral filesystem, 24 h dyno cycling, no volumes.
- **Cloudflare Workers / Containers** — no subprocesses (Workers); ephemeral disk + sleep (Containers).
- **Vercel / Deno Deploy** — serverless: duration caps (300 s Hobby) / idle shutdown, no disk.
- **GitHub Codespaces** — max 4 h idle timeout, 120 core-hours; a dev box, not a host.
- **IBM Cloud** — no always-free VM; $200 credit for 30 days only.
- **Google e2-micro** — 1 GB RAM, 0.25 vCPU, US-only, 1 GB egress (staging at most).
- **Alibaba / Tencent** — time-limited trials; jurisdiction concerns for private notes.
- **Zeabur** — a control plane over a VM you'd rent anyway.
