# Disk space for karpathy.app prod — desk notes + spikes

2026-09-28. Spec requirement (`prod_env.md`): *"Having many .md vaults on the server might result in
lots of data. We should monitor and eventually limit it. Probably the right trigger would be before
adding an additional vault."*

Evidence: spikes in [`spikes/`](spikes/) (scripts + `*.out.txt` raw outputs), run on macOS / git 2.50.1
against a file:// server copy of the real demo vault `tillg/mylife_wiki`, and inside the running dev
stack (Rancher Desktop VM, backend container on alpine/busybox).

## TL;DR

- **The demo vault is a media vault, not a notes vault.** HEAD is 1,174 MB of blobs, of which
  **.md = 5.2 MB (0.4 %)** and **mp4 = 1,048 MB (89 %)**. Full clone today = **2.95 GB**
  (1.76 GB `.git` + 1.19 GB working tree). The local `/Users/tgartner/git/mylife_wiki` shows 4.7 GB only
  because it holds 1.79 GiB of loose objects that are duplicated in its pack.
- **Clone mode:** switch `Repo.clone` from a plain clone to **`--filter=blob:none`** (partial clone).
  -21 % here (2.32 GB), all backend git operations pass unchanged, history stays available on
  demand. For media-heavy vaults the real win is **sparse checkout** (324 MB without video, 18 MB
  .md only), but that needs backend changes (`git add --sparse`) and hides media from tree + AI —
  make it an opt-in per-vault setting later, not the default.
- **Pre-add check is cheap and accurate:** GitHub `repos/{r}.size` (KB, ≈ packed `.git`) + recursive
  tree API (exact blob bytes at the branch head) predicted the measured clone within ~1 %.
  Check `estimate ≤ free − reserve` before `POST /vaults` starts the clone.
- **Hard stop during clone:** `ulimit -f` (RLIMIT_FSIZE) on the git child kills a runaway clone
  (the pack is one file) — measured: 200 MB cap stopped a 1.7 GB clone in 4.2 s, git removed the
  partial dir. A `du` watchdog also works.
- **Blast radius:** put `/vaults` on its own fixed-size filesystem (Hetzner Volume or a loop-mounted
  ext4 file) so a full vault disk can't take down Docker/OS.
- **Monitoring:** `fs.statfs('/vaults')` costs 0.03 ms; `du` of the 5.6k-file demo vault 18 ms (warm).
  Expose both in an admin/health endpoint + a host cron → ntfy alert at 80 / 90 %.
- **Other disk users** on prod: images ≈ 0.7 GB (proxy 139 MB + backend 295 MB + opencode 288 MB),
  opencode data 17.6 MB (6.7 MB of it an unrotated log), container logs unrotated (no `logging:` in
  compose). Build images off-server; cap logs.

## 1. How the backend clones today

`apps/backend/src/repo.ts` `Repo.clone`: `git clone --branch <branch> --end-of-options <url> <dir>` —
full clone, full checkout, into `/vaults/<id>` (named volume `vaults`). The optional root subfolder is
only applied afterwards via pathspecs (`status/diff/add -- <root>`) and `rootDir`; the whole repo is
still downloaded and checked out. Git operations used afterwards: `status --porcelain -z
--untracked-files=all`, `diff HEAD`, `diff --no-index`, `diff --stat`, `cat-file -e`, `ls-files`,
`show`, `stash push --include-untracked / pop / list / drop`, `fetch`, `merge-base (--is-ancestor)`,
`merge --ff-only`, `reset --mixed`, `checkout`, `add -A`, `commit`, `push`, `rev-list --count`,
`ls-tree`. The backend image has `git` + `ripgrep`, **no git-lfs**.

## 2. Spike 01 — clone modes (`spikes/01-clone-modes.sh`)

Server = bare `--no-local` copy with `uploadpack.allowFilter=true` (GitHub allows filters). Each variant:
clone via file://, measure, then replay the backend's git calls: edit a tracked .md, add a new .md
and a new binary under `Sources/`, status/diff/stash, a separate clone pushes an upstream commit,
then the backend's pull procedure (fetch → merge-base → stash → merge --ff-only → stash pop),
`add -A` + commit + push.

