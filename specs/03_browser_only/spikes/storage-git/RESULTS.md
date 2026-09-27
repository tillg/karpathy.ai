# Spikes: storage + git in the browser (browser-only, no server)

Run 2026-09-28. Machine: Apple M4 Max, 64 GB, macOS 27.0, `arm64`, Node v22.13.1,
Playwright 1.63.0 → **Chromium 153.0.8010.12** and **WebKit 26.6** (≈ Safari 26 / iPadOS), both headless,
persistent profile (like a normal tab), localhost origin.
Libraries: isomorphic-git 1.42.3, @isomorphic-git/lightning-fs 4.10.3, @isomorphic-git/cors-proxy 3.0.2,
@componentor/fs 4.3.1, plus a 100-line own OPFS `fs.promises` shim (`src/opfs-fs.js`).

Fixtures (from `/Users/tgartner/git/mylife_wiki`, read-only):

| Fixture | Content | Size |
|---|---|---|
| `vault.json` (S1) | the 3100 tracked `.md` files, 1729 dirs | 5.49 MB |
| `mdvault.git` (S2/S3) | same 3100 `.md` files, 3 commits | 2.3 MB pack |
| `mylife.git` (S2 big) | full bare clone of the real vault: 5604 files incl. media, 42 commits | 1.67 GiB pack, 1.23 GB worktree |

All git servers are local (`git http-backend` behind a CORS-enabled Node wrapper on `:8788`), so clone
times exclude real network transfer — on a phone, the 1.7 GB download itself dominates.

## Verdicts

| # | Theory | Verdict |
|---|---|---|
| S1 | OPFS can hold a realistic vault (3100 files) | **PARTIAL** — works in both engines, but per-file OPFS is slow (6–24 s to write 3100 files on the main thread; IndexedDB/lightning-fs is 5–30× faster). WebKit: no OPFS in ephemeral/private context, `estimate()` wildly over-reports, filenames come back **NFD** (see S2). `persist()` = false in both (headless, no user engagement). |
| S2a | isomorphic-git can clone github.com directly | **REJECTED** — CORS. Chromium: `TypeError: Failed to fetch` ("blocked by CORS policy: No 'Access-Control-Allow-Origin' header"); WebKit: `TypeError: Load failed`. |
| S2b | …via a CORS proxy | **CONFIRMED** — public repo 0.6–0.7 s, private test vault with token 1.2 s. But the proxy *is* a server (tiny, stateless). |
| S2c | Clone a 3100-file vault into lightning-fs (IndexedDB), `statusMatrix` fast enough | **CONFIRMED** — clone 1.7 s, status 62–83 ms, both engines. |
| S2d | Clone into an OPFS-backed fs | **PARTIAL** — own shim works but 3× (Chromium) / 18× (WebKit) slower than IndexedDB, status 1 s / 8 s; breaks on symlinks (OPFS has none) and on non-ASCII filenames in WebKit (NFC→NFD). @componentor/fs: `hybrid` fast for one clone, fails on re-init; `opfs` mode hangs (Chromium) / 1414 FSErrors (WebKit). |
| S2e | Clone the **full real vault (1.7 GB)** in the browser | **CONFIRMED (surprisingly)** — lightning-fs, both engines, no crash: 28–45 s over localhost, 2.4 GB (depth 1) / 3.1 GB (full) stored; status over 5604 files 1–2 s. Shallow saves only 0.65 GB here because history is small (42 commits); media dominates. |
| S3 | Edit + commit + push from the browser; pull/merge concurrent changes | **CONFIRMED** — commit 0.7–0.9 s, push 0.7–1.1 s, verified with host `git log`. Non-conflicting concurrent change → `git.pull` makes a real 2-parent merge commit, pushed. Conflict → `MergeConflictError` (with `data.filepaths/bothModified`); `merge({abortOnConflict:false})` still throws but writes `<<<<<<< main / ======= / >>>>>>> origin/main` markers to the worktree, file status `*modified`. |
| S4 | GitHub REST API works from the browser without a proxy | **CONFIRMED** — CORS OK unauthenticated (public, 60 req/h limit) and with token (private, 5000 req/h). Tree ~0.19–0.41 s, blob ~0.2–0.4 s. Write: 1 commit via Git Data API (7 calls: repo, ref, commit, blob, tree, commit, PATCH ref) in 2.5 s → `1f73b97` added `spike-browser-only/2026-09-27T22-10-25-859Z.md` to `tillg/karpathy-ai-test-vault`. |
| S5 | File System Access API `showDirectoryPicker` available | **Chromium yes / WebKit no** (also `showOpenFilePicker`, `FileSystemObserver`: Chromium only). Both: OPFS `getDirectory`, `createWritable`, `<input webkitdirectory>`. `createSyncAccessHandle` is worker-only in both (worked in the S1 worker). |

## Measured numbers

### S1 — OPFS vault store (3100 files, 5.49 MB)

