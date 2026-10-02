// Runs spike pages in headless Chromium + WebKit, writes results/<spike>-<browser>.json.
// Usage: node scripts/run.mjs [cors|gpu|search|agent|lifecycle ...]   (default: all)
import { createServer } from 'vite';
import { chromium, webkit } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const want = process.argv.slice(2).length ? process.argv.slice(2) : ['cors', 'gpu', 'search', 'agent', 'lifecycle'];
const REPEAT = Number(process.env.REPEAT ?? 3);
const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'warn' });
await server.listen();
const URL = 'http://localhost:5199';
const save = (n, b, d) => { writeFileSync(`results/${n}-${b}.json`, JSON.stringify(d, null, 2)); console.log(`== ${n} ${b}`, JSON.stringify(d).slice(0, 600)); };
for (const [bname, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  // Persistent context: WebKit refuses OPFS in ephemeral contexts (see scripts/webkit-opfs-ephemeral.mjs).
  const ctx = await bt.launchPersistentContext(mkdtempSync(`${tmpdir()}/spike-${bname}-`));
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('console', (m) => m.type() === 'error' && console.log(`[${bname} console]`, m.text().slice(0, 200)));
  const open = async (p, fn) => { await page.goto(`${URL}/${p}.html`); await page.waitForFunction((f) => typeof window[f] === 'function', fn); };
  if (want.includes('cors')) { await open('cors', 'runCors'); save('L1-cors', bname, await page.evaluate(() => window.runCors())); }
  if (want.includes('gpu')) { await open('gpu', 'runGpu'); save('L6-gpu', bname, await page.evaluate(() => window.runGpu())); }
  if (want.includes('search')) { await open('search', 'runSearch'); save('L5-search', bname, await page.evaluate(() => window.runSearch())); }
  if (want.includes('agent')) {
    await open('agent', 'runAgent'); const runs = [];
    const variants = [['plain', false], ['skill', false], ['skill', true]]; // skill+true = skills also exposed as tools
    for (const impl of ['sdk', 'fetch']) for (const [task, st] of variants) for (let i = 0; i < REPEAT; i++) {
      const r = await page.evaluate(([a, b, c]) => window.runAgent(a, b, c), [impl, task, st]); runs.push(r);
      console.log(bname, impl, task, st ? 'skill-tools' : '', i, r.error ? 'ERROR ' + r.error.slice(0, 200) : `ok=${r.verify.ok} steps=${r.steps} ms=${r.ms} tools=${r.tools.map((t) => t.tool).join(',')}`);
    }
    save('L3-agent', bname, runs);
  }
  if (want.includes('lifecycle')) {
    await open('agent', 'startStream');
    // Baseline: uninterrupted stream.
    await page.evaluate(() => window.startStream()); const base = await page.evaluate(() => window.__stream);
    // Interrupted: after 1.5 s, hide/freeze the page for 8 s, then resume.
    const p = page.evaluate(() => window.startStream());
    await page.waitForTimeout(1500);
    let method;
    if (bname === 'chromium') {
      const cdp = await ctx.newCDPSession(page); method = 'CDP Page.setWebLifecycleState frozen 8s';
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); await new Promise((r) => setTimeout(r, 8000));
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    } else {
      method = 'no freeze API in WebKit: fake visibilitychange(hidden) event only, 8s';
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForTimeout(8000);
    }
    await p; const s = await page.evaluate(() => window.__stream);
    const gap = (c) => c.slice(1).reduce((m, x, i) => Math.max(m, x - c[i]), 0);
    save('L4-lifecycle', bname, { method, baseline: { chunks: base.chunks.length, totalMs: base.chunks.at(-1), maxGapMs: gap(base.chunks), error: base.error },
      interrupted: { chunks: s.chunks.length, totalMs: s.chunks.at(-1), maxGapMs: gap(s.chunks), error: s.error, events: s.events } });
  }
  await ctx.close();
}
await server.close();
