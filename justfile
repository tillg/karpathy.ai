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
      e2e) E2E_BASE_URL=https://localhost:9443 E2E_TOKEN_FILE=tmp/prodtest/secrets/bearer_token E2E_BACKEND_CONTAINER=karpathy-app-prodtest-backend-1 npx playwright test ;;
      *) echo "usage: just prodtest [up|down|e2e]" >&2; exit 1 ;;
    esac

# Cut a release: tags v<version> (X.Y.Z or X.Y.Z-rc.N) on HEAD, pushes the tag, prints the workflow run
release version:
    #!/usr/bin/env bash
    set -euo pipefail
    v="{{version}}"
    [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]] || { echo "version must be X.Y.Z or X.Y.Z-rc.N (no v)" >&2; exit 1; }
    [ -z "$(git status --porcelain)" ] || { echo "working tree is dirty: commit first" >&2; exit 1; }
    git fetch -q origin main
    # Final releases only from main; release candidates may come from any commit.
    if [[ "$v" != *-rc.* ]]; then
      git merge-base --is-ancestor HEAD origin/main || { echo "HEAD is not on origin/main: a final release must be" >&2; exit 1; }
    fi
    git tag -a "v$v" -m "v$v"
    git push origin "v$v"
    sleep 5
    gh run list --workflow release.yml --limit 1 --json url --jq '.[0].url'

# Local deploy target VM (Lima): `just vm up` (create once, then start), `down` (stop), `reset` (recreate), `ssh [-- cmd]`
[positional-arguments]
vm action *args:
    #!/usr/bin/env bash
    set -euo pipefail
    shift
    name=karpathy-vm
    up() {
      mkdir -p tmp/dev/remotes
      if limactl list -q | grep -qx "$name"; then limactl start "$name"
      else limactl start --tty=false --name "$name" --set ".mounts[0].location = \"$PWD/tmp/dev/remotes\"" deploy/lima/karpathy-vm.yaml
      fi
    }
    case "{{action}}" in
      up) up ;;
      down) limactl stop "$name" ;;
      reset) limactl delete -f "$name" 2>/dev/null || true; up ;;
      ssh) [ "${1:-}" = "--" ] && shift; limactl shell "$name" "$@" ;;
      *) echo "usage: just vm [up|down|reset|ssh [-- cmd]]" >&2; exit 1 ;;
    esac

# Deploy a release to a target (local|hetzner): `just deploy local [X.Y.Z] [--only app|monitoring]`
deploy target *args:
    deploy/ansible/deploy.sh run {{target}} {{args}}

# Dry run of `just deploy` (check mode with diff): changes nothing
deploy-check target *args:
    deploy/ansible/deploy.sh check {{target}} {{args}}
