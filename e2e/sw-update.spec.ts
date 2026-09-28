import { expect, openApp, test } from './helpers';

// Lets context.route() answer the service-worker script fetch (Chromium; read at browser launch).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

// Same Chromium-only flag as offline.spec.ts: the SW script is refused over the self-signed cert otherwise.
test.use({ launchOptions: async ({ browserName }, use) => use(browserName === 'chromium' ? { args: ['--ignore-certificate-errors'] } : {}) });

// Safari kept showing an old build: a new service worker took over, but the open page never reloaded.
test('a new service worker taking over reloads the open page', async ({ page, context, vault, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit cannot route the service-worker script fetch');
  // Stands in for a new deploy: a worker that installs, skips waiting and claims the open page.
  await context.route('**/e2e-new-sw.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: "self.skipWaiting(); self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));",
  }));
  await openApp(page, vault.id);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => { (window as unknown as { staleMarker: boolean }).staleMarker = true; });
  await page.evaluate(() => navigator.serviceWorker.register('/e2e-new-sw.js', { scope: '/' }));
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''), { timeout: 20_000 }).toContain('e2e-new-sw.js');
  await expect.poll(() => page.evaluate(() => (window as unknown as { staleMarker?: boolean }).staleMarker ?? false), { timeout: 20_000 }).toBe(false);
});