| Engine | Operation | Time |
|---|---|---|
| Chromium | OPFS main thread write (createWritable) | 5954 ms (32 s in an earlier cold run) |
| Chromium | OPFS main thread read all (`getFile().text()`) | 3306 ms |
| Chromium | OPFS list tree (3100 files / 1729 dirs) | 191 ms |
| Chromium | OPFS worker write (createSyncAccessHandle) | 10492 ms |
| Chromium | OPFS worker read | 4511 ms |
| Chromium | lightning-fs (IndexedDB) write / read | 659 ms / 225 ms |
| WebKit | OPFS main thread write | 23508 ms |
| WebKit | OPFS main thread read | 18243 ms |
| WebKit | OPFS list tree | 1780 ms |
| WebKit | OPFS worker write / read | 2644 ms / 12679 ms |
| WebKit | lightning-fs write / read | 779 ms / 472 ms |

Storage: quota Chromium 10.7 GB, WebKit 20.6 GB (persistent profile). `estimate().usage` after S1
(2 OPFS copies + 1 IDB copy ≈ 16.5 MB): Chromium 17.5 MB, **WebKit 3261 MB** (not trustworthy).
`persisted()`/`persist()` → false/false in both. Ephemeral context (≈ private window): Chromium OPFS OK;
**WebKit OPFS throws `UnknownError: The operation failed for an unknown transient reason`**.

### S2 — isomorphic-git clone (local CORS smart-HTTP server unless noted)

`status1` = first `statusMatrix` with the clone's cache, `status2` = fresh call, `edit` = after modifying one file (change detected correctly unless noted).

| Engine | Repo / fs / depth | Clone | status1 / status2 / edit | Stored (du) |
|---|---|---|---|---|
| Chromium | github.com direct | — `TypeError: Failed to fetch` (CORS) | — | — |
| WebKit | github.com direct | — `TypeError: Load failed` (CORS) | — | — |
| Chromium | isomorphic-git/lightning-fs via cors-proxy, idb, 1 | 631 ms | 2 / 4 / 3 ms | 1.05 MB |
| WebKit | same | 709 ms | 4 / 3 / 4 ms | 1.05 MB |
| Chromium | private test vault via proxy + token, idb, 1 | 1205 ms | 1 / 1 / 1 ms | <0.01 MB |
| WebKit | same | 1147 ms | 2 / 2 / 2 ms | <0.01 MB |
| Chromium | mdvault, idb, full | 1708 ms | 83 / 76 / 76 ms | 8.29 MB |
| Chromium | mdvault, idb, 1 | 1682 ms | 83 / 76 / 75 ms | 8.27 MB |
| WebKit | mdvault, idb, full | 1685 ms | 72 / 77 / 75 ms | 8.29 MB |
| WebKit | mdvault, idb, 1 | 1612 ms | 62 / 71 / 71 ms | 8.27 MB |
| Chromium | mdvault, opfs-shim, full | 5408 ms | 1040 / 922 / 1162 ms | 8.29 MB |
| Chromium | mdvault, opfs-shim, 1 | 5459 ms | 977 / 962 / 1142 ms | 8.27 MB |
| WebKit | mdvault, opfs-shim, full | 31339 ms | 7676 / 8930 / 9435 ms, **21 false changes** | 8.29 MB |
| WebKit | mdvault, opfs-shim, 1 | 33801 ms | 7919 / 7966 / 7850 ms, **21 false changes** | 8.27 MB |
| Chromium | mdvault, componentor hybrid, full | 1989 ms | 282 / 250 / 224 ms | 8.29 MB (+~60 MB `.vfs.bin`) |
| WebKit | mdvault, componentor hybrid, full | 872 ms | 600 / 605 / 620 ms | 8.29 MB |
| both | mdvault, componentor hybrid, 1 (2nd instance) | `NoModificationAllowedError` on re-init | — | — |
| Chromium | mdvault, componentor `opfs` mode, 1 | timeout > 120 s (hangs in checkout) | — | — |
| WebKit | mdvault, componentor `opfs` mode, 1 | `MultipleGitError` (1414 × FSError) after 11.5 s | — | — |
| Chromium | **mylife.git 1.7 GB**, idb, 1 | 39056 ms (7210 objects) | 98 / 1082 / 1168 ms (5604 files) | 2406 MB |
| Chromium | mylife.git, idb, full | 45145 ms (11013 objects) | 99 / 2157 / 1462 ms | 3062 MB |
| WebKit | mylife.git, idb, 1 | 27750 ms | 110 / 2192 / 1375 ms | 2406 MB |
| WebKit | mylife.git, idb, full | 38173 ms | 109 / 2063 / 1723 ms | 3062 MB |
| both | mylife.git, opfs-shim, 1 | fails: `ENOTSUP` symlink (`Schema/methodology.md` is a symlink; OPFS has no symlinks) | — | — |

WebKit + OPFS Unicode: the 10 paths with umlauts (`…rückbestätigen…`) are written with NFC names
(as stored in git) but OPFS `keys()` returns them **NFD**, so isomorphic-git sees each as deleted +
untracked (3110 instead of 3100 files, 21 bogus changes). Any OPFS store on Safari must normalize names.
IndexedDB (lightning-fs) stores paths as strings → no issue.

