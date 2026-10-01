---
feature: 07_deployments
title: "Beszel spike: results"
status: applying
created: 2026-10-01
edited: 2026-10-01
---

# Beszel spike: results

**Question:** can the Ansible `monitoring` role set up Beszel v0.20 (hub + agent + alerts to ntfy) with
no clicks in the UI? **Answer: yes, all five.** [`run.sh`](run.sh) does it from scratch in about 2
minutes, and that sequence is what the role reproduces.

Run on 2026-10-01 against `henrygd/beszel:0.20.0` and `henrygd/beszel-agent:0.20.0` in Docker on
Rancher Desktop (arm64), not in the Lima VM: there's no VM yet. Alerts went to a local ntfy container,
so nothing left the Mac. The source references are to the `v0.20.0` tag.

## Answers

| # | Question | Result | How |
|---|---|---|---|
| 1 | Admin user without UI | **yes** | `USER_EMAIL` / `USER_PASSWORD` create a PocketBase superuser **and** a regular user with role `user` (`internal/migrations/initial-settings.go`). Promote it: log in as superuser (`POST /api/collections/_superusers/auth-with-password`, same credentials), then `PATCH /api/collections/users/records/<id> {"role":"admin"}`. |
| 2 | Register the system, agent key/token | **yes** | Hub key: put a pre-generated `ssh-keygen -t ed25519` key at `/beszel_data/id_ed25519`, and the hub uses it (`internal/hub/hub.go:161`; verified: `/api/beszel/info` returns our public key). Token: `GET /api/beszel/universal-token?enable=1&permanent=1&token=<uuid>` sets a **permanent token of our choosing**. The agent with `KEY`, `TOKEN` and `SYSTEM_NAME` then registers itself and shows `up`. So both secrets can live in Ansible Vault and the agent starts right after the hub, with no two-step "read the key, then configure the agent". |
| 3 | Alert rules through the API | **yes** | `POST /api/beszel/user-alerts {"name","value","min","systems":[id],"overwrite":true}` for `Disk`, `Memory`, `Status`, `ContainerHealth`. Idempotent with `overwrite`. |
| 4 | Agent reports `/` **and** `/srv/vaults` | **yes** | Mount the filesystem at `/extra-filesystems/<name>:ro` in the agent. The agent logs `Detected disk … mount=/extra-filesystems/vaults` and the hub stores it under `efs`. **One** Disk alert covers both: it fires on the **fullest** filesystem (max of root and all extra filesystems, `internal/alerts/alerts_system.go:72`). |
| 5 | Test alert to ntfy | **yes** | `POST /api/beszel/test-notification {"url":"ntfy://<host>/<topic>"}` is delivered. Real alerts use the Shoutrrr URLs in the user's `user_settings.settings.webhooks`. |

## Alerts seen in ntfy

| Trigger | Message | Delay |
|---|---|---|
| Extra filesystem filled to 90 % (threshold 85 %, `min` 1) | "spike-host disk usage above threshold": "Disk usage averaged 90.00% for the previous 1 minute." | ≤ 1 min |
| Filesystem freed | "spike-host disk usage below threshold" | ≤ 1 min |
| Container healthcheck failing | "Unhealthy container beszel-spike-sick-1 on spike-host 🔴" | ≤ 1 min |
| Container healthy again | "spike-host containers are healthy ✅" | ≤ 1 min |
| Agent stopped | "Connection to spike-host is down 🔴" | ~65 s |

RAM (`docker stats`): hub 16 MB, agent 13 MB.

## Gotchas for the Ansible role

1. **Set the webhooks before the alert rules.** An alert that's already over its threshold fires at the
   next agent update (≤ 1 min). In the first try that happened seconds before the webhook was set, so it
   went to the default address (the user's e-mail, with no SMTP) and was lost.
2. **`user_settings` needs a POST, then a PATCH.** The POST creates the record, but a hub hook replaces our
   settings with defaults (`emails: [<user>]`, no webhooks). The PATCH afterwards sticks. Check the
   result: an unchecked first version of `run.sh` silently created alerts without a webhook.
3. **The env user is not an admin.** Non-admins get `403 "Only admins can send to internal destinations"`
   for private addresses. That doesn't matter for ntfy.sh, but `run.sh` promotes the user anyway (admin also
   gets the heartbeat-status endpoints).
4. **The disk alert doesn't name the filesystem.** The message only says "Disk usage averaged X%". To find
   out which one, open the hub UI (or `df`). There's no separate alert per filesystem.
5. **ContainerHealth only means `unhealthy`.** It's one alert per system ("some container is unhealthy").
   A container that's **stopped**, or has **no healthcheck** (today's `proxy`), never triggers it. Every
   unhealthy container on the host counts, so `EXCLUDE_CONTAINERS` is needed if other projects run there.
6. **Tiny filesystems read wrong.** Sizes are rounded to 0.01 GB: a 64 MB test filesystem at 88 % showed as
   83 %. That doesn't matter at 20 GB.
7. **The agent reconnects by itself.** Started before the hub, it retried and connected within 10 s.

## Consequences for the spec

- Ansible Vault gains: the Beszel hub private key, the universal token and the Beszel user password.
- "Container down" isn't covered by Beszel; the heartbeat's `/fail` (any `karpathy-app` service not
  running/healthy) is what catches it. Gatus covers the proxy (HTTPS 200), since the proxy has no
  healthcheck.
- The Phase 6 check "disk alert naming `/srv/vaults`" is replaced by: filling either filesystem past the
  threshold raises the (single) disk alert.
- Not tested here: the agent on the **host network** (prod), where `HUB_URL` must point at the hub's
  `BIND_IP:8090` or `localhost:8090`. The spike used a compose network. Also untested: Beszel's own
  `HEARTBEAT_URL`, which only proves the hub is alive; the systemd heartbeat stays.

## Re-run

```
./run.sh        # fresh hub + agent + ntfy, provisioned via API; prints one line per check
./run.sh down   # remove containers, volumes and the generated key
```
