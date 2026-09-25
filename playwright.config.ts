import { defineConfig, devices } from '@playwright/test';

// E2E against the running dev stack (`deploy/dev.sh up`, https://localhost:8443, self-signed).
// Every test creates its own throwaway vault from a local bare repo under tmp/dev/remotes/e2e/.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'tmp/test-results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'tmp/playwright-report', open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'https://localhost:8443',
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    browserName: 'chromium',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, grepInvert: /@ipad|@iphone/ },
    { name: 'ipad', use: { browserName: 'chromium', viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true }, grep: /@ipad/ },
    { name: 'iphone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, grep: /@iphone/ },
  ],
});