### S3 — edit, commit, push, pull/merge (lightning-fs, `push.git` = copy of mdvault.git)

| Engine | Operation | Time | Result |
|---|---|---|---|
| Chromium | clone | 1145 ms | |
| Chromium | edit + add + commit | 725 ms | |
| Chromium | push | 705 ms | host `git log -1` = browser oid `082a871` ✔ |
| Chromium | pull (host made non-conflicting commit) + push | 1217 + 809 ms | merge commit `832da93` with parents `a76c9ad 518043c` on host ✔ |
| Chromium | pull with conflicting change | — | `MergeConflictError`; `abortOnConflict:false` → markers in worktree ✔ |
| WebKit | clone / commit / push | 1106 / 940 / 1079 ms | host HEAD = `3e01796` ✔ |
| WebKit | pull + push (merge) | 1491 + 1062 ms | merge `8204c8a` ✔ |
| WebKit | conflict | — | same as Chromium ✔ |

Conflict file after `merge({abortOnConflict:false})`:
```
<<<<<<< main
BROWSER VERSION OF LINE 1
=======
HOST VERSION OF LINE 1
>>>>>>> origin/main
```
Note: `git.pull` has no `abortOnConflict` passthrough, so the app would do `fetch` + `merge` itself.

### S4 — GitHub REST API from the page (no proxy)

| Engine | Operation | Time |
|---|---|---|
| Chromium | public `octocat/Hello-World` unauth: tree `?recursive=1` / blob | 187 / 192 ms (rate left 56/60) |
| WebKit | same | 187 / 229 ms |
| Chromium | private test vault with token: tree / blob | 403 / 405 ms (4996/5000) |
| WebKit | same | 414 / 386 ms |
| Chromium | write 1 commit (blob→tree→commit→PATCH ref, 7 calls) | 2517 ms → `1f73b97` |

The token was taken from `gh auth token` by the runner and passed to the page at runtime only; it is not
written to any file or log (checked: no `gho_/ghp_/github_pat` in `results/` or logs).

### S5 — feature detection (main thread, not cross-origin isolated)

| API | Chromium 153 | WebKit 26.6 |
|---|---|---|
| `showDirectoryPicker` / `showOpenFilePicker` | yes / yes | **no / no** |
| `navigator.storage.getDirectory` (OPFS) | yes | yes |
| `FileSystemFileHandle.createWritable` | yes | yes |
| `createSyncAccessHandle` | worker only | worker only |
| `FileSystemObserver` | yes | no |
| `<input webkitdirectory>` | yes | yes |

## Takeaways for the architecture report

- **Storage choice: IndexedDB via lightning-fs, not raw OPFS**, for a git working tree of many small
  files. It is the fastest in both engines, supports symlinks, has no Unicode-normalization trap, and is
  what isomorphic-git is built/tested for. OPFS is fine for a few large blobs, not 3000+ small files.
- **Git in the browser is viable end-to-end** (clone, status, commit, push, merge, conflict markers),
  even for the full 1.7 GB real vault on desktop engines — but that is 2.4–3.1 GB of origin storage; on
  iPad that risks Safari's eviction (no `persist()` grant seen) and a 1.7 GB mobile download. Media/LFS
  or a sparse/text-only strategy is needed for phones.
- **github.com git transport needs a CORS proxy** (a tiny server — hosted, self-hosted, or a
  Cloudflare Worker). The **GitHub REST API needs no proxy** and is a viable proxy-free path for
  read (tree + blobs) and write (Git Data API commit), at the cost of reimplementing sync/merge and
  rate limits (5000 req/h authenticated; a full vault fetch = 1 tree call + 1 call per blob).
- Safari has **no `showDirectoryPicker`**, so "open the local Obsidian folder" is Chromium-only;
  Safari private mode has **no OPFS**.

Limitations: headless engines on macOS, not a real iPad (memory/eviction limits differ);
localhost network; single runs (variance seen: Chromium OPFS main-thread write 6 s vs 32 s across runs);
componentor failures may partly be caused by this harness wiping OPFS under a live instance.

## Re-run

```bash
cd specs/03_browser_only/spikes/storage-git
npm install
npx playwright install chromium webkit       # if browsers are missing
npm run setup                                # fixtures -> tmp/ (reads mylife_wiki read-only; ~3 min, 1.7 GB)
npm run spike                                # all spikes, both engines -> results/{chromium,webkit}.json
                                             #   add `-- --no-write` to skip the GitHub REST test commit
npm run spike:big                            # only the 1.7 GB mylife.git clones -> results/*-big.json (~3 min)
npm run probe -- webkit s5                   # run one page function in one engine (debugging)
```

Needs `gh auth login` (token for the private test vault and the one REST write); without a token the
authenticated spikes are skipped. Layout: `src/` = spike page (Vite-built into `dist/`),
`scripts/servers.mjs` = static + git smart-HTTP (CORS, push) + cors-proxy, `scripts/run.mjs` = Playwright runner.
