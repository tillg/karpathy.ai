# karpathy.app development commands. `just` lists them.

prodtest_compose := "docker compose -p karpathy-app-prodtest -f deploy/compose.yml -f deploy/compose.prodtest.yml"

# List all recipes
default:
    @just --list

# Install the npm workspace dependencies (after clone or in a fresh worktree)
install:
    npm install

# Dev stack on https://localhost:8443: `just dev` starts it; `just dev down|logs|ps|token`
dev action="up":
    deploy/dev.sh {{action}}

# Lint, typecheck and unit + integration tests
check:
    npm run lint
    npm run typecheck
    npm test

# Unit + integration tests (needs Docker); extra args go to the test runner
test *args:
    npm test -- {{args}}

# Playwright e2e against the running dev stack; extra args go to Playwright
e2e *args:
    npx playwright test {{args}}

# Prod images on https://localhost:9443, next to the dev stack: `just prodtest` starts it; `just prodtest down|e2e`
prodtest action="up":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{action}}" in
      up)
        mkdir -p tmp/prodtest/secrets
        [ -s tmp/prodtest/secrets/bearer_token ] || openssl rand -hex 24 > tmp/prodtest/secrets/bearer_token
        touch tmp/prodtest/secrets/github_token tmp/prodtest/secrets/dns_api_token
        {{prodtest_compose}} up -d --build
        echo "App: https://localhost:9443  token: $(cat tmp/prodtest/secrets/bearer_token)"
        ;;
      down) {{prodtest_compose}} down -v ;;
      e2e) E2E_BASE_URL=https://localhost:9443 E2E_TOKEN_FILE=tmp/prodtest/secrets/bearer_token npx playwright test ;;
      *) echo "usage: just prodtest [up|down|e2e]" >&2; exit 1 ;;
    esac
