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
# HOME is an empty tmpfs (compose): no global ~/.claude or ~/.config/opencode.
ENV HOME=/home/app XDG_DATA_HOME=/data
USER ${APP_UID}:${APP_GID}
WORKDIR /vaults
ENTRYPOINT ["opencode"]
CMD ["serve", "--hostname", "0.0.0.0", "--port", "4096"]
