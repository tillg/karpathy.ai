#!/usr/bin/env bash
# Spike F1: RAM/disk footprint of the PROD images (compose.prodtest.yml), to size a server.
# Needs the dev stack running (Ollama for the chat turn) and tmp/dev/remotes/tillg/mylife_wiki.git.
# Run from the repo root:  specs/research/prod-env/spikes/footprint.sh | tee specs/research/prod-env/spikes/footprint.out.txt
# Tears the prodtest project down (incl. its volumes) at the end; KEEP=1 leaves it running.
set -euo pipefail
P=karpathy-app-prodtest
C=(docker compose -p $P -f deploy/compose.yml -f deploy/compose.prodtest.yml)
mkdir -p tmp/prodtest/secrets
[ -s tmp/prodtest/secrets/bearer_token ] || openssl rand -hex 24 > tmp/prodtest/secrets/bearer_token
touch tmp/prodtest/secrets/github_token tmp/prodtest/secrets/dns_api_token
T=$(cat tmp/prodtest/secrets/bearer_token)
api() { curl -sk -H "Authorization: Bearer $T" -H 'content-type: application/json' "$@"; }
B=https://localhost:9443/api
stats() {
  echo "--- $1 ($(date +%T))"
  docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' | grep "^$P-"
  # docker stats counts active page cache; anon = real process memory, file = reclaimable cache.
  for s in backend opencode; do
    echo "  $s cgroup: $(docker exec $P-$s-1 sh -c 'grep -E "^(anon|file) " /sys/fs/cgroup/memory.stat' | awk '{printf "%s=%dMiB ", $1, $2/1048576}')"
  done
}

"${C[@]}" down -v >/dev/null 2>&1 || true
"${C[@]}" up -d --build --wait >/dev/null 2>&1
echo "images:"; docker images --format '{{.Repository}}\t{{.Size}}' | grep "^$P-"
sleep 20; stats "cold idle, no vaults"

s=$(date +%s)
api -X POST $B/vaults -d '{"name":"Life","repo":"tillg/mylife_wiki"}' >/dev/null
for i in $(seq 1 150); do api $B/vaults | grep -q '"state":"ready"' && break; sleep 2; done
echo "clone of mylife_wiki (file://, 1.8 GB .git): $(( $(date +%s) - s )) s"
docker exec $P-backend-1 du -sh /vaults
sleep 20; stats "idle, 1 vault (3 GB) cloned"

ID=$(api $B/vaults | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].id))')
CHAT=$(api -X POST $B/vaults/$ID/chats -d '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).chatId))')
s=$(date +%s)
api -X POST $B/vaults/$ID/chats/$CHAT/prompt -d '{"text":"List the top-level folders of this vault and read README.md. Answer in two sentences."}' >/dev/null
peak=""
for i in $(seq 1 90); do
  line=$(docker stats --no-stream --format '{{.MemUsage}}' $P-opencode-1 | awk '{print $1}'); peak="$peak $line"
  api $B/vaults/$ID/chats/$CHAT | grep -qE '"turn":"(running|queued)"' || break
  sleep 2
done
echo "chat turn: $(( $(date +%s) - s )) s; opencode mem samples:$(echo $peak | tr ' ' '\n' | grep -E "MiB|GiB" | sort -h | tail -1)"
echo "answer: $(api $B/vaults/$ID/chats/$CHAT | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log(c.turn, JSON.stringify(c.messages.at(-1)).slice(0,400))})')"
stats "after 1 chat turn"
echo "disk:"; docker system df --format '{{.Type}}\t{{.Size}}' ; docker exec $P-opencode-1 du -sh /data
[ -n "${KEEP:-}" ] || "${C[@]}" down -v >/dev/null 2>&1
