#!/bin/sh
# opencode reads its server password only from env. Order: the compose secret file, else an
# OPENCODE_SERVER_PASSWORD already in env (tests), else no auth (the image's bake step). Never empty.
if [ -e /run/secrets/opencode_password ]; then
  # Fail closed: a secret that is there but empty or unreadable must not start opencode without auth.
  OPENCODE_SERVER_PASSWORD="$(cat /run/secrets/opencode_password)" || exit 1
  [ -n "$OPENCODE_SERVER_PASSWORD" ] || { echo "opencode_password secret is empty" >&2; exit 1; }
  export OPENCODE_SERVER_PASSWORD
fi
[ -n "$OPENCODE_SERVER_PASSWORD" ] || unset OPENCODE_SERVER_PASSWORD
exec opencode "$@"