| Variant | Clone time | `.git` | Working tree | Total | vs full | Backend ops |
|---|---:|---:|---:|---:|---:|---|
| A full clone (today) | 15.8 s | 1,758 MB | 1,188 MB | **2,946 MB** | 100 % | all OK |
| B `--depth 1` | 11.5 s | 1,129 MB | 1,188 MB | 2,317 MB | 79 % | all OK |
| C `--filter=blob:none` | 11.7 s | 1,137 MB | 1,188 MB | **2,325 MB** | 79 % | all OK |
| D `--filter=blob:limit=1m` | 11.6 s | 1,125 MB | 1,188 MB | 2,313 MB | 79 % | all OK |
| E blob:none + sparse `*.md` (non-cone) | 1.4 s | 4 MB | 14 MB | **18 MB** | 0.6 % | `add -A` **fails** on new non-.md files |
| F blob:none + sparse cone `Wiki/` (root subfolder) | 1.1 s | 26 MB | 31 MB | 56 MB | 1.9 % | `add -A -- .` fails on new files outside cone (*) |
| G blob:none + sparse "all but video" | 3.2 s | 136 MB | 188 MB | **324 MB** | 11 % | all OK (new .png matches `/*`) |
| H depth 1 + blob:none + sparse `*.md` | 1.6 s | 4 MB | 14 MB | 17 MB | 0.6 % | as E |

(*) The backend uses the pathspec `-- <root>` for a root vault, and the AI is confined to the root,
so in practice F's failure (file created outside the root) does not happen.

Findings:

- **Depth 1 / blob:none / blob:limit all land at the same size** here, because the vault has only
  42 commits and almost all bytes are media *in HEAD*: checkout fetches every HEAD blob anyway. The
  saved 0.6 GB is old history. On a long-lived notes vault (many small revisions) the saving grows.
- **blob:limit=1m buys nothing with a full checkout**: the >1 MiB blobs (209 files, 1.11 GB) are
  lazily fetched at checkout. Only useful combined with sparse checkout.
