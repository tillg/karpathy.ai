// Debug helper: node scripts/probe.mjs <engine> <fn> [jsonArgs]
import { chromium, webkit } from '@playwright/test';
import { build } from 'vite';
import { startServers } from './servers.mjs';
const [engine = 'chromium', fn = 'probeFs', args = '[]'] = process.argv.slice(2);
await build({ configFile: new URL('../vite.config.js', import.meta.url).pathname });
const stop = await startServers();
const b = await { chromium, webkit }[engine].launchPersistentContext(new URL(`../tmp/probe-${engine}`, import.meta.url).pathname, { headless: true });
const page = await b.newPage();
page.on('console', (m) => console.log('[console]', m.text().slice(0, 300)));
await page.goto('http://localhost:8787/');
await page.waitForFunction(() => window.spikesReady);
console.log(JSON.stringify(await Promise.race([page.evaluate(([f, a]) => window.spikes[f](...a), [fn, JSON.parse(args)]), new Promise((r) => setTimeout(() => r("TIMEOUT"), +(process.env.PROBE_TIMEOUT ?? 60000)))]), null, 1));
await b.close(); stop();
