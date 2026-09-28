#!/usr/bin/env bash
# Spike 04: what fills the disk besides the vault clones (images, build cache, volumes, logs).
#
# Run (dev stack up):  bash specs/05_prod_env/spikes/04-docker-footprint.sh 2>&1 | tee specs/05_prod_env/spikes/04-docker-footprint.out.txt
# Read-only: docker system df / images / volume sizes / container log sizes. Prunes NOTHING.
set -u
echo "# spike 04 — $(date '+%Y-%m-%d %H:%M') — docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) (Rancher Desktop VM)"
echo; echo "## docker system df (whole daemon — shared with other projects on this machine)"; docker system df
echo; echo "## karpathy-app images + the base images the stack uses"
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep -E 'karpathy|caddy|ollama|socat|node' | sort
echo; echo "## karpathy-app volumes (size via a throwaway alpine container, read-only mounts)"
for v in $(docker volume ls -q | grep '^karpathy-app_'); do
  printf '%-34s %s\n' "$v" "$(docker run --rm -v "$v":/v:ro alpine du -sh /v 2>/dev/null | awk '{print $1}')"
done
echo; echo "## container json logs (default json-file driver, no rotation unless configured)"
for c in $(docker ps --format '{{.Names}}' | grep '^karpathy-app-'); do
  p=$(docker inspect "$c" --format '{{.LogPath}}')
  printf '%-30s %s   log-opts=%s\n' "$c" "$(docker run --rm --privileged --pid=host alpine nsenter -t 1 -m -- du -h "$p" 2>/dev/null | awk '{print $1}')" "$(docker inspect "$c" --format '{{json .HostConfig.LogConfig.Config}}')"
done
echo; echo "## opencode data dir contents (sessions/logs/snapshots)"
docker exec karpathy-app-opencode-1 sh -c 'for d in /data /root/.local/share/opencode /root/.cache; do [ -d "$d" ] && du -sh "$d"/* 2>/dev/null; done' | sort -h | tail -15
echo; echo "## docker VM filesystem"; docker run --rm --privileged --pid=host alpine nsenter -t 1 -m -- df -h /var/lib/docker 2>/dev/null
