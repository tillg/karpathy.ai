# Egress proxy for the opencode container: forwards public destinations only. Squid checks the
# destination IP after DNS resolution on every request, so each redirect hop is checked again.
# Base pinned by digest (alpine 3.22).
FROM alpine@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
RUN apk add --no-cache squid=6.12-r0
COPY deploy/egress/squid.conf /etc/squid/squid.conf
USER squid
EXPOSE 3128
# Foreground, logs to stdout/stderr.
ENTRYPOINT ["squid", "-N", "-f", "/etc/squid/squid.conf"]
