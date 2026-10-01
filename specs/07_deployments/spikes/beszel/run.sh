#!/usr/bin/env bash
# Beszel v0.20 spike: provision hub + agent + ntfy alerts with no UI clicks, from scratch.
# This is the sequence the Ansible `monitoring` role has to reproduce. Usage: ./run.sh [down]
set -euo pipefail
cd "$(dirname "$0")"
compose() { docker compose --profile agent "$@"; }
H=http://127.0.0.1:18090
NTFY=http://127.0.0.1:18091/spike-alerts/json
EMAIL=spike@example.com PASS=spike-password-123
export UNIVERSAL_TOKEN=11111111-2222-4333-8444-555555555555   # chosen by us, would live in Ansible Vault
WEBHOOK='ntfy://ntfy:80/spike-alerts?scheme=http'
j() { curl -sf -H 'content-type: application/json' "$@"; }

if [ "${1:-}" = down ]; then HUB_KEY= compose down -v; rm -rf .spike; exit; fi

# 0. Fresh state; pre-generated hub key (in prod: from the vault).
HUB_KEY= compose down -v >/dev/null 2>&1 || true
rm -rf .spike && mkdir .spike && ssh-keygen -q -t ed25519 -N '' -C '' -f .spike/id_ed25519
export HUB_KEY="$(cut -d' ' -f1,2 .spike/id_ed25519.pub)"

# 1. Hub with first user from env.
compose up -d ntfy hub filler >/dev/null
for _ in $(seq 30); do curl -sf $H/api/beszel/first-run >/dev/null && break; sleep 1; done
echo "1 first-run: $(curl -sf $H/api/beszel/first-run)"

# 1b. The env user has role "user"; promote it to admin via the superuser (same credentials).
ST=$(j -X POST $H/api/collections/_superusers/auth-with-password -d "{\"identity\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r .token)
USER_ID=$(curl -sf $H/api/collections/users/records -H "Authorization: $ST" | jq -r '.items[0].id')
echo "1b role: $(j -X PATCH $H/api/collections/users/records/$USER_ID -H "Authorization: $ST" -d '{"role":"admin"}' | jq -r .role)"
T=$(j -X POST $H/api/collections/users/auth-with-password -d "{\"identity\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r .token)
echo "1c hub key matches ours: $([ "$(curl -sf $H/api/beszel/info -H "Authorization: $T" | jq -r .key)" = "$HUB_KEY" ] && echo yes || echo NO)"

# 2. Permanent universal token of our choosing.
echo "2 token: $(curl -sf "$H/api/beszel/universal-token?enable=1&permanent=1&token=$UNIVERSAL_TOKEN" -H "Authorization: $T" | jq -c .)"

# 5a. Webhooks BEFORE alert rules, or the first alerts go to the default e-mail address.
# Create the user's settings record (a hub hook fills in defaults, so set our values with a PATCH after).
j -X POST $H/api/collections/user_settings/records -H "Authorization: $T" -d "{\"user\":\"$USER_ID\",\"settings\":{}}" >/dev/null || true
for _ in $(seq 30); do
  SETTINGS_ID=$(curl -sf $H/api/collections/user_settings/records -H "Authorization: $T" | jq -r '.items[0].id // empty')
  [ -n "$SETTINGS_ID" ] && break; sleep 1
done
[ -n "$SETTINGS_ID" ] || { echo "5a FAIL: no user_settings record" >&2; exit 1; }
SETTINGS=$(j -X PATCH $H/api/collections/user_settings/records/$SETTINGS_ID -H "Authorization: $T" \
  -d "{\"settings\":{\"chartTime\":\"1h\",\"emails\":[],\"webhooks\":[\"$WEBHOOK\"]}}" | jq -c .settings)
echo "$SETTINGS" | grep -q ntfy || { echo "5a FAIL: webhook not set" >&2; exit 1; }
echo "5a settings: $SETTINGS"

# 2b. Agent registers itself with the universal token.
compose up -d agent sick >/dev/null
for _ in $(seq 30); do
  SYS=$(curl -sf "$H/api/collections/systems/records" -H "Authorization: $T" | jq -r '.items[0] | select(.status=="up") | .id')
  [ -n "$SYS" ] && break; sleep 2
done
echo "2b system: $(curl -sf "$H/api/collections/systems/records" -H "Authorization: $T" | jq -c '.items[0] | {name,status}')"

# 3. Alert rules through the API.
for a in '"name":"Disk","value":80,"min":1' '"name":"Memory","value":85,"min":10' '"name":"Status","value":0,"min":1' '"name":"ContainerHealth","value":0,"min":1'; do
  j -X POST $H/api/beszel/user-alerts -H "Authorization: $T" -d "{$a,\"systems\":[\"$SYS\"],\"overwrite\":true}" >/dev/null
done
echo "3 alerts: $(curl -sf $H/api/collections/alerts/records -H "Authorization: $T" | jq -c '[.items[] | "\(.name)>\(.value)/\(.min)m"]')"

# 4. Extra filesystem seen by the agent.
sleep 65   # first 1-minute stats record
echo "4 efs: $(curl -sf "$H/api/collections/systems/records" -H "Authorization: $T" | jq -c '.items[0].info | {dp,efs}')"

# 5b. Test notification reaches ntfy.
S=$(date +%s)
j -X POST $H/api/beszel/test-notification -H "Authorization: $T" -d "{\"url\":\"$WEBHOOK\"}" >/dev/null
sleep 2
echo "5b ntfy: $(curl -s "$NTFY?poll=1&since=$S" | jq -c '{title,message}')"