- **Prefer partial (`blob:none`) over shallow**: same size, but history (commits + trees) is complete,
  so `log`, `merge-base` and ahead/behind counts are exact; old blob contents are fetched on demand.
  Shallow clones carry grafts and edge cases (deepening, `merge-base` against history older than the
  graft, some hosts' push/fetch negotiation). Cost of partial: operations that need an old blob need the
  remote reachable (a lazy fetch). The backend's calls only read HEAD, the index, the stash and
  fetched upstream commits, which are local after checkout/fetch; `.git` didn't grow during the ops
  replay (1,137 MB before and after), i.e. no lazy fetches happened.
- **Sparse checkout** is where the real savings are (E: 160× smaller), but:
  - `git add -A` exits 1 ("paths … outside of your sparse-checkout definition") when a *new* file
    outside the patterns exists → the backend's commit throws. **`git add --sparse -A` fixes it**
    (verified: the new binary is staged and committed).
  - Media files are not on disk: the file tree (walks the working tree) won't list them, `![[img.jpg]]`
    embeds can't be opened, the AI can't read images/emails/PDFs, ripgrep won't search them.
  - A file written at a sparse-excluded *tracked* path shows up as modified (git drops skip-worktree),
    i.e. user/AI can "resurrect" excluded files — harmless but surprising.
  - Pattern design matters: non-cone `*.md` excludes `.claude/` skill scripts (`*.mjs`, `*.json`) the
    vault ships for opencode skills. "All but video" (G) keeps them.

## 3. Spike 02 — predicting size before cloning (`spikes/02-github-size.sh`)

`git ls-remote` only lists refs — no size. Options:

| Source | Call | What it measures | Measured |
|---|---|---|---|
| REST `repos/{owner}/{repo}` `.size` | 1 call, ~0.5 s | packed repo on GitHub's disk, **KB**, whole repo (all branches, history) | mylife_wiki: 1,787,424 KB = 1,745 MB vs clone `.git` 1,758 MB (**−0.7 %**); test vault: 1 KB vs `size-pack` 2 KB |
| GraphQL `repository { diskUsage }` | 1 call | same number as REST `size` | — |
| REST `git/trees/{branch}?recursive=1` | 1 call, ~1.5 s | exact uncompressed blob bytes at the branch head, per path (filterable by root subfolder / extension) | mylife_wiki: 1,230,752,084 B (1,174 MB) vs working tree 1,188 MB on disk (+1 % block overhead); .md 5.2 MB |

- `size` is known to **lag** after pushes (GitHub recomputes it asynchronously; community reports
  delays) and **excludes LFS objects**. Good enough for a budget check; don't use it for billing.
- Tree API limit: 100,000 entries / 7 MB response; beyond that `truncated: true` → walk sub-trees, or
  fall back to `size` alone.
- A tiny repo's real clone (144 KB) is dominated by fixed overhead (hook samples, index): add ~1 MB
  constant per vault.
- Both calls need the same GitHub token the backend already uses for private repos
  (`secrets/github_token`); 5,000 req/h rate limit is irrelevant at 2 calls per add.

Estimation formulas that matched the measurements:

- full clone ≈ `size_KB × 1024 + treeBytes` → 1,745 + 1,174 = 2,919 MB vs 2,946 MB measured
- partial (`blob:none`), full checkout ≈ `2 × treeBytes(selected)` for media-heavy repos (blobs don't
  compress) → 2,348 MB vs 2,325 MB; for pure-text vaults `.git` is smaller (zlib), so this over-estimates
  — which is the safe side.
- partial + sparse ≈ `2 × treeBytes(paths matching the sparse set / root)`.

## 4. Spike 03 — measuring usage on the server (`spikes/03-measure-usage.sh`)

Inside the dev backend container (busybox `du`, Rancher VM ext4), demo vault 5,604 working-tree files,
3.0 GB:

| Command | Result | Time |
|---|---|---:|
| `df -k /vaults` | volume = VM disk (98 GB, 20.7 GB free) — the named volume has **no own size** | 3 ms |
| `du -sk /vaults/my-life-wiki` | 3,015,672 KB | 18–19 ms (warm cache) |
| `du -sb` (apparent bytes; busybox supports it) | 3,072,125,484 B | 18 ms |
| `du -sk /vaults` (14 vaults) | 3,039,812 KB | 26 ms |
| `git count-objects -vH` | size-pack 1.70 GiB | 5 ms |
| Node `fs.statfsSync('/vaults')` | total / free bytes | **0.03 ms** |
| Node recursive `readdir`+`lstat` walk | 5,892 files, 2,937 MB | 283 ms |

Cold-cache `du` on a VPS disk will be slower (couldn't drop caches without privileges; expect 10–100×
on network block storage for the first run) — still fine for "after clone / after pull / every 15 min",
not for every request. Prefer shelling out to `du -sk` over a JS walk (15× faster). Cache per-vault
sizes in memory, refresh after clone, pull, commit.

## 5. Enforcing limits (spike 05 + desk research)

**a) App-level quota before `POST /vaults` (primary control).** See pseudo-code in §7. Also re-check
on `PATCH` when repo/branch/root change (a re-clone).

**b) Hard stop during the clone — git has no `--max-size`.** Measured in `spikes/05-clone-size-cap.sh`
against the 1.7 GB repo with a 200 MB cap:

- `ulimit -f` (RLIMIT_FSIZE) on the git process: git dies at the cap (`fatal: fetch-pack: invalid
  index-pack output`, exit 128) after **4.2 s**, and **removes the half-written clone dir** itself.
  Works because the incoming pack is a single file. Caveat: it caps *each file*, not the total (a
  huge working-tree file or lazy-fetch packs are capped individually, not summed). In Node: spawn
  `sh -c 'ulimit -f N; exec git clone …'`, or use the `prlimit` binary on Linux.
- `du` watchdog (poll 0.5 s, SIGTERM): killed at 241 MB (overshoot = poll interval × throughput),
  exit 143, dir removed by git. Covers the total, including checkout.
- Recommended: both — `ulimit -f` = 1.5 × estimate as the cheap hard cap, plus a clone timeout;
  the watchdog is optional.

