// L5: in-browser search over the full mylife_wiki fixture (~3300 .md files).
import MiniSearch from 'minisearch';
import FlexSearch from 'flexsearch';
import { root, writeFile, readFile, listFiles, wipe, workerBulkWrite } from './opfs';
const QUERIES = ['karpathy', 'brest', 'schauspieler', 'obsidian', 'wikilink', 'the'];
const now = () => performance.now();
const r1 = (x: number) => Math.round(x * 10) / 10;
function scan(docs: { path: string; text: string }[], q: string) {
  const re = new RegExp(q, 'i'); const hits: string[] = [];
  for (const d of docs) if (re.test(d.text)) hits.push(d.path);
  return hits;
}
function timeit(fn: () => any, n = 5) { fn(); const t = now(); let out; for (let i = 0; i < n; i++) out = fn(); return { ms: r1((now() - t) / n), out }; }
(window as any).runSearch = async (opts: { opfs?: boolean } = {}) => {
  const res: any = {};
  let t = now(); const docs: { path: string; text: string }[] = await (await fetch('/fixture/all.json')).json();
  res.load = { files: docs.length, chars: docs.reduce((a, d) => a + d.text.length, 0), fetchParseMs: r1(now() - t) };
  // (a) naive in-memory regex scan
  res.naive = QUERIES.map((q) => { const x = timeit(() => scan(docs, q)); return { q, hits: x.out.length, ms: x.ms }; });
  // (a2) from OPFS: write all files, then read all + scan
  if (opts.opfs !== false) {
    await wipe('big'); const r = await root('big');
    t = now(); let fails = 0, firstErr = null as any;
    for (const d of docs) { try { await writeFile(r, d.path, d.text); } catch (e) { fails++; firstErr ??= `${d.path}: ${e}`; } }
    res.opfsWriteAll_createWritable = { ms: r1(now() - t), fails, firstErr };
    await wipe('big'); t = now(); const wb = await workerBulkWrite('big', docs);
    res.opfsWriteAll_workerSyncHandle = { ms: r1(now() - t), ...wb };
    t = now(); const paths = await listFiles(r); res.opfsListMs = r1(now() - t);
    t = now(); const texts = await Promise.all(paths.map(async (p) => ({ path: p, text: await readFile(r, p) }))); res.opfsReadAllMs = r1(now() - t);
    t = now(); const h = scan(texts, 'karpathy'); res.opfsReadAndScanOnce = { files: paths.length, hits: h.length, scanMs: r1(now() - t) };
    await wipe('big');
  }
  // (b) MiniSearch
  t = now();
  const ms = new MiniSearch({ fields: ['path', 'text'], storeFields: ['path'], idField: 'path' });
  ms.addAll(docs); const build = now() - t;
  t = now(); const ser = JSON.stringify(ms); const serMs = now() - t;
  t = now(); MiniSearch.loadJSON(ser, { fields: ['path', 'text'], storeFields: ['path'], idField: 'path' }); const loadMs = now() - t;
  res.minisearch = { buildMs: r1(build), serializedMB: r1(ser.length / 1e6), serializeMs: r1(serMs), loadJSONMs: r1(loadMs),
    queries: QUERIES.map((q) => { const x = timeit(() => ms.search(q, { prefix: true, fuzzy: 0.2 })); return { q, hits: x.out.length, ms: x.ms }; }) };
  // (c) FlexSearch
  t = now();
  const fx = new (FlexSearch as any).Index({ tokenize: 'forward' });
  docs.forEach((d, i) => fx.add(i, d.text)); const fbuild = now() - t;
  let fsize = 0; t = now(); await fx.export((_k: string, v: string) => { fsize += (v ?? '').length; }); const fexp = now() - t;
  res.flexsearch = { buildMs: r1(fbuild), exportMB: r1(fsize / 1e6), exportMs: r1(fexp),
    queries: QUERIES.map((q) => { const x = timeit(() => fx.search(q, { limit: 10000 })); return { q, hits: x.out.length, ms: x.ms }; }) };
  res.heapMB = (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1e6) : null;
  return res;
};
