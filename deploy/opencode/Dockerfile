# opencode harness, pinned (the server API moves fast). Stock image on purpose: it has no
# git, and without git opencode can't find the worktree, so `external_directory: deny` also
# confines the AI to a subfolder vault root (spike-opencode.md, finding 1). Skill deps come in M5.
FROM ghcr.io/anomalyco/opencode:1.18.25
ARG APP_UID=1000
ARG APP_GID=1000
# Mount points owned by the app user, so fresh named volumes inherit the ownership.
RUN mkdir -p /vaults /data && chown ${APP_UID}:${APP_GID} /vaults /data
# Managed config dir: merged last, so a vault's own opencode.json can't override it.
COPY deploy/opencode/opencode.json /etc/opencode/opencode.json
# Custom tools (open_note) in a global config dir that comes only from the image. opencode writes
# .gitignore/package.json into every config dir and installs @opencode-ai/plugin there on startup, so
# one throwaway start populates it now; read-only afterwards, it loads offline.
COPY deploy/opencode/tools/ /opt/opencode-config/opencode/tools/
COPY deploy/opencode/lib/ /opt/opencode-config/opencode/lib/
RUN set -e; export XDG_CONFIG_HOME=/opt/opencode-config HOME=/tmp/bake XDG_DATA_HOME=/tmp/bake/data OPENCODE_MODEL=none/none; \
    (opencode serve --hostname 127.0.0.1 --port 4097 >/dev/null 2>&1 &); ok=; \
    for i in $(seq 120); do \
      if wget -qO- 'http://127.0.0.1:4097/experimental/tool/ids?directory=/tmp' 2>/dev/null | grep -q '"open_note"'; then ok=1; break; fi; sleep 1; \
    done; \
    pkill opencode || true; test -n "$ok"; \
    test -d /opt/opencode-config/opencode/node_modules/@opencode-ai/plugin; \
    rm -rf /tmp/bake; chmod -R a-w,a+rX /opt/opencode-config
# HOME is an empty tmpfs (compose): no global ~/.claude or ~/.config/opencode.
ENV HOME=/home/app XDG_DATA_HOME=/data XDG_CONFIG_HOME=/opt/opencode-config
USER ${APP_UID}:${APP_GID}
WORKDIR /vaults
ENTRYPOINT ["opencode"]
CMD ["serve", "--hostname", "0.0.0.0", "--port", "4096"]
