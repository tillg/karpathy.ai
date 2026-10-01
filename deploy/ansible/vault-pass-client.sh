#!/usr/bin/env bash
# Ansible Vault password client: Ansible calls it with `--vault-id <target>` (the -client suffix
# tells it to). The password per target lives in the macOS Keychain:
#   security add-generic-password -a "$USER" -s karpathy-ansible-<target> -w
# CI sets ANSIBLE_VAULT_PASSWORD to a dummy value for syntax checks.
set -euo pipefail
[ -n "${ANSIBLE_VAULT_PASSWORD:-}" ] && { echo "$ANSIBLE_VAULT_PASSWORD"; exit 0; }
id=""
while [ $# -gt 0 ]; do case "$1" in --vault-id) id="$2"; shift 2 ;; *) shift ;; esac; done
[ -n "$id" ] || { echo "vault-pass-client.sh: no --vault-id given" >&2; exit 1; }
security find-generic-password -s "karpathy-ansible-$id" -w
