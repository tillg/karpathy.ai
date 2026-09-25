# Proxy: Caddy (with a DNS provider module for DNS-01) serving the PWA build and /api.
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/web --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY assets assets
RUN npm run build -w apps/web

FROM caddy:2.10-builder AS caddy
ARG DNS_PROVIDER=cloudflare
RUN xcaddy build --with github.com/caddy-dns/${DNS_PROVIDER}

FROM caddy:2.10-alpine
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY --from=web /app/apps/web/dist /srv
COPY deploy/proxy/Caddyfile /etc/caddy/Caddyfile
