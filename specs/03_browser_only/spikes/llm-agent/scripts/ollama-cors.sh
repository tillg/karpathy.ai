#!/usr/bin/env bash
# L2: Ollama CORS by Origin (forwarder on 127.0.0.1:11435). No OLLAMA_ORIGINS set in the container.
for O in http://localhost:5199 http://127.0.0.1:5199 https://vault.example.com app://obsidian.md null; do
  for P in /api/chat /v1/chat/completions; do
    printf '%-28s %-22s ' "$O" "$P"
    curl -s -o /dev/null -D - -X OPTIONS "http://127.0.0.1:11435$P" -H "Origin: $O" -H "Access-Control-Request-Method: POST" \
      -H "Access-Control-Request-Headers: content-type,authorization" --max-time 10 \
    | tr -d '\r' | awk 'NR==1{s=$2} tolower($0)~/^access-control-allow-origin/{h=h" "$0} END{print "status="s h}'
  done
done
