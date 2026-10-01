---
feature: 07_deployments
title: "Plan: releases, Ansible targets, monitoring"
status: paused
order: 4
created: 2026-10-01
edited: 2026-10-01
---

# Plan: releases, Ansible targets, monitoring

Each step ends with its check. Steps are in dependency order; the phases can be reviewed one at a time.

## Phase 0: tools

- [x] Install `lima`, `ansible-core` and `ansible-lint` on the Mac (`brew install lima ansible
      ansible-lint`: Homebrew has no `ansible-core` formula, `ansible` brings core 2.21; the collections
      come from `requirements.yml` in Phase 4); add them to the README prerequisites. **Check:** `limactl --version`, `ansible --version`, `ansible-lint --version`;
      Rancher Desktop still starts and `just dev` works.

## Phase 1: version in the app

- [x] Test first: backend test that `GET /api/health` returns `version` from `APP_VERSION`, `dev`
      when it's unset. **Check:** fails.
- [x] Backend reads `APP_VERSION`; Dockerfiles take `ARG APP_VERSION=dev` → `ENV`. **Check:** test
      passes, `just check` green. (Backend: `ENV` in the `prod` stage; proxy: build arg for the PWA
      build. The opencode image doesn't report a version, so it needs none.)
- [x] Settings dialog ("Vaults & settings"): a line with the server version (from `/api/health`) and the
      PWA's own version (baked in at build time) (architecture A17). **Check:** e2e on the dev stack shows
      both as `dev`; a screenshot of the dialog at 1× in `tmp/`.

## Phase 2: compose hardening

- [x] `deploy/compose.yml`: `image:` with `${APP_VERSION:-dev}` per service, proxy ports
      `${BIND_IP:-0.0.0.0}:${HTTPS_PORT:-443}:443`, remove `80:80`, json-file log rotation,
      `no-new-privileges`, `cap_drop: [ALL]` (+ `NET_BIND_SERVICE` on the proxy). **Check:**
      `docker compose config -q` for dev, prodtest and plain; `just dev` and `just prodtest` come up
      healthy; `just e2e` and `just prodtest e2e` green. (Also `TLS_MODE: ${TLS_MODE:-dns}` on the
      proxy, so a target's `.env` selects the TLS mode. Result: dev 200 passed; prodtest 197 passed,
      one flaky webkit a11y run (6/6 on rerun) and `fix-reload-same-text` ×2, which `docker exec`s
      into the dev stack's `karpathy-app-backend-1` and so can never pass against prodtest.)
- [x] `deploy/compose.dev.yml`: own `image:` for `backend` and `opencode` (`karpathy-app-dev/…`), so
      dev and prodtest builds never share a tag. **Check:** after `just dev` and `just prodtest`,
      `docker inspect` of the running backend containers shows two different image IDs, and the
      dev backend still hot-reloads.
- [x] Fix whatever `cap_drop: [ALL]` broke with a commented `cap_add`, or note why none was needed.
      **Check:** the same runs green. (None needed: backend and opencode run as uid 1000 and git,
      ripgrep and opencode need no capabilities; Caddy runs as root and needs only
      `NET_BIND_SERVICE`.)
- [x] Proxy healthcheck in `compose.yml`: a plain-HTTP health endpoint in the Caddyfile, checked from
      inside the container (architecture A11). **Check:** `docker compose ps` shows the proxy `healthy` on
      dev and prodtest; stopping the backend turns it `unhealthy` only if the endpoint depends on it (decide
      and note which). (Decided: independent. `http://127.0.0.1:8081` is answered by Caddy itself;
      the backend has its own healthcheck. With the prodtest backend stopped the proxy stayed `healthy`.)

## Phase 3: release workflow

- [x] `ci.yml`: add `on: workflow_call`. **Check:** CI green on a PR; the `nightly` job stays skipped
      when called from another workflow. (Pushed straight to `main` (user, 2026-10-01): CI green there,
      and `nightly` skipped inside the release runs.)
- [x] `.github/workflows/release.yml` with `permissions: { contents: write, packages: write }`:
      `check` (reusable ci + guard that final tags are on `main`; `-rc.N` from any commit), `build` matrix image × {ubuntu-24.04,
      ubuntu-24.04-arm} push by digest, `manifest` (imagetools → `:X.Y.Z` from `${GITHUB_REF_NAME#v}`, `:latest`), `release`
      (`gh release create --generate-notes deploy/compose.yml`, the compose file as release asset).
      Images carry the `org.opencontainers.image.source` label. Pre-release tags (`-rc.N`) don't move
      `:latest` and are created with `--prerelease`.
- [x] `just release <X.Y.Z[-rc.N]>`: refuses a dirty tree; for a final version also a HEAD that isn't
      on `main` (an RC may come from any commit); tags, pushes, prints the run URL. **Check:** an RC from
      a non-`main` commit gets released; a final tag pushed by hand on such a commit fails in `check`.
      (2026-10-01 on the throwaway branch `test/release-guard` (user OK):
      - `just release 0.0.2` refused ("HEAD is not on origin/main");
      - `v0.0.1-rc.6` from the branch was released as a pre-release;
      - `v0.0.2` pushed by hand failed in `guard`, and build, manifest and release were skipped
        (no release, no image).

      Then the `v0.0.2` tag and the branch were deleted.)
- [x] Dry run with `v0.0.1-rc.1`. Make the three GHCR packages public. **Check:**
      `docker manifest inspect ghcr.io/tillg/karpathy.app-backend:0.0.1-rc.1` lists amd64 and arm64;
      an anonymous `docker pull` works; the image reports `version: 0.0.1-rc.1`; GitHub shows the
      release as "Pre-release", not "Latest", and the packages are linked to the repo; the release page
      has `compose.yml` and `docker compose -f compose.yml config -q` passes on it in an empty dir
      (its `build:` contexts don't exist on a host, and pull-only must not need them). (Done with
      **rc.2**: rc.1 stopped in `check` (the CI ansible job didn't find its collections) before any
      image was built, so it never became a release. All checks pass. The packages could be pulled
      anonymously right away, so making them public needed no manual step. `config -q` needs the
      `secrets/` files, which the app role creates.)

## Phase 4: local VM + Ansible skeleton

- [x] `deploy/lima/karpathy-vm.yaml` (Ubuntu 24.04, vz, 2 CPU / 4 GiB / 40 GiB; forwards only
      443 → 9444, 8090 → 9090, 8091 → 9091, automatic forwarding off; `tmp/dev/remotes` mounted
      writable) and `just vm up|down|reset|ssh` (`down` stops, `reset` deletes and recreates). **Check:**
      `just vm up` then `just vm ssh -- uname -m` prints `aarch64`; `just vm ssh -- id -u` shows the guest
      user's uid and `getent passwd 1000` is empty (uid 1000 free for `deploy`), otherwise stop and adjust
      `karpathy-vm.yaml`; a file written to `tmp/dev/remotes` on the Mac is visible in the VM; after
      `just vm down` + `just vm up` a file created in the VM is still there; after `just vm reset` it's gone.
      (uid 1000 was free, but cloud-init gave the guest user's **group** gid 1000, and Lima can't set a
      gid. `karpathy-vm.yaml` now has a boot provision script that moves that group to 1999; `base`
      asserts both uid and gid 1000.)
- [x] `deploy/ansible/`: `ansible.cfg`, `requirements.yml` (community.docker ≥ 5.3, ansible.posix),
      `vault-pass.sh` (Keychain), `site.yml`, `inventories/{local,hetzner}`; the vault files encrypted.
      `just deploy <target> [version] [--only app|monitoring]` (roles tagged `app` / `monitoring`) and
      `just deploy-check`, logging to `tmp/deploy-*.log`. **Check:** `ansible -i inventories/local all
      -m ping` succeeds against the VM. (The vault script is `vault-pass-client.sh`: the `-client`
      suffix makes Ansible pass `--vault-id <target>`, so one script serves both targets'
      Keychain items `karpathy-ansible-{local,hetzner}`. The `hetzner` vault holds placeholders until
      Phase 7. `just deploy` wraps `deploy/ansible/deploy.sh`.)
- [x] `ci.yml`: an `ansible` job (`ansible-galaxy collection install -r requirements.yml`,
      `ansible-lint`, `ansible-playbook --syntax-check` for both inventories, using a dummy vault
      password so the encrypted files load). **Check:** CI green on a PR. (Green on `main`, which is
      where this went (user, 2026-10-01). The collections go to `~/.ansible/collections` explicitly:
      the runner's preinstalled Ansible hides them from pipx's ansible-lint. Syntax checks don't
      decrypt the vaults.)
- [x] Role `base`: deploy user uid 1000, sshd hardening, unattended-upgrades. **Check:** on the VM,
      `id deploy` → uid 1000, `sshd -T | grep -i passwordauthentication` → no; a second run reports
      `changed=0`.
- [x] Role `docker`: Docker apt repo, docker-ce + compose plugin, user in the `docker` group, drop-in
      ordering after `tailscaled` when Tailscale is enabled. **Check:** `docker compose version` ≥ 2.24
      on the VM; idempotent. (Compose v5.5.1.)
- [x] Role `vaults_fs`: loop-mounted ext4 of `vaults_fs_size` at `/srv/vaults`, owned by 1000.
      **Check:** `df -h /srv/vaults` shows the size; after `just vm ssh -- sudo reboot` it's mounted again.

## Phase 5: app role on the VM

- [x] Role `app`: resolve the version (arg or `releases/latest`), assert the images exist, `get_url`
      the release asset `compose.yml` into `releases/vX/`, render `shared/` (`.env`, `opencode.env`,
      secrets 0600 `no_log`, `compose.target.yml`), `current` symlink, `docker_compose_v2`
      (`project_src: shared/`, files `current/compose.yml` + `shared/compose.target.yml`,
      `pull: always`, `build: never`, `wait: true`, project `karpathy-app`).
- [x] Smoke check task: `uri https://{{ domain }}:{{ https_port }}/api/health` with the Bearer token,
      assert `opencode == ok` and `version == X.Y.Z`; `validate_certs` off only for `tls_mode: internal`.
- [x] Retention: keep the newest 5 release dirs, `docker image prune -f`. (Never deletes the release
      being deployed; only two releases exist so far, so nothing has been removed yet.)
- [x] `local` target: `compose.target.yml` mounts the VM's view of `tmp/dev/remotes` as `/remotes`
      into the backend and sets `GIT_REMOTE_BASE=file:///remotes/` (architecture §6). (Plus
      `safe.directory=/remotes/*` via `GIT_CONFIG_*`: the share is owned by the Mac's uid.)
- [x] `local` vault: generated test values only (bearer token, dummy GitHub/DNS tokens, Beszel secrets,
      random test ntfy topic, optional LLM key), encrypted like `hetzner` (architecture A13).
- [x] **Check:** `just vm reset` then `just deploy local 0.0.1-rc.1` against the fresh VM passes, and the log shows the
      time from `just vm up` to a passing smoke check (target: under 15 min); `https://localhost:9444` opens in the browser
      with the token (screenshot in `tmp/`); a second deploy reports `changed=0` for the app role
      apart from the smoke check; cut `v0.0.1-rc.2` with a change to `compose.yml` (e.g. a
      new environment variable), deploy it, then deploy `rc.1` again with the same playbook → the version
      flips back, the stack is healthy and the vault added before is still there (architecture §5.2,
      playbook/release compatibility); the rollback deploy takes under 2 min (`--only app`, timed in
      the log). (Run one RC later than planned: fresh VM + `rc.2`. `vm reset` took 252 s and the
      deploy 206 s + 82 s, ≈ 9 min in total; the deploy ran three times because it uncovered two
      `deploy.sh`/role bugs. Second deploy `changed=0`. The browser shows the app and "Server
      0.0.1-rc.2 · App 0.0.1-rc.2" (`tmp/local-app.png`, `tmp/local-admin.png`). `rc.3` adds `TZ` to
      the backend (tzdata in the image). Rollback rc.3 → rc.2 with `--only app`: 49 s, version back to
      rc.2, all healthy, the vault added on rc.3 still `ready`.)
- [x] Tag the e2e tests that need a model `@llm`: run the suite against `just prodtest` with the
      model unreachable, and tag the tests that fail for that reason (and only those). **Check:**
      `just e2e` against the dev stack is still green with every test, tagged or not. (Prodtest
      without a model: `chat.spec` ×2 and `fix-63`. On the VM `fix-13` ×2 and `plan-gaps` "one
      running turn per vault" fail too: they need a turn in flight, which only passed on prodtest
      because the unreachable model hung instead of failing. Tagged as well, 6 titles = 12 tests in
      total. All 12 pass on the dev stack with the model.)
- [x] `just deploy-e2e local`: copies the `local` bearer token from the vault to
      `tmp/local/bearer_token` (0600, gitignored), then runs `playwright test --grep-invert @llm` with
      `E2E_BASE_URL=https://localhost:9444`. **Check:** green, and the run reports the number of tests
      passed. That number must equal the suite total minus the `@llm` tests. (On rc.4: 186 passed +
      2 skipped = 188 = 202 − 14 `@llm`. Also sets `E2E_EXPECT_VERSION` from `/api/health` and
      `E2E_DOCKER=limactl shell karpathy-vm sudo docker` for the one test that execs into the backend
      (`backendExec`, user OK 2026-10-01 to change `fix-reload-same-text`). Later `@llm` tag: "Stop
      aborts a running turn" (a race without a model). Known flake: webkit "push failure" fails about
      1 run in 3 on the VM; the Mac-side rename of the bare repo shows up late through virtiofs.
      Found and fixed along the way: the backend lacked an init, and ~300 zombie `git` processes
      piled up per e2e run (dev, prodtest, VM); `init: true` since rc.4. Final run on **rc.5** (after
      the review fixes): 185 passed, 2 skipped, 1 failed. The failure is webkit `a11y.spec.ts:36`,
      a test race: it clicks the `Code.md` tree item and then Read immediately, so on a slow target
      the note opens afterwards in Write mode. 3/3 on the VM, 1/2 on prodtest, 2/2 on dev. The
      test wasn't changed (needs your OK); the fix would wait for Code.md's heading before clicking
      Read.)

## Phase 6: monitoring

- [x] **Spike Beszel v0.20** (throwaway, in `specs/07_deployments/spikes/beszel/`): can Ansible, with
      no clicks in the UI, (1) create the hub's admin user, (2) register the system and get the agent's
      KEY/TOKEN, (3) set the alert rules through the hub API, (4) make the agent report `/` **and**
      `/srv/vaults`, (5) send a test alert to ntfy? **Result: all five yes**, run in Docker on Rancher
      Desktop because there's no VM yet ([RESULTS.md](spikes/beszel/RESULTS.md), [`run.sh`](spikes/beszel/run.sh)).
- [x] Vault entries for `local` (and later `hetzner`): Beszel user password, hub private key
      (`ssh-keygen -t ed25519`), universal token (UUID), ntfy topic.
- [x] Role `monitoring`: compose project `karpathy-monitoring` with the beszel hub (`bind_ip:8090`,
      the vault's `id_ed25519` in its data dir), beszel-agent (host network, read-only docker.sock,
      `/srv/vaults` at `/extra-filesystems/vaults:ro`, `KEY`/`TOKEN`/`SYSTEM_NAME`, `HUB_URL` to the hub
      on the host), gatus (`bind_ip:8091`, templated `config.yaml`, ntfy alerting); off switches per
      target. **Check:** the hub UI shows the VM `up` with its containers and both filesystems;
      `docker stats` RAM of the monitoring project < 150 MB. (Hub API: system `local` `up`, `/` and the
      vaults filesystem (`efs.loop0`) reported; app containers show once Phase 5 deploys them. RAM:
      hub 12 MB + agent 7 MB. The agent's own listener is on `127.0.0.1:45876`.)
- [x] Beszel provisioning tasks, in the spike's order (architecture §4.3): promote the env user to
      admin, set the permanent universal token, POST then PATCH `user_settings` webhooks (assert the
      ntfy URL is there), wait for the system `up`, then the alert rules via `user-alerts` with
      `overwrite` (disk > 80 %, memory > 85 % for 10 min, ContainerHealth, Status), then a test
      notification. **Check:** a second run reports no changes and creates no duplicate alerts; the
      test notification arrives on the ntfy topic. (Every write is guarded by a read of the hub's
      state, so the second run is `changed=0`; the test notification goes out only when the webhook
      was just set.)
- [x] Heartbeat: systemd service + timer (5 min) pinging `heartbeat_url`, `/fail` when any container
      of `karpathy-app` **or** `karpathy-monitoring` isn't running (and healthy, if it has a healthcheck);
      skipped when unset (on `local`, set it to a separate
      healthchecks.io test check for the alert test below). **Check:** `systemctl list-timers` shows it;
      `systemd-analyze verify` clean. (Built; `verify` clean; with a throwaway local listener as the URL,
      the script posts `/fail` with "karpathy-app: no containers". With the healthchecks.io test check
      `karpathy-local` (user, 2026-10-01): `list-timers` shows it every 5 min.)
- [ ] **Check (alerts, on the VM with the test ntfy topic):** a `karpathy-app` container made
      unhealthy → Beszel ContainerHealth alert; `docker stop karpathy-app-backend-1` → heartbeat
      `/fail` → healthchecks.io alert (Beszel ignores stopped containers); stopping the Beszel hub → the
      same `/fail` alert; `fallocate` `/srv/vaults` past
      80 % → disk alert, then freed → "below threshold"; the same on `/`; stopping the timer →
      missed-heartbeat alert after the grace period. (Done: backend frozen (SIGSTOP as uid 1000) →
      "Unhealthy container karpathy-app-backend-1 on local 🔴" after 105 s, "healthy ✅" 63 s after
      it resumed; `/srv/vaults` → above/below threshold. Backend stopped → "karpathy-local is DOWN"
      (failure signal) on ntfy after 11 s, UP after the next ping; Beszel hub stopped → DOWN, then UP.
      **Open:** the missed-heartbeat alert (stopping the VM when parking on 2026-10-01 should raise it
      about 10 min later: check ntfy/healthchecks.io, then tick). `/` skipped: ~28 GB to fill, the Mac
      has 36 GiB free.)

## Phase 7: Hetzner (once the server exists)

Starts only after the server is booked. First settle the open points from architecture §5.4
(bootstrap plays, Tailscale key and `tagOwners`, whether a hand-built server exists) and update this
phase.

- [ ] Role `tailscale`: official apt repo, `tailscale up --authkey` (tagged, pre-approved), facts for
      the tailnet IP → `bind_ip`. `just deploy hetzner --bootstrap` path (root on the public IP first,
      then `deploy@karpathy`).
- [ ] Fill the `hetzner` inventory and vault (tokens from prod-env §8.1, Tailscale key, ntfy topic,
      healthchecks.io UUID). **Check:** `just deploy-check hetzner` runs without errors.
- [ ] First deploy against the real server (with the user present): bootstrap, then detach
      `setup-ssh`. **Check:** the prod-env §8.9 checks (iPad loads the app, off-tailnet times out,
      reboot comes back healthy), `version` correct, the hub shows the server, a test alert reaches the phone.
- [ ] If the server was already set up by hand following the runbook: run against it with
      `deploy-check` first and reconcile the diff (named `vaults` volume vs bind mount, existing
      `/opt/karpathy.app` checkout) before the first real deploy.

## Phase 8: docs

- [ ] README: "Deploying" section (`just release`, `just deploy`, `just vm`, the Keychain password
      setup, rollback). Prod-env report §8: replace 8.3–8.10 with a pointer to `just deploy` and keep
      the manual account and booking steps; bump `edited`.
- [x] `CONTEXT.md`: an "Operations" section with the terms from [domain.md](domain.md).
- [x] `/spec:adversarial-code-review` against this spec; fix findings. (Run 2026-10-01 over
      `9e492d4..0c13769`. Fixed:
      - **Hetzner certificates:** the proxy (root without CAP_DAC_OVERRIDE) couldn't read a
        1000-owned DNS token; it's root-owned now.
      - **Fail closed:** app and monitoring assert a non-empty `bind_ip`; `base` refuses to harden
        sshd on a server with no deploy keys.
      - **`deploy-check`:** works against another version (smoke check skipped in check mode; image
        check from the Mac).
      - **Pull first:** images are pulled before `current` switches.
      - **Retention:** counts the most recently *deployed* releases and also removes their images.
      - **Releases:** `:latest` and "Latest" only move forward (hotfixes on older lines don't take
        them); workflow permissions are read-only except for the push and release jobs.
      - **Boot:** `nofail` on the vaults mount, and Docker `RequiresMountsFor=/srv/vaults`.
      - **Small ones:** `deploy` accepts `v0.3.0`; `.env` quoting; Gatus honours `https_port`;
        `deploy_gid`; `deploy-e2e` stops on a missing token and takes `E2E_EXPECT_VERSION`; a clear
        message when there is no final release yet.

      Not changed:
      - No automatic rollback: §5.2 decided that.
      - Beszel has no off switch yet: not needed for either target.
      - The Beszel token travels in a query string to the local hub.
      - `gatus.yaml` (with the ntfy topic) stays 0644 until Phase 7 shows which user Gatus runs as.
      - The `release` and `just release` version rules are duplicated.
      - DNS provider: the prod-env report named GoDaddy, the image had Cloudflare. **Decided GoDaddy**
        (user, 2026-10-01): image, compose and Caddyfile defaults switched, `caddy validate` of the
        GoDaddy block passes, and secret files carry no trailing newline.)

System docs are updated at `/spec:archive`.