**c) Blast radius: dedicated fixed-size filesystem for `/vaults`.** With a plain named volume the
vaults share the host root disk with Docker and the OS (here: the VM's 98 GB). A clone that fills it
breaks image pulls, logs, opencode's SQLite, Caddy's cert store.

- Hetzner: attach a **Cloud Volume** (10 GB–10 TB, 1 GB steps, grow-only, not included in server
  backups/snapshots, ext4/xfs auto-format), mount at `/srv/karpathy/vaults`, bind-mount into backend +
  opencode instead of the named volume. Check the current €/GB on hetzner.com/cloud/block-storage.
- Anywhere: a loop-mounted ext4 file: `fallocate -l 20G /srv/karpathy/vaults.img && mkfs.ext4
  vaults.img` + fstab `…/vaults.img /srv/karpathy/vaults ext4 loop,nofail 0 2`. The Docker `local`
  volume driver's `o=loop` doesn't set up loop devices (it calls mount(2) directly), so do this on the
  host, not in compose.
- Oracle Always Free includes 200 GB block volume total — a separate block volume costs nothing there.
- With `/vaults` on its own FS, `statfs` free space **is** the vault quota — no bookkeeping.

**d) XFS / ext4 project quotas.** Per-directory (per-vault) hard quotas enforced by the kernel.
XFS needs the `pquota` mount option (Hetzner images use ext4 root); ext4 needs `mkfs -O quota,project`
+ `prjquota`, `chattr -p`. Docker's `--storage-opt size=` only limits a container's writable layer on
overlay2-on-XFS, **not volumes**. Overkill for single-user; the dedicated FS gives 90 % of the benefit.

**e) LFS.** The backend image has no git-lfs, so LFS-tracked files arrive as ~130-byte pointer files:
safe for disk, but those media are unusable (and GitHub `size` + tree sizes don't include LFS objects,
so the estimate would be right for *this* behavior). If git-lfs is ever added, set
`GIT_LFS_SKIP_SMUDGE=1` for clone/pull and fetch on demand, or LFS content bypasses the estimate.

**f) Growth after the add.** Pulls download new objects (partial clone: only blobs of checked-out
paths), `git gc --auto` repacks, lazy fetches add packs. So also re-measure after pull and alert —
the pre-add check alone doesn't bound usage.

## 6. What else fills the disk (spike 04, `spikes/04-docker-footprint.sh`)

Dev machine daemon (shared with other projects — nothing pruned): images 50.6 GB (27.9 GB
reclaimable), build cache 9.6 GB, volumes 24 GB. karpathy-app part:

| Item | Size | Prod relevance |
|---|---:|---|
| `karpathy-app-prodtest-backend` / `-opencode` / `-proxy` (≈ prod images) | 295 + 288 + 139 MB ≈ **0.72 GB** | per deployed version; old versions pile up as dangling images |
| dev images (`backend` 399 MB, `web` 588 MB) + stale `karpathy-ai-*` tags from before the rename | ~2.8 GB | dev only; the old `karpathy-ai-*` tags are leftovers (not removed) |
| `ollama/ollama` image + `ollama` volume | 7.0 GB + 1.8 GB | dev only (prod uses a hosted provider) |
| `vaults` volume | 2.9 GB | the demo vault |
| `opencode-data` volume | 17.6 MB (db 6.8 MB + WAL 4.1 MB, `log/opencode.log` 6.7 MB) | grows with chats/logs; `snapshot: false` already avoids opencode's shadow git copy of each vault |
| `caddy-data` | 72 KB | certs; negligible |
| container logs (json-file) | ≤ 320 KB now | **no rotation configured** — unbounded over months |
| build cache | 9.6 GB (all projects) | only if images are built on the server |

Prod implications: build images in CI (e.g. GHCR) and `docker compose pull` on the server instead of
building there (no build cache); after a deploy `docker image prune -f` (dangling only — fine on a
dedicated prod host); add `logging: {driver: json-file, options: {max-size: 10m, max-file: "3"}}` per
service (or daemon.json); keep opencode's log dir in mind (check whether opencode rotates it). Base
budget without vaults: **~2 GB** (OS aside).

## 7. Recommendation

**Clone mode**

- Default: `git clone --filter=blob:none --branch <b> --end-of-options <url> <dir>`. Drop-in change,
  all backend operations passed, never larger than today, saves history weight on long-lived vaults.
- If the vault has a **root subfolder**: additionally `--sparse` + `git sparse-checkout set <root>`
  (cone). Matches what the app already exposes (only the root), cuts the demo vault to 56 MB with root
  `Wiki`. Requires `git add --sparse` (or keep the `-- <root>` pathspec, which already avoids the
  failure).
