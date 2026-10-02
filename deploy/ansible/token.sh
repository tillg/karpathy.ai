#!/usr/bin/env bash
# `just token <target> [--qr]`: copies the target's access token (from its vault) to the clipboard.
# --qr also prints a QR code of the login link <app_url>/#token=…: scan it on a phone or iPad and the
# app stores the token and opens. The link is a credential: don't screenshot or share it.
set -euo pipefail
cd "$(dirname "$0")"
target=$1 qr=${2:-}
[ -d "inventories/$target" ] || { echo "unknown target: $target (have: $(ls inventories | xargs))" >&2; exit 1; }
vars=$(ansible-inventory -i "inventories/$target" --vault-id "$target@vault-pass-client.sh" --list </dev/null 2>/dev/null \
  | jq '._meta.hostvars | to_entries[0].value')
token=$(jq -r '.vault_bearer_token // empty' <<<"$vars")
url=$(jq -r '.app_url // empty' <<<"$vars")
[ -n "$token" ] || { echo "no token in the $target vault (Keychain item karpathy-ansible-$target?)" >&2; exit 1; }
printf %s "$token" | pbcopy
echo "Token for $target copied to the clipboard."
if [ "$qr" = --qr ]; then
  command -v qrencode >/dev/null || { echo "QR code needs qrencode: brew install qrencode" >&2; exit 1; }
  echo "Login link for $url, scan it with the device's camera:"
  qrencode -t ansiutf8 -m 2 "$url/#token=$token"
elif [ -n "$qr" ]; then
  echo "unknown option $qr (only --qr)" >&2; exit 1
fi
