# Notes: German / European hosters for karpathy.app prod

Desk research, fetched **2026-09-28** (all URLs below fetched that day unless noted). Primary
sources only (vendor pricing pages, docs, terms, price-list PDFs, vendor APIs). Where a figure
could only be found on a third-party site it is marked **[secondary]**; where nothing could be
confirmed it is marked **[unverified]**. Source keys like `[H1]` resolve in §6.

## 0. What we need (sizing assumptions)

- 3 always-on containers: Caddy (80/443, auto-TLS), Node/Express backend (git, ripgrep, watcher),
  `opencode serve` (calls external LLM APIs). No GPU.
- RAM: ~1–2 GB estimate → **2 GB is the floor, 4 GB is comfortable** (git on a 1.8 GB `.git`
  plus the Node + opencode processes; opencode is a Bun binary).
- Disk: 5–20 GB of vault clones → **≥ 40 GB local disk** is enough; no extra volume needed.
- Traffic: tiny (Markdown + LLM API calls). Any plan's included traffic is plenty.
- A public IPv4 is effectively required: Let's Encrypt HTTP-01 on port 80 and reachability from
  mobile networks. github.com IPv6 support [unverified as of 2026] — don't plan on IPv6-only.
- **Arch: both x86-64 and ARM64 work.** opencode v1.18.33 (released 2026-09-28; repo now
  `anomalyco/opencode`) ships `opencode-linux-arm64.tar.gz`, `opencode-linux-arm64-musl.tar.gz`,
  `opencode-linux-x64(-baseline)(-musl).tar.gz` [O1]. Node, Caddy, git and ripgrep all have
  official arm64 builds. So ARM plans (Hetzner CAX, netcup ARM, Oracle A1) are fine if our images
  are built multi-arch (`docker buildx --platform linux/amd64,linux/arm64`).

## 1. Hetzner (DE/FI) — in depth

**Free tier / trial:** none. No trial credit on the cloud pages or docs [H1][H3].

**2026 price increases (important — older blog posts are wrong now):**
- 2026-04-01: general price adjustment "for both new orders and existing products", all product
  lines incl. cloud [H4]. No per-product numbers in the statement. [secondary] reports +30–37 %
  on DE/FI cloud [S1].
- 2026-06-15 08:00 CEST: "standardization and price adjustment", **new orders and rescales only;
  existing servers keep their price** [H2][H5]. IPs, Volumes, Snapshots, Object Storage and
  Load Balancers are explicitly *not* affected by this round [H5].
