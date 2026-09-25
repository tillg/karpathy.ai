import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// Offline = read-only cache of the vault list, file trees and recently opened notes (mvp §3.1).
// Workbox keys the cache by URL only, so the Authorization header doesn't matter for lookups.

export default defineConfig({
  // Icons live in the repo-level assets folder; served as-is at the site root.
  publicDir: '../../assets/icons',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'karpathy.ai',
        short_name: 'karpathy.ai',
        description: 'Markdown vaults with an AI chat',
        theme_color: '#0f1e33',
        background_color: '#f2f2f7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Serialized into sw.js: must not reference outer variables.
            urlPattern: ({ url, request }) => request.method === 'GET' && /^\/api\/vaults(\/[^/]+\/(files|file))?$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'vault-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 300 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    // Behind the dev proxy (https://localhost:8443) the HMR socket goes through Caddy.
    ...(process.env.HMR_CLIENT_PORT ? { hmr: { clientPort: Number(process.env.HMR_CLIENT_PORT), protocol: 'wss' } } : {}),
    // http-proxy pipes chunked responses through, so NDJSON streams aren't buffered.
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:8788', changeOrigin: true } },
  },
  test: { include: ['src/**/*.test.ts'] },
});
