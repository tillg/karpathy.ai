// L2 extra: can an HTTPS-hosted PWA call a local Ollama over plain http? (mixed content / local network access)
import { createServer } from 'vite'; import basicSsl from '@vitejs/plugin-basic-ssl';
import { chromium, webkit } from '@playwright/test'; import { writeFileSync } from 'node:fs';
const s = await createServer({ plugins: [basicSsl()], server: { port: 5443, strictPort: true, https: true }, logLevel: 'warn' }); await s.listen();
const out = {};
for (const [n, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await bt.launch(); const c = await b.newContext({ ignoreHTTPSErrors: true }); const p = await c.newPage();
  await p.goto('https://localhost:5443/gpu.html');
  out[n] = await p.evaluate(async () => {
    const res = {};
    for (const u of ['http://localhost:11435/api/tags', 'http://127.0.0.1:11435/api/tags']) {
      try { const r = await fetch(u); res[u] = `response ${r.status}`; } catch (e) { res[u] = `blocked ${e}`; }
    }
    return res;
  });
  console.log(n, JSON.stringify(out[n])); await b.close();
}
writeFileSync('results/L2-mixed-content.json', JSON.stringify(out, null, 2)); await s.close();