- Current DE/FI prices, **excl. VAT, excl. IPv4** (old → new, from Hetzner's own table) [H2]:

| Plan | Arch | vCPU (shared) | RAM | NVMe | Traffic (EU) | Old €/mo | **Now €/mo** |
|---|---|---|---|---|---|---|---|
| CX23 | x86 (Intel/AMD) | 2 | 4 GB | 40 GB | 20 TB | 3.99 | **5.49** |
| CAX11 | ARM (Ampere) | 2 | 4 GB | 40 GB | 20 TB | 4.49 | **5.99** (0.0096/h) |
| CX33 | x86 | 4 | 8 GB | 80 GB | 20 TB | 6.49 | **8.49** |
| CAX21 | ARM | 4 | 8 GB | 80 GB | 20 TB | 7.99 | **10.49** |
| CPX22 | x86 (AMD, "regular perf.") | 2 | 4 GB | 80 GB | 20 TB | 7.99 | **19.49** |
| CPX12 | x86 | 1 | 2 GB | 40 GB | 20 TB | – | price not rendered [unverified] |

  Specs/traffic from [H3][H6]. The CPX line more than doubled; **CX/CAX are the only sensible
  Hetzner options now**.
- **IPv4 (Primary IP): €0.50/mo** (€0.0008/h); IPv6 free [H7]. A server without any Primary IP has
  no public interface [H7].
- **Backups:** 20 % of the server price, 7 slots, oldest rotated out [H8][H9]. Volumes are *not*
  included in backups and have no backups/snapshots of their own [H10].
- **Snapshots:** billed per GB/month [H8]; **€0.0143/GB/mo [secondary]** [S2].
- **Volumes:** 10 GB–10 TB, 3× replicated, hourly billing with monthly cap [H10];
  **€0.0572/GB/mo [secondary]** [S2]. Not needed for us (40 GB local disk suffices).
- **Firewall:** free ("We do not charge for our Cloud Firewalls"), 5 per server [H11].
- **Traffic:** 20 TB/mo included in EU; only outgoing billed, overage in 100 MB blocks [H6][H8].
  Overage price not stated on the fetched pages [unverified].
- **Billing / term:** hourly with a monthly cap; **no minimum term**; billed while powered off [H8].
- **Locations:** Falkenstein (FSN1), Nuremberg (NBG1), Helsinki (HEL1); plus Ashburn, Hillsboro,
  Singapore (1 TB / 0.5–8 TB traffic there, different prices) [H2][H6]. CAX (ARM) listed for EU
  locations only [H3].
- **GDPR/DPA:** DPA concluded in the customer portal; ISO/IEC 27001:2022 since 2016, BSI C5:2020
  Type 2 for cloud [H12].
- **Encryption at rest:** **no** — Hetzner's TOM lists "Encryption of Data (at rest)" as the
  **client's responsibility** for cloud servers [H12]. Use LUKS / encrypted app data ourselves.
- **API/Terraform:** full REST API, `hcloud` CLI, Terraform provider `hetznercloud/hcloud`
  v1.69.0 (partner tier, 2026-09-11) [T1].
- **Gotchas:**
  - **Account verification:** Hetzner may require a copy of a government ID (ID card/passport)
    *or* a prepayment with your own credit card before processing an order; they may reject
    large/unusual first orders, avoid VPN and free-mail addresses at signup [H13][H14].
  - Plan pages on 2026-09-28 showed "This product is currently unavailable. Please check back
    later." on several CPX/CX listings [H3][H6] — may be a JS placeholder, or real stock limits
    after the June re-standardization [unverified]. Check in the Console before committing.
  - Three price moves in one year; the April round applied to existing servers [H4].
- **Cheapest fit:** **CAX11 or CX23 + IPv4 = €6.49 / €5.99 net → ≈ €7.72 / €7.13 incl. 19 % VAT**;
  with backups (+20 % of server price) ≈ €9.15 / €8.44 incl. VAT.

## 2. IONOS (DE) — in depth

IONOS sells two unrelated products: **VPS+** (hosting-style, fixed plans) and **IONOS Cloud**
(ex-ProfitBricks, pay-as-you-go IaaS with Compute Engine and Cubes).

### 2a. IONOS VPS+ (ionos.de)

**Plans (prices incl. MwSt., promo for first 3 months, then regular) [I1]:**

| Plan | vCPU | RAM | NVMe | Promo (3 mo) | **Regular €/mo** | Setup |
|---|---|---|---|---|---|---|
| VPS S+ | 1 | 2 GB | 60 GB | €2 | **€5** | €10 |
| VPS M+ | 2 | 4 GB | 120 GB | €4 | **€12** | €10 |
| VPS L+ | 4 | 8 GB | 240 GB | €7 | €22 | €10 |
| VPS XL+ | 8 | 16 GB | 480 GB | €12 | €41 | €10 |

- **The "€1 VPS":** the old **VPS XS** (1 vCore, 1 GB RAM, 10 GB NVMe, €1/mo) was announced in
  June 2023 [I2]. **It is no longer on ionos.de/server/vps (2026-09-28)** — cheapest is VPS S+ at
  €2 promo / €5 regular [I1]. And 1 GB RAM would be too small for us anyway.
- **Free trial:** "30 Tage kostenlos testen" [I1]. The .com page words it precisely as a
  **30-day money-back guarantee** — you pay from day 1 and get a refund if you cancel [I3].
  Not a free tier.
- **Traffic:** "Unbegrenzt Traffic bis zu 1 Gbit/s" [I1].
- **Minimum term:** ionos.de only says offers "sind teils abhängig von Mindestvertragslaufzeiten"
  without stating it on the page (term shown in checkout) [I1]. **ionos.com lists a 1-year
  minimum term** for every VPS+ plan [I4]. Monthly-cancellable option on .de [unverified];
  [secondary] says 1/12/24-month terms exist, promo only with 12 months, setup fee on 1-month [S3].
- **Arch:** x86 only ("neueste Generation von AMD und Intel CPUs") [I1].
- **Locations:** "EU, USA und Großbritannien" [I1]; 2023 announcement: Berlin, Frankfurt, London,
  Logroño, Newark, Paris [I2].
- **Backups:** optional Cloud Backup "ab 6 Cent pro GB/Monat" [I1]. Snapshot price [unverified].
- **GDPR/DPA:** AVV free, concluded online (My Account → Privacy & Data Protection); for newer
  contracts it's already part of the T&Cs [I5].
- **Encryption at rest:** not stated [unverified].
- **API/Terraform:** VPS+ API/Terraform [unverified]; the Terraform provider
  `ionos-cloud/ionoscloud` (v6.7.37) targets IONOS Cloud, not VPS+ [T1].
- **Gotchas:** €10 setup fee; promo → regular price jump after 3 months; 1-year term (per .com);
  price-shown-incl-VAT on .de vs excl. on .com. Reputation for sluggish support / cancellation
  friction is anecdotal [unverified] — not from a primary source.
- **Cheapest fit:** **VPS S+ (2 GB) €5/mo incl. VAT** (tight but inside our estimate) or
  **VPS M+ (4 GB) €12/mo incl. VAT** — first-year cost S+ = 10 + 3×2 + 9×5 = **€61**.

### 2b. IONOS Cloud (cloud.ionos.de)

- **Trial:** **€/$200 starting credit** (US page: $200, full version for 30 days, payment details
  required, "for commercial sale only", no setup fees or minimum term) [I6]. German eligibility
  for private persons [unverified].
- **Compute Engine vCPU server:** €0.012/vCPU/h + €0.002/GB RAM/h; dedicated cores from
  €0.036/core/h. 1 vCPU + 2 GB ≈ €0.016/h ≈ **€11.7/mo** + storage [I7].
- **Cubes** (fixed, NVMe included): XS 1 vCPU/2 GB/60 GB **€0.007/h (≈ €5.1/mo)**; S 2 vCPU/4 GB/
  120 GB $0.014/h [I7][I8]. Billed per minute, pay-as-you-go [I8].
- **IPv4:** first free, extra static IPs €5/30 days; **egress: first 2 TB/mo free** [I7].
- **Locations:** several EU DCs + Newark [I7]. **Terraform:** `ionos-cloud/ionoscloud`,
  partner-premier [T1].
- The €200 credit would run a Cube XS for the whole 30-day trial — the only genuinely *free*
  way to try IONOS.

## 3. Other European providers

### netcup (DE, Karlsruhe/Nuremberg; also AT/NL)
- **Free tier:** none; **30-day money-back guarantee** [N1].
- **VPS 500 G12.5** — 2 vCore x86, 4 GB, 64 GB SSD, traffic included: **€8.26/mo incl. 19 % VAT
  on a 12-month term**; €9.50 on 1-month; 24-month −26 % (≈ €7.03) [N1]. (The 12M "−13 %" of
  €9.50 = €8.26, so €8.26 is the 12M price, not a net price.)
- **VPS 500 ARM G12.5** (Ampere Altra Max) — same 2/4/64 at the same €8.26 (12M) [N2].
- **Term:** choose 1, 12 or 24 months [N1]. Locations: Vienna, Nuremberg, Amsterdam, Manassas,
  Singapore [N1]. Snapshots included; local block storage €0.012/GB [N1].
- **DPA:** concluded in the Customer Control Panel [N3]. Encryption at rest [unverified].
- **API:** SCP REST API [N1]; no official Terraform provider in the registry [T1].
- Gotcha: no 99.9 % SLA / dedicated cores on VPS (only root servers) [N1].

### OVHcloud (FR; DE DC)
- **VPS 2027 range (launched 2026-06-17)** [V2]: **VPS-1 2 vCores / 4 GB / 40 GB NVMe,
  500 Mbit/s, unlimited traffic, daily automated backup included — from €4.53/mo incl. MwSt**
  (€3.81 excl.) [V1][V2]. VPS-2 4/8/75 €8.58; VPS-3 6/12/100 €12.38 [V1].
- The "from" price appears tied to a 12-month upfront configuration ("upfront12" in the config
  links) [V3]; no-commitment monthly price [unverified].
- Premium backups from €1.31/mo; snapshots from €0.36/mo [V1]. German DC for VPS (city not
  named on the page; [unverified] Limburg/Frankfurt) [V3].
- **Public Cloud free trial: €200 credit for one month**, valid payment method required, only if
  you never created a Public Cloud project before [V4]. Not usable for VPS.
- Terraform `ovh/ovh` (partner) [T1]. DPA / encryption at rest [unverified].
- **Strong value:** cheapest 4 GB plan with *included* daily backup.

### Contabo (DE, Munich/Nuremberg + global)
- **Cloud VPS 4: 4 vCPU / 8 GB / 100 GB SSD, 200 Mbit/s, "unlimited" traffic, 1 snapshot —
  €5.50/mo incl. MwSt "für die ersten 24 Monate"**, "effective monthly price for a 12-month
  subscription" [C1].
- **Minimum term 1 month**; renewal term = initial term; notice: none (prepaid) or 4 weeks
  (post-paid) [C1]. Setup fees "only on the entry plan" (amount [unverified]) [C1].
- Outgoing traffic under a Fair Use Policy (can throttle heavy users) [C1]. 9 regions, 11 DCs [C1].
- Auto Backup is a paid add-on [C1]. Terraform `contabo/contabo` (community) [T1]. ARM: none.
- Gotcha: very high specs per euro; CPU/IO consistency is a common complaint [unverified —
  anecdotal, no primary source].

### STRATO (DE, United Internet sister of IONOS)
- VPS S 1 vCore/2 GB/60 GB NVMe: **€2/mo promo for 3 months**, 12-month term; regular prices
  "€4–€56" across Linux plans (S regular ≈ €4 [unverified exact]) [R1].
- Unlimited traffic, up to 1 Gbit/s; setup €9 only on 1-month term; **30-day money-back**; DCs in
  Germany, Spain or France [R1]. Specs mirror IONOS VPS+ — same platform [unverified].
- API/Terraform: none found [unverified].

### Scaleway (FR; PAR/AMS/WAW)
- **Free tier:** Serverless Containers: **200,000 vCPU-s + 400,000 GB-s per month free**, then
  €1.00/100k vCPU-s and €0.20/100k GB-s [W1]. 200k vCPU-s ≈ 55 vCPU-hours → an always-on
  container (≈ 2.6 M vCPU-s/month) blows through it in ~2 days, and serverless has no persistent
  disk for git clones → **not usable for us**. Object storage: 75 GB egress free [W3].
- **Instances:** STARDUST1-S 1 vCPU/1 GB **€0.43/mo** (too small, stock-limited, 100 Mbit/s);
  **DEV1-S 2 vCPU / 2 GB ≈ €6.55/mo**; PLAY2-PICO 1/2 GB €10.42 — prices before tax, egress incl.,
  IPv4 and storage excluded [W2].
- **IPv4 €0.005/h (≈ €3.65/mo)** [W4]; block storage 5K IOPS ≈ €0.095/GB/mo [W3].
- DEV1-S realistic total: 6.55 + 3.65 + 20 GB×0.095 ≈ **€12.1 net ≈ €14.4 incl. VAT**.
- Terraform `scaleway/scaleway` (partner-premier) [T1]. No minimum term (hourly).

### UpCloud (FI; Helsinki + Frankfurt etc.)
- **Free trial: 7 days** from activation, no upfront credit; card verified via €0/€1
  authorisation, never charged; quotas 2 cores / 4 GB / 60 GB per storage tier / 2 IPv4; after
  the trial, servers are removed unless you deposit [U1]. [secondary] mentions 30-day / €500
  promos [S4] [unverified].
- **Starter plans** from 1 core/1 GB/10 GB up to 4 cores/8 GB/400 GB; 1 IPv4 + IPv6 included;
  billed hourly, **capped at 672 h (28 days)/month**; billable even when powered off [U2].
  "From €3/month" (1 GB) [U3 title]. **2 GB / 4 GB prices [unverified]** — pricing page returns
  HTTP 403 to fetchers.
- Block storage "encryption at rest" is a listed feature [U4]. Terraform `UpCloudLtd/upcloud`
  (partner) [T1]. Zero-cost egress [U3 title].

### Exoscale (CH; zones DE-FRA, DE-MUC, CH-GVA, AT, HR, …)
- Prices from Exoscale's public pricing API (EUR) [X2]: **Small (2 GB, 2 cores) €0.02333/h ≈
  €17.0/mo**, Medium (4 GB) €0.04666/h ≈ €34/mo, Tiny (1 GB) ≈ €10.6/mo; disk
  €0.00014/GB/h ≈ €0.10/GB/mo; snapshots same rate; **elastic IP €0.01389/h**; traffic €0.02/GB
  beyond a small free allowance [X1][X2].
- Per-second billing, no term, credit card / PayPal / invoice [X1]. Free trial [unverified —
  none found]. Terraform `exoscale/exoscale` (partner) [T1].
- Small + 20 GB disk ≈ **€19 net/mo** — solid Swiss/German sovereignty option, but ~2.5× Hetzner.

### Infomaniak (CH, Geneva)
- **VPS Lite** (hosted in Switzerland): 1 vCPU/2 GB/20 GB **CHF 2.70/mo**; 2 vCPU/2 GB/40 GB
  CHF 5.40; **2 vCPU/4 GB/60 GB CHF 7.20**; "monthly price with an annual commitment, payable in
  a single" payment [F1]. VAT treatment [unverified].
- **VPS Cloud** from CHF 38.41/mo, 30-day money-back, one free snapshot [F2].
- **Public Cloud (OpenStack): "Get started free of charge with CHF 300.- credits to be used
  within 3 months"** [F3] — the most generous trial in this list. Pay-per-use afterwards.
- Terraform `infomaniak/infomaniak` (community); Public Cloud is OpenStack → standard OpenStack
  provider works [T1]. DPA/encryption [unverified].

### STACKIT (DE, Schwarz Group; regions EU01 Germany-South, EU02 Austria-West)
- **B2B only** — registration asks for a VAT ID; STACKIT describes itself as a business cloud [K2].
  Private use is effectively ruled out.
- Price list PDF (EU01, per month) [K1]: t1.2 1 vCPU/1 GB **€3.92**; c1.1 1 vCPU/2 GB **€13.15**;
  c1.2 2 vCPU/4 GB €43.67; g1a.1d 1 vCPU/4 GB €35.40; **public IPv4 €2.92/mo**; block storage
  Premium-Capacity ≈ €0.07–0.10/GB/mo. Excl. VAT; "not a legally binding offer" [K1].
- Terraform `stackitcloud/stackit` (community) [T1]. Free trial [unverified].

### Hostinger (LT; DCs incl. Germany)
- KVM 1: 1 vCPU / **4 GB** / 50 GB NVMe / 4 TB — **€5.49/mo on a 24-month term, renews at
  €11.99**; KVM 2 2/8 GB/100 GB €7.99 → €14.99 [G1]. VAT inclusion not explicit [G1].
- 30-day money-back [G1]. Terraform `hostinger/hostinger` (community) [T1].
- Gotcha: low price needs 24 months prepaid; renewal ~2.2×.

### Alwyzon (AT, Vienna)
- Virtual Server XS: 2 vCores / 2 GB / 40 GB SSD / 20 TB — **€5.34/mo incl. 19 % VAT**; G5 E4+
  2/4 GB/120 GB €13.67 [A1]. Traffic throttled to 100 Mb/s beyond quota [A1].
- No free trial; 14-day money-back for consumers [A1]. API/Terraform: none found [unverified].

### Webdock (DK)
- VPS Essential 1 vCPU / 2 GB / **15 GB** NVMe / 1 TB — **€2.15/mo**; month-to-month, daily
  backups and snapshots included, 7-day money-back, x86 only, DC in Denmark [D1]. VAT not stated
  [D1]. 15 GB disk is below our 20 GB upper bound → need a larger plan (prices [unverified]).

### Oracle Cloud (Frankfurt region) — note only (covered in depth elsewhere)
- Always Free: Ampere A1 **1,500 OCPU-h + 9,000 GB-h/month = 2 OCPU / 12 GB** (docs now state
  this for Always Free tenancies), 200 GB block storage total, 5 volume backups [OR1].
- Idle reclamation: instances reclaimed if over 7 days CPU p95, network and memory all < 20 %
  [OR1] — our mostly-idle app is exactly that profile. ARM64 works for us (see §0).
- Frankfurt as home region: A1 capacity there is often exhausted [unverified — anecdotal].

### Self-host at home (existing Ubuntu server = original MVP plan)
- Power at **0.35 €/kWh**: cost/month = W × 730 h × 0.35 / 1000.
  - Raspberry Pi 5 (8 GB) ~5 W avg → **≈ €1.28/mo**; mini PC (N100 class) ~10 W → **≈ €2.56/mo**;
    an existing small Ubuntu box at ~25 W → **≈ €6.40/mo** (wattages are estimates [unverified]).
- Pros: already exists, unlimited disk, no third party holds the vault, ARM/x86 both fine.
- Cons: residential uplink/uptime; many German cable/fibre lines are DS-Lite (no public IPv4)
  → need Cloudflare Tunnel / Tailscale Funnel or a tiny VPS as relay [unverified per ISP];
  no provider backups; SD-card wear on a Pi (use NVMe/SSD).

## 4. Comparison (cheapest plan that fits, ≥ 2 GB RAM, ≥ 40 GB disk where possible)

| Provider | Plan | vCPU / RAM / disk | Arch | €/mo (VAT) | Term | Free tier / trial |
|---|---|---|---|---|---|---|
| Hetzner | CAX11 + IPv4 | 2 / 4 GB / 40 GB | ARM | 6.49 net ≈ **7.72 incl.** | none (hourly) | none |
| Hetzner | CX23 + IPv4 | 2 / 4 GB / 40 GB | x86 | 5.99 net ≈ **7.13 incl.** | none (hourly) | none |
| IONOS VPS+ | S+ | 1 / 2 GB / 60 GB | x86 | **5.00 incl.** (2.00 × 3 mo) + €10 setup | 12 mo (.com) | 30-day money-back |
| IONOS VPS+ | M+ | 2 / 4 GB / 120 GB | x86 | **12.00 incl.** (4.00 × 3 mo) + €10 | 12 mo (.com) | 30-day money-back |
| IONOS Cloud | Cube XS | 1 / 2 GB / 60 GB | x86 | ≈ 5.1 (excl.?) | none | €/$200 credit, 30 d |
| OVHcloud | VPS-1 | 2 / 4 GB / 40 GB | x86 | **4.53 incl.** (3.81 net) | 12 mo upfront? | PCI €200 (not VPS) |
| netcup | VPS 500 (ARM or x86) | 2 / 4 GB / 64 GB | both | **8.26 incl.** (12 mo), 9.50 (1 mo) | 1/12/24 mo | 30-day money-back |
| Contabo | Cloud VPS 4 | 4 / 8 GB / 100 GB | x86 | **5.50 incl.** (12 mo) | 1 mo min | none |
| STRATO | VPS S | 1 / 2 GB / 60 GB | x86 | ~4 incl. (2 × 3 mo) | 12 mo | 30-day money-back |
| Hostinger | KVM 1 | 1 / 4 GB / 50 GB | x86 | 5.49 (24 mo) → 11.99 | 24 mo | 30-day money-back |
| Alwyzon | VS XS | 2 / 2 GB / 40 GB | x86 | **5.34 incl.** | [unverified] | 14-day money-back |
| Infomaniak | VPS Lite 2/4 | 2 / 4 GB / 60 GB | x86 | CHF 7.20 | 12 mo | Public Cloud CHF 300 / 3 mo |
| Webdock | Essential | 1 / 2 GB / 15 GB | x86 | 2.15 (VAT?) | monthly | 7-day money-back |
| Scaleway | DEV1-S + IPv4 + 20 GB | 2 / 2 GB / 20 GB | x86 | ≈ 12.1 net | none | serverless only |
| UpCloud | Starter 2 GB | 1–2 / 2 GB | x86 | [unverified] | none | 7-day trial |
| Exoscale | Small + 20 GB | 2 / 2 GB / 20 GB | x86 | ≈ 19 net | none | [unverified] |
| STACKIT | c1.1 + IPv4 | 1 / 2 GB | x86 | ≈ 16+ net | none | B2B only |
| Oracle (FRA) | A1 Always Free | up to 2 OCPU / 12 GB / 200 GB | ARM | **0** | none | Always Free |
| Home | existing box / Pi 5 | own | both | **≈ 1.3–6.4 power** | – | – |

## 5. Ranked shortlist

| # | Option | Why |
|---|---|---|
| 1 | **Hetzner CAX11 (ARM) or CX23 (x86)** | ≈ €7–9/mo incl. VAT with backups; hourly, no term; best API/Terraform/CLI; DE/FI DCs, ISO 27001 + C5; 4 GB/40 GB covers us. Cost: ID/card verification at signup, three price moves in 2026. |
| 2 | **OVHcloud VPS-1** | Cheapest 4 GB plan (€4.53 incl.), **daily backup included**, unlimited traffic, DE DC, Terraform. Check commitment terms in the configurator. |
| 3 | **IONOS VPS S+ / M+** | Friends' recommendation; German DCs, AVV built in. S+ (2 GB) = €5/mo incl. is cheap but tight; M+ €12 is pricier than Hetzner. €10 setup, 12-month term (per .com), no API/Terraform for VPS+. The €1 XS plan is gone. |
| 4 | **netcup VPS 500 (ARM or x86)** | Solid German host, 4 GB/64 GB, ARM option; 12-month commitment for the €8.26 price; no official Terraform. |
| 5 | **Home server (existing)** | Near-free and the MVP's original plan; stays the fallback / dev-prod. Needs a tunnel if the line has no public IPv4; no off-site backups by default. |
| (free) | Oracle Always Free A1 (FRA) | Only real "significant free tier"; see the Oracle notes for capacity and idle-reclaim risks. |
| (trial) | IONOS Cloud €200 / Infomaniak CHF 300 / OVH PCI €200 | Good for a free month or three of testing, not for permanent hosting. |

### Why ruled out
- **Scaleway:** the free tier is serverless only (no persistent disk; the monthly allowance lasts
  ~2 days always-on); DEV1-S + IPv4 + block ≈ €14 incl. VAT for 2 GB; Stardust too small.
- **Exoscale, STACKIT:** 2–3× Hetzner for 2 GB; STACKIT is B2B-only (VAT ID).
- **UpCloud:** 7-day trial only; 2 GB pricing not verifiable; no advantage over Hetzner.
- **Contabo:** cheapest specs per euro, but fair-use traffic, no ARM, paid backups, and a
  reputation for noisy neighbours [unverified]. Fine as a fallback.
- **STRATO:** same idea as IONOS VPS (sister company), 12-month term, no API.
- **Hostinger:** €5.49 only with 24 months prepaid; renews at €11.99.
- **Infomaniak VPS Lite:** attractive CHF 7.20 for 4 GB, but annual prepay, CHF billing, CH data
  location (fine under GDPR adequacy) — keep as a sovereignty alternative.
- **Alwyzon:** fine small AT host, 2 GB plan only; no API; unverified terms.
- **Webdock:** 15 GB disk on the cheap plan is too small; larger plans unverified.

## 6. Sources (all fetched 2026-09-28)

- [H1] https://www.hetzner.com/cloud
- [H2] https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- [H3] https://www.hetzner.com/cloud/cost-optimized
- [H4] https://www.hetzner.com/pressroom/statement-price-adjustment/
- [H5] https://www.hetzner.com/pressroom/standardization-and-price-adjustment-of-our-server-products/
- [H6] https://www.hetzner.com/cloud/regular-performance
- [H7] https://docs.hetzner.com/cloud/servers/primary-ips/overview/
- [H8] https://docs.hetzner.com/cloud/billing/faq/
- [H9] https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/
- [H10] https://docs.hetzner.com/cloud/volumes/overview/
- [H11] https://docs.hetzner.com/cloud/firewalls/overview/
- [H12] https://docs.hetzner.com/general/security-and-identify/technical-and-organizational-measures/
- [H13] https://docs.hetzner.com/general/security-and-identify/fraud-prevention-faq/
- [H14] https://docs.hetzner.com/general/billing-and-account-management/account-getting-started/
- [I1] https://www.ionos.de/server/vps
- [I2] https://www.ionos.de/newsroom/news/ionos-vps-auf-neuer-plattform-mehr-performance-und-besseres-preis-leistungsverhaeltnis/ (2023-06-28)
- [I3] https://www.ionos.com/servers/free-vps
- [I4] https://www.ionos.com/servers/vps
- [I5] https://www.ionos.de/hilfe/datenschutz/allgemeine-informationen-zur-datenschutz-grundverordnung-dsgvo/vereinbarung-zur-auftragsverarbeitung-avv-mit-ionos-abschliessen/
- [I6] https://cloud.ionos.com/compute/sign-up
- [I7] https://cloud.ionos.de/preise
- [I8] https://cloud.ionos.com/compute/cloud-cubes
- [N1] https://www.netcup.com/en/server/vps
- [N2] https://www.netcup.com/en/server/arm-server
- [N3] https://www.netcup.com/en/helpcenter/documentation/general/dpa
- [V1] https://www.ovhcloud.com/de/vps/
- [V2] https://blog.ovhcloud.com/en/posts/vps-2027/
- [V3] https://www.ovhcloud.com/en/vps/vps-deutschland/
- [V4] https://www.ovhcloud.com/en-ie/public-cloud/free-trial/
- [C1] https://contabo.com/de/vps/
- [R1] https://www.strato.de/server/vserver/
- [W1] https://www.scaleway.com/en/pricing/serverless/
- [W2] https://www.scaleway.com/en/pricing/virtual-instances/
- [W3] https://www.scaleway.com/en/pricing/storage/
- [W4] https://www.scaleway.com/en/pricing/network/
- [U1] https://upcloud.com/docs/getting-started/free-trial/
- [U2] https://upcloud.com/docs/products/cloud-servers/configurations/
- [U3] https://upcloud.com/solutions/starter-plans/ (HTTP 403; page title only, via search)
- [U4] https://upcloud.com/docs/products/cloud-servers/
- [X1] https://www.exoscale.com/pricing/
- [X2] https://portal.exoscale.com/api/pricing/opencompute?currency=eur (Exoscale's pricing JSON)
- [F1] https://www.infomaniak.com/en/hosting/vps-lite
- [F2] https://www.infomaniak.com/en/hosting/vps-cloud
- [F3] https://www.infomaniak.com/en/hosting/public-cloud/prices
- [K1] https://stackit.com/en/asset/download/37788/file/STACKIT_price_list.pdf
- [K2] https://www.stackit.de/en/general-terms-and-conditions/terms-of-use/ (v1.3.2, valid from 2026-05-04)
- [G1] https://www.hostinger.com/de/vps-hosting
- [A1] https://www.alwyzon.com/en/virtual-servers
- [D1] https://webdock.io/en/pricing
- [OR1] https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- [O1] https://github.com/anomalyco/opencode/releases/tag/v1.18.33 (via `gh api repos/sst/opencode/releases/latest`)
- [T1] https://registry.terraform.io/v1/providers/<namespace>/<name> (versions/tiers as of 2026-09-28)
- [S1] [secondary] https://webhosting.today/2026/05/29/hetzner-has-now-raised-prices-three-times-in-2026-this-one-is-different/
- [S2] [secondary] https://costgoat.com/pricing/hetzner (updated 2026-09-05)
- [S3] [secondary] https://www.hosttest.de/vergleich/ionos-vserver.html (search snippet)
- [S4] [secondary] UpCloud search-result snippets (upcloud.com/get-started, HTTP 403 to fetch)
