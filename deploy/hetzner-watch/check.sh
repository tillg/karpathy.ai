#!/usr/bin/env bash
# Is a cheaper Hetzner server (Cost-Optimized: CX23, CAX11) bookable in an EU location again?
# Pushes to ntfy when one is; silent otherwise. Runs twice a day via launchd (`just hetzner-watch install`).
# Needs a read-only Hetzner API token in the Keychain:
#   security add-generic-password -a "$USER" -s karpathy-hetzner-api -w
set -euo pipefail
WANT="cx23 cax11"
LOCATIONS="nbg1 fsn1 hel1"
# The hetzner target's alert topic, from its encrypted vault (the topic name is its only protection).
NTFY_TOPIC=$("$(dirname "$0")/../ansible/vault-get.sh" hetzner vault_ntfy_topic)
token=$(security find-generic-password -s karpathy-hetzner-api -w)
api() { curl -sf -H "Authorization: Bearer $token" "https://api.hetzner.cloud/v1/$1"; }
types=$(api 'server_types?per_page=50')
dcs=$(api 'datacenters?per_page=50')
found=$(jq -r --arg want "$WANT" --arg locs "$LOCATIONS" --argjson types "$types" '
  ($want | split(" ")) as $w | ($locs | split(" ")) as $l
  | ($types.server_types | map({key: (.id | tostring), value: .}) | from_entries) as $t
  | .datacenters[] | select(.location.name as $n | $l | index($n))
  | .location.name as $loc
  | .server_types.available[] | $t[tostring] | select(.name as $n | $w | index($n))
  | (.prices[] | select(.location == $loc) | .price_monthly.gross | tonumber * 100 | round / 100) as $p
  | "\(.name | ascii_upcase) in \($loc): €\($p)/month (server only, incl. VAT)"' <<<"$dcs" | sort -u)
echo "$(date '+%Y-%m-%d %H:%M') ${found:-nothing available}"
[ -n "$found" ] || exit 0
curl -sf -o /dev/null -H "Title: Hetzner: cheaper server bookable" -H "Tags: moneybag" \
  -d "$found
Book it, then: just deploy hetzner --bootstrap <ip> (deploy/README.md, "Rebuilding the server"), delete the old server. Stop these: just hetzner-watch uninstall" \
  "https://ntfy.sh/$NTFY_TOPIC"
