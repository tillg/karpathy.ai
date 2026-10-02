#!/usr/bin/env bash
# `vault-get.sh <target> <vault_var>`: one value from a target's encrypted vault (password from the
# Keychain). Only for literal vault_* keys: Jinja expressions in main.yml come back unrendered.
set -euo pipefail
cd "$(dirname "$0")"
target=$1 var=$2
value=$(ansible-inventory -i "inventories/$target" --vault-id "$target@vault-pass-client.sh" --list </dev/null 2>/dev/null \
  | jq -r --arg v "$var" '._meta.hostvars | to_entries[0].value[$v] // empty')
[ -n "$value" ] || { echo "$var not found in the $target vault (Keychain item karpathy-ansible-$target?)" >&2; exit 1; }
printf '%s\n' "$value"
