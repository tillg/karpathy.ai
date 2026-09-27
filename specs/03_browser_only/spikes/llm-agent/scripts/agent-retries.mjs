// L3 extra: N retries of the plain task at temperature>0 (does qwen2.5:3b ever do it cleanly?). Usage: node scripts/agent-retries.mjs [N] [temp]
import { createServer } from 'vite'; import { chromium, webkit } from '@playwright/test'; import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os';
const N = Number(process.argv[2] ?? 8), T = process.argv[3] ?? '0.7', E = process.argv[4] ?? '0'; // E=1: edit_file instead of write_file
const s = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'warn' }); await s.listen();
const out = {};
for (const [n, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const c = await bt.launchPersistentContext(mkdtempSync(`${tmpdir()}/spike-${n}-`)); const p = c.pages()[0] ?? await c.newPage();
  await p.goto(`http://localhost:5199/agent.html?temp=${T}&edit=${E}`); await p.waitForFunction(() => window.runAgent);
  out[n] = [];
  for (const impl of ['sdk', 'fetch']) for (let i = 0; i < N; i++) { const r = await p.evaluate(([a]) => window.runAgent(a, 'plain'), [impl]); out[n].push({ impl, ms: r.ms, steps: r.steps, tools: r.tools?.map((t) => t.tool), verify: r.verify, error: r.error }); }
  const ok = out[n].filter((r) => r.verify?.ok).length, ch = out[n].filter((r) => r.verify?.changed).length;
  console.log(n, `ok ${ok}/${out[n].length}, file changed ${ch}/${out[n].length}`); await c.close();
}
writeFileSync(`results/L3-agent-retries-t${T}-edit${E}.json`, JSON.stringify(out, null, 2)); await s.close();