- Later, opt-in per vault: **"skip large media"** = non-cone sparse `/*` + `!*.mp4 !*.mov !*.m4v
  !*.webm` (demo vault 2.9 GB → 324 MB), with `git add --sparse` and a UI hint that those files exist
  in the repo but aren't on the server. Not `*.md`-only: it drops the vault's skill scripts.
- Don't use `--depth 1` (same size as partial here, more edge cases).

**Pre-add check** (in `POST /vaults` and a repo/branch/root-changing `PATCH`, before `startClone`):

```text
const RESERVE    = max(2 GiB, 10% of volume)      // keep git gc, pulls, opencode db alive
const MAX_VAULT  = env VAULT_MAX_BYTES  ?? 5 GiB  // per vault
const MAX_TOTAL  = env VAULTS_MAX_BYTES ?? volume size

meta  = GET repos/{repo}                            // .size (KB), default_branch
tree  = GET repos/{repo}/git/trees/{branch}?recursive=1
if tree.truncated: treeBytes = meta.size*1024       // fallback: assume worktree ≈ pack
else: treeBytes = Σ blob.size for paths under root (and matching the sparse set, if any)
estimate = 2*treeBytes + 1 MiB                      // partial clone: packed blobs + worktree
         (full clone: meta.size*1024 + treeBytes + 1 MiB)

free   = statfs('/vaults').bavail * bsize
used   = Σ cachedSize(vault)                        // du -sk per vault, refreshed after clone/pull/commit
reject 507/409 "not enough space" if estimate > free - RESERVE
reject 413 "vault too large"      if estimate > MAX_VAULT
reject 409 "vault budget reached" if used + estimate > MAX_TOTAL
warn in UI (confirm)              if estimate > 1 GiB  → offer "skip large media"
clone with ulimit -f = ceil(1.5*estimate) and a timeout; on failure: rm dir, state clone-failed,
cloneError = "exceeded size cap" (existing clone-failed flow, retry with new settings)
```

**Limits / defaults (single user)**

- `/vaults` on its own filesystem: Hetzner Volume or loop file, **20 GB** to start (grow-only;
  the demo vault needs 2.3 GB with partial clone). On Oracle Always Free, a separate block volume.
- Reserve max(2 GiB, 10 %); per-vault cap 5 GiB; total = the FS size.
- Docker log rotation 10 MB × 3; images pulled, not built; prune dangling after deploy.

**Monitoring**

- `GET /vaults/:id` / `GET /vaults` (or an admin `GET /system/disk`): `{ totalBytes, freeBytes,
  reserveBytes, vaults: [{id, bytes, measuredAt}] }` from `fs.statfs` + cached `du`. Show it in the
  admin area next to "Add vault"; disable the button with an explanation when `free − reserve` is small.
  Keep `/healthz` unauthenticated and content-free (it's public behind the proxy); put numbers behind
  the bearer token.
- Host cron (no app dependency, also catches Docker/OS growth):
  `*/15 * * * * p=$(df --output=pcent /srv/karpathy/vaults / | tail -n +2 | tr -dc '0-9\n' | sort -n | tail -1); [ "$p" -ge 80 ] && curl -s -d "karpathy disk ${p}%" https://ntfy.sh/<secret-topic>`
  (ntfy free; or email via the provider's SMTP; or a healthchecks.io ping for dead-man's-switch).
- Provider metrics: Hetzner Cloud graphs CPU / disk I/O / network but not filesystem fullness
  (no in-guest agent); OCI Monitoring + Alarms are free but filesystem-usage metrics need the in-guest
  agent — verify before relying on it. The cron + ntfy route is provider-independent.
- Thresholds: warn 80 %, alert 90 % of the vault FS and of `/`.

## Sources

- Spikes: `spikes/01-clone-modes.sh` … `spikes/05-clone-size-cap.sh` and their `*.out.txt`.
- GitHub REST trees API limits (100k entries / 7 MB): https://docs.github.com/en/rest/git/trees
- GitHub `size` lag reports: https://github.com/orgs/community/discussions/23585
- Hetzner Volumes (10 GB–10 TB, grow-only, not in backups): https://docs.hetzner.com/cloud/volumes/overview/
- git docs: `git-clone --filter/--sparse`, `git-sparse-checkout`, `git-add --sparse` (git 2.50.1 used).
