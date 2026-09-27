#!/usr/bin/env bash
# L1: CORS preflight per provider, no API keys. Prints status + ACAO/ACAH headers.
O=http://localhost:5199
pre() { # name url method headers
  printf '%-28s ' "$1"
  curl -s -o /dev/null -D - -X OPTIONS "$2" -H "Origin: $O" -H "Access-Control-Request-Method: $3" \
    -H "Access-Control-Request-Headers: $4" --max-time 15 \
  | tr -d '\r' | awk 'NR==1{s=$2} tolower($0)~/^access-control-allow-(origin|headers|methods)/{h=h" | "$0} END{print "status="s h}'
}
pre anthropic                 https://api.anthropic.com/v1/messages POST "content-type,x-api-key,anthropic-version"
pre anthropic+direct-header   https://api.anthropic.com/v1/messages POST "content-type,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access"
pre openai                    https://api.openai.com/v1/chat/completions POST "content-type,authorization"
pre openrouter                https://openrouter.ai/api/v1/chat/completions POST "content-type,authorization"
pre gemini                    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent" POST "content-type,x-goog-api-key"
pre gemini-openai-compat      https://generativelanguage.googleapis.com/v1beta/openai/chat/completions POST "content-type,authorization"
pre mistral                   https://api.mistral.ai/v1/chat/completions POST "content-type,authorization"
pre groq                      https://api.groq.com/openai/v1/chat/completions POST "content-type,authorization"
