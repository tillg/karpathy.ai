#!/usr/bin/env bash
# Dev stack: https://localhost:8443 (Caddy internal CA), hot reload, local Ollama model.
# Usage: deploy/dev.sh [up|down|logs|token]
set -euo pipefail
cd "$(dirname "$0")"
compose() { docker compose -f compose.yml -f compose.dev.yml "$@"; }

case "${1:-up}" in
  up)
    mkdir -p secrets ../tmp/dev/remotes
    [ -s secrets/bearer_token ] || openssl rand -hex 24 > secrets/bearer_token
    touch secrets/github_token secrets/dns_api_token
    compose up -d --build
    # Pull the dev model once (~2 GB) into the ollama volume.
    compose exec -T ollama ollama list | grep -q 'qwen2.5:3b' || compose exec -T ollama ollama pull qwen2.5:3b
    echo "App: https://localhost:8443  token: $(cat secrets/bearer_token)"
    ;;
  down) compose down ;;
  logs) compose logs -f ;;
  token) cat secrets/bearer_token ;;
  *) echo "usage: $0 [up|down|logs|token]" >&2; exit 1 ;;
esac
