#!/usr/bin/env bash
# `just deploy <target> [version] [--only app|monitoring]` and `just deploy-check …` (check + diff).
# The version is X.Y.Z (no v); without one the app role takes the newest GitHub release.
set -euo pipefail
cd "$(dirname "$0")"
mode=$1 target=$2
shift 2
version="" tags=()
while [ $# -gt 0 ]; do
  case "$1" in
    --only) tags=(--tags "$2"); shift 2 ;;
    --bootstrap) echo "--bootstrap comes with the Hetzner server (plan Phase 7)" >&2; exit 1 ;;
    -*) echo "unknown option $1" >&2; exit 1 ;;
    *) version=${1#v}; shift ;;  # 0.3.0 or v0.3.0
  esac
done
[ -d "inventories/$target" ] || { echo "unknown target: $target (have: $(ls inventories | xargs))" >&2; exit 1; }
args=(-i "inventories/$target" --vault-id "$target@vault-pass-client.sh" site.yml ${tags[@]+"${tags[@]}"})
[ -n "$version" ] && args+=(-e "app_version=$version")
[ "$mode" = check ] && args+=(--check --diff)
mkdir -p ../../tmp
log="../../tmp/deploy-$target-$(date +%Y%m%d-%H%M%S).log"
echo "log: tmp/${log##*/}"
ansible-playbook "${args[@]}" </dev/null 2>&1 | tee "$log"
