import { createServer } from 'vite'; import { webkit } from '@playwright/test'; import { mkdtempSync } from 'node:fs';
const s = await createServer({ server: { port: 5198 }, logLevel: 'warn' }); await s.listen();
const probe = async (p) => { await p.goto('http://localhost:5198/gpu.html'); return p.evaluate(async () => { try { const r = await navigator.storage.getDirectory(); const fh = await r.getFileHandle('a', { create: true }); const w = await fh.createWritable(); await w.write('x'); await w.close(); return 'ok ' + (await (await fh.getFile()).text()); } catch (e) { return String(e); } }); };
const b = await webkit.launch(); console.log('ephemeral:', await probe(await b.newPage())); await b.close();
const c = await webkit.launchPersistentContext(mkdtempSync('/tmp/wkp-')); console.log('persistent:', await probe(c.pages()[0] ?? await c.newPage())); await c.close();
await s.close();
