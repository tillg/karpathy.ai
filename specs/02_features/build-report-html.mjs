// Builds feature-report.html (interactive) from feature-report.md.
// Run from the repo root: node specs/02_features/build-report-html.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const diagramsDir = join(here, '../../docs/diagrams');
const md = readFileSync(join(here, 'feature-report.md'), 'utf8');

const anchor = t => t.toLowerCase().replace(/[^\w\- ]/g, '').trim().replace(/ /g, '-');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Mermaid source → rendered SVG in docs/diagrams (fallback when the CDN is unreachable).
const svgFor = new Map(readdirSync(diagramsDir).filter(f => f.endsWith('.mmd'))
  .map(f => [readFileSync(join(diagramsDir, f), 'utf8').trim(), `../../docs/diagrams/${f.replace(/\.mmd$/, '.svg')}`]));
const mmd = name => readFileSync(join(diagramsDir, name), 'utf8');

// Scores from the ranking table, positions from the quadrant chart, waves from the roadmap.
const scores = {};
for (const m of md.matchAll(/^\| (\d+) \| .+? \| \[#(\d+)\]\((.+?)\) \| ([SML]) \| (\d) \| (\d) \| (\d) \|$/gm))
  scores[+m[1]] = { issue: +m[2], url: m[3], effort: m[4], fit: +m[5], help: +m[6], cool: +m[7] };
const pos = {};
for (const m of mmd('overview-value-effort.mmd').matchAll(/F(\d+) (.+?): \[([\d.]+), ([\d.]+)\]/g))
  pos[+m[1]] = { short: m[2], x: +m[3], y: +m[4] };
const waves = {}, waveNames = [];
let wave = 0;
for (const line of mmd('overview-roadmap.mmd').split('\n')) {
  const s = line.match(/subgraph W(\d)\["(.+)"\]/);
  if (s) { wave = +s[1]; waveNames[wave] = s[2]; continue; }
  const f = line.match(/^\s+F(\d+)\[/);
  if (f && wave) waves[+f[1]] = wave;
}

// Split into "## " sections.
const sections = [];
for (const line of md.split('\n')) {
  if (line.startsWith('## ')) sections.push({ title: line.slice(3), body: [] });
  else if (sections.length) sections.at(-1).body.push(line);
}
const intro = md.slice(0, md.indexOf('\n## '));

// Markdown rendering: headings get GitHub-style ids, mermaid becomes a live diagram.
const renderer = new marked.Renderer();
renderer.heading = function ({ tokens, depth, text }) {
  return `<h${depth} id="${anchor(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
};
renderer.code = ({ text, lang }) => {
  if (lang === 'mermaid') {
    const src = text.trim();
    return `<figure class="diagram" data-fallback="${esc(svgFor.get(src) || '')}"><pre class="mermaid-src" hidden>${esc(src)}</pre><div class="mermaid-out" role="img" aria-label="Diagram"></div></figure>\n`;
  }
  // Wireframes: pin glyphs outside ASCII/box-drawing to one cell so frames line up in any font.
  if (lang === 'text') return `<pre class="wire"><code>${esc(text).replace(/[^\x00-\x7f\u2500-\u259f]/gu, c => `<span class="g">${c}</span>`)}</code></pre>\n`;
  return `<pre class="code"><code>${esc(text)}</code></pre>\n`;
};
renderer.link = function ({ href, title, tokens }) {
  const ext = /^https?:/.test(href) ? ' target="_blank" rel="noopener"' : '';
  return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${ext}>${this.parser.parseInline(tokens)}</a>`;
};
marked.use({ renderer });

// Drop what the page replaces: SVG image lines (live diagrams instead), <details> wrappers.
const clean = body => body.filter(l => !/^!\[.*\]\(\.\.\/\.\.\/docs\/diagrams\/.+\.svg\)$/.test(l) && !/^<\/?details>|^<details>/.test(l)).join('\n');
const html = text => marked.parse(text);

const features = [], appendices = [];
let howTo = '', overview = '';
for (const s of sections) {
  const m = s.title.match(/^(\d\d)\. (.+)$/);
  if (m) {
    const rank = +m[1];
    let body = clean(s.body).replace(/\n---\s*$/, '');
    const meta = body.match(/^> \*\*Issue:\*\*.*\*\*Seen in:\*\* (.+)$/m);
    body = body.replace(/^> \*\*Issue:\*\*.*$/m, '');
    features.push({ rank, title: m[2], id: anchor(s.title), seen: meta ? meta[1] : '', ...scores[rank], ...pos[rank], wave: waves[rank], html: html(body) });
  } else if (s.title === 'How to read this report') howTo = html(clean(s.body));
  else if (s.title === 'Overview') {
    // Ranking table and value/effort chart are rebuilt interactively.
    let body = clean(s.body);
    body = body.replace(/### Value vs effort[\s\S]*?(?=### Ranking)/, '### Value vs effort\n\n<div id="scatter"></div>\n\n');
    body = body.replace(/### Ranking[\s\S]*?(?=### Suggested roadmap)/, '### Ranking\n\n<div id="ranking"></div>\n\n');
    overview = html(body);
  } else if (s.title.startsWith('Appendix')) appendices.push({ title: s.title, id: anchor(s.title), html: html(clean(s.body).replace(/\n---\s*$/, '')) });
}

const introHtml = html(intro.replace(/^# .+\n/, ''));
const title = intro.match(/^# (.+)$/m)[1];
const data = features.map(({ html, ...f }) => f);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feature Research Report</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Crect width=%2216%22 height=%2216%22 rx=%223%22 fill=%22%235b3fd6%22/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #f7f7f5; --surface: #ffffff; --surface-2: #f0f0ec; --text: #1c1c1a; --muted: #5d5d57;
  --border: #deded8; --accent: #5b3fd6; --accent-soft: #ece8fc; --mark: #fff1a8;
  --s: #1f8a4c; --m: #b86b00; --l: #c2362b; --shadow: 0 1px 2px rgba(0,0,0,.05), 0 4px 16px rgba(0,0,0,.04);
  --mono: "JetBrains Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #121214; --surface: #1b1b1f; --surface-2: #24242a; --text: #ececea; --muted: #a2a29c;
  --border: #33333a; --accent: #a996ff; --accent-soft: #2a2544; --mark: #5a4c00;
  --s: #4cc27f; --m: #f0a53a; --l: #ff7a6e; --shadow: none; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #121214; --surface: #1b1b1f; --surface-2: #24242a; --text: #ececea; --muted: #a2a29c;
  --border: #33333a; --accent: #a996ff; --accent-soft: #2a2544; --mark: #5a4c00;
  --s: #4cc27f; --m: #f0a53a; --l: #ff7a6e; --shadow: none; color-scheme: dark; }
* { box-sizing: border-box; }
html { scroll-padding-top: 16px; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15.5px/1.6 Inter, system-ui, -apple-system, sans-serif; }
a { color: var(--accent); }
code { overflow-wrap: anywhere; font-family: var(--mono); font-size: .88em; background: var(--surface-2); padding: .08em .35em; border-radius: 4px; }
.layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: 100vh; }
aside { position: sticky; top: 0; height: 100vh; overflow-y: auto; border-right: 1px solid var(--border); background: var(--surface); padding: 18px 14px 24px; }
main { padding: 32px clamp(16px, 4vw, 56px) 80px; max-width: 1060px; }
.brand { font-weight: 700; font-size: 15px; margin: 0 0 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.icon-btn { border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 8px; height: 34px; min-width: 34px; cursor: pointer; font: inherit; font-size: 14px; }
.search { width: 100%; height: 38px; border: 1px solid var(--border); border-radius: 9px; padding: 0 12px; background: var(--bg); color: var(--text); font: inherit; }
.search:focus-visible, .chip:focus-visible, .icon-btn:focus-visible, .star:focus-visible, th button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
.chip { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; padding: 3px 11px; font: inherit; font-size: 13px; cursor: pointer; min-height: 30px; }
.chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.count { color: var(--muted); font-size: 12.5px; margin: 8px 2px; }
.nav { list-style: none; margin: 0; padding: 0; }
.nav a { display: grid; grid-template-columns: 26px 1fr auto; gap: 6px; align-items: baseline; padding: 6px 8px; border-radius: 7px; color: var(--text); text-decoration: none; font-size: 13.5px; line-height: 1.35; }
.nav a:hover { background: var(--surface-2); }
.nav a.active { background: var(--accent-soft); }
.nav .r { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 12px; }
.nav .sec a { grid-template-columns: 1fr; color: var(--muted); }
.nav-h { font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 14px 8px 4px; }
.badge { display: inline-block; font-size: 11.5px; font-weight: 600; border-radius: 5px; padding: 0 6px; line-height: 19px; border: 1px solid currentColor; }
.e-S { color: var(--s); } .e-M { color: var(--m); } .e-L { color: var(--l); }
h1 { font-size: clamp(26px, 3.4vw, 36px); line-height: 1.2; margin: 0 0 8px; letter-spacing: -.01em; }
h2 { font-size: 24px; margin: 44px 0 12px; line-height: 1.25; }
h3 { font-size: 17px; margin: 28px 0 8px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 20px clamp(16px, 3vw, 28px); box-shadow: var(--shadow); margin: 22px 0; }
.feature > header { display: flex; gap: 14px; align-items: flex-start; }
.feature > header h2 { margin: 0; font-size: 21px; flex: 1; }
.rank { flex: none; width: 44px; height: 44px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; font-weight: 700; font-size: 17px; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 10px 0 4px 58px; color: var(--muted); font-size: 13.5px; }
.dots { letter-spacing: 1px; color: var(--accent); }
.dots span { color: var(--border); }
.star { border: 0; background: none; font-size: 22px; line-height: 1; cursor: pointer; color: var(--muted); padding: 4px; border-radius: 6px; min-width: 44px; min-height: 44px; }
.star[aria-pressed="true"] { color: #e8a800; }
.fbody { margin-left: 58px; }
.fold { display: none; }
.feature.collapsed .fbody { display: none; }
.feature.collapsed .meta { margin-bottom: 0; }
main pre.wire { font-family: "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace; }
pre code { font: inherit; background: none; padding: 0; }
pre.wire .g { display: inline-block; width: 1ch; text-align: center; overflow: visible; white-space: pre; }
pre.wire, pre.code { font-family: var(--mono); font-size: 12.5px; line-height: 1.22; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 14px; overflow-x: auto; }
figure.diagram { margin: 12px 0; background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 12px; overflow-x: auto; }
:root[data-theme="dark"] figure.diagram { background: var(--surface-2); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) figure.diagram { background: var(--surface-2); } }
figure.diagram svg, figure.diagram img { max-width: 100%; height: auto; display: block; margin: auto; }
.mermaid-out:empty::before { content: "Rendering diagram…"; color: var(--muted); font-size: 13px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { border-bottom: 1px solid var(--border); padding: 7px 8px; text-align: left; vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 12.5px; white-space: nowrap; }
.tablewrap { overflow-x: auto; }
main .card table:not(.tablewrap table) { display: block; overflow-x: auto; }
main { min-width: 0; }
.meta { overflow-wrap: anywhere; }
th button { all: unset; cursor: pointer; }
th button::after { content: " ↕"; opacity: .4; }
th[aria-sort="ascending"] button::after { content: " ↑"; opacity: 1; }
th[aria-sort="descending"] button::after { content: " ↓"; opacity: 1; }
#ranking tbody tr { cursor: pointer; }
#ranking tbody tr:hover { background: var(--surface-2); }
#ranking td.num { font-variant-numeric: tabular-nums; text-align: center; }
.hidden { display: none !important; }
.dim { opacity: .18; }
#scatter { position: relative; }
#scatter svg { width: 100%; height: auto; display: block; }
#scatter .pt { cursor: pointer; }
#scatter .pt circle { stroke: var(--surface); stroke-width: 2; }
#scatter .pt:hover circle, #scatter .pt:focus circle { stroke: var(--text); }
#scatter .pt:focus { outline: none; }
.tip { position: absolute; pointer-events: none; background: var(--text); color: var(--bg); font-size: 12.5px; padding: 6px 9px; border-radius: 7px; max-width: 260px; line-height: 1.35; transform: translate(-50%, calc(-100% - 12px)); }
.legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); margin-top: 6px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
mark { background: var(--mark); color: inherit; border-radius: 2px; }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0 0; }
.menu-btn { display: none; }
.lede { color: var(--muted); }
blockquote { margin: 0; padding: 0 14px; border-left: 3px solid var(--border); color: var(--muted); }
@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  aside { position: fixed; inset: 0 auto 0 0; width: min(88vw, 340px); z-index: 20; transform: translateX(-100%); transition: transform .2s; box-shadow: 0 0 40px rgba(0,0,0,.25); }
  body.nav-open aside { transform: none; }
  .menu-btn { display: inline-flex; position: fixed; right: 16px; bottom: 16px; z-index: 30; height: 48px; min-width: 48px; border-radius: 24px; padding: 0 16px; align-items: center; gap: 6px; background: var(--accent); color: #fff; border: 0; box-shadow: 0 4px 16px rgba(0,0,0,.25); font: inherit; font-weight: 600; }
  main { padding-top: 20px; }
  .meta, .fbody { margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; scroll-behavior: auto !important; } }
@media print { aside, .menu-btn, .toolbar, .star { display: none !important; } .layout { display: block; } .feature.collapsed .fbody { display: block; } }
</style>
</head>
<body>
<div class="layout">
<aside id="sidebar" aria-label="Features">
  <div class="brand"><span>Feature research</span>
    <span><button class="icon-btn" id="theme" title="Toggle light/dark" aria-label="Toggle light or dark theme">◐</button></span></div>
  <input class="search" id="q" type="search" placeholder="Filter features…  ( / )" aria-label="Filter features">
  <div class="filters" role="group" aria-label="Effort">
    <button class="chip" data-effort="S" aria-pressed="false">S effort</button>
    <button class="chip" data-effort="M" aria-pressed="false">M</button>
    <button class="chip" data-effort="L" aria-pressed="false">L</button>
    <button class="chip" id="starOnly" aria-pressed="false">★ Shortlist</button>
  </div>
  <div class="filters" role="group" aria-label="Wave" id="waveChips"></div>
  <div class="count" id="count" aria-live="polite"></div>
  <ul class="nav">
    <li class="nav-h">Report</li>
    <li class="sec"><a href="#top">Introduction</a></li>
    <li class="sec"><a href="#overview">Overview &amp; ranking</a></li>
  </ul>
  <div class="nav-h">Features</div>
  <ul class="nav" id="navList"></ul>
  <div class="nav-h">Appendices</div>
  <ul class="nav">${appendices.map(a => `<li class="sec"><a href="#${a.id}">${esc(a.title)}</a></li>`).join('')}</ul>
</aside>
<main id="top">
  <h1>${esc(title)}</h1>
  <div class="lede">${introHtml}</div>
  <div class="toolbar">
    <button class="chip" id="expandAll">Expand all</button>
    <button class="chip" id="collapseAll">Collapse all</button>
  </div>
  <section class="card">${howTo.replace(/^/, '<h2 id="how-to-read-this-report" style="margin-top:0">How to read this report</h2>')}</section>
  <h2 id="overview">Overview</h2>
  ${overview}
  <div id="features">
  ${features.map(f => `<article class="card feature" id="${f.id}" data-rank="${f.rank}">
    <header><div class="rank" aria-hidden="true">${f.rank}</div><h2>${esc(f.title)}</h2>
      <button class="star" data-rank="${f.rank}" aria-pressed="false" aria-label="Add to shortlist" title="Shortlist">★</button></header>
    <div class="meta">
      <span class="badge e-${f.effort}">Effort ${f.effort}</span>
      <a href="${f.url}" target="_blank" rel="noopener">Issue #${f.issue}</a>
      <span>Wave ${f.wave}</span>
      <span title="Fit / Help / Cool">Fit <b>${f.fit}</b> · Help <b>${f.help}</b> · Cool <b>${f.cool}</b></span>
      <span>Seen in: ${esc(f.seen)}</span>
      <button class="chip fold-btn" aria-expanded="true">Collapse</button>
    </div>
    <div class="fbody">${f.html}</div>
  </article>`).join('\n')}
  </div>
  ${appendices.map(a => `<section class="card"><h2 id="${a.id}" style="margin-top:0">${esc(a.title)}</h2>${a.html}</section>`).join('\n')}
</main>
</div>
<button class="menu-btn" id="menuBtn" aria-controls="sidebar" aria-expanded="false">☰ Features</button>
<script>
const DATA = ${JSON.stringify(data)};
const WAVES = ${JSON.stringify(waveNames)};
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
                set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const state = { q: '', effort: new Set(), wave: new Set(), starOnly: false, stars: new Set(store.get('fr-stars', [])) };
const byRank = Object.fromEntries(DATA.map(f => [f.rank, f]));
const text = Object.fromEntries($$('.feature').map(el => [+el.dataset.rank, el.textContent.toLowerCase()]));

// Sidebar list + wave chips
$('#navList').innerHTML = DATA.map(f => \`<li><a href="#\${f.id}" data-rank="\${f.rank}"><span class="r">\${f.rank}</span><span>\${f.title}</span><span class="badge e-\${f.effort}">\${f.effort}</span></a></li>\`).join('');
$('#waveChips').innerHTML = WAVES.map((w, i) => w ? \`<button class="chip" data-wave="\${i}" aria-pressed="false" title="\${w}">Wave \${i}</button>\` : '').join('');

function matches(f) {
  if (state.effort.size && !state.effort.has(f.effort)) return false;
  if (state.wave.size && !state.wave.has(f.wave)) return false;
  if (state.starOnly && !state.stars.has(f.rank)) return false;
  return !state.q || state.q.split(/\\s+/).every(w => text[f.rank].includes(w));
}
function apply() {
  let n = 0;
  for (const f of DATA) {
    const ok = matches(f); n += ok;
    document.getElementById(f.id).classList.toggle('hidden', !ok);
    $(\`#navList a[data-rank="\${f.rank}"]\`).parentElement.classList.toggle('hidden', !ok);
    $$(\`[data-pt="\${f.rank}"], #ranking tr[data-rank="\${f.rank}"]\`).forEach(e => e.classList.toggle('dim', !ok));
  }
  $('#count').textContent = n === DATA.length ? \`All \${n} features\` : \`\${n} of \${DATA.length} features match\`;
  highlight();
}
function highlight() {
  $$('.feature mark').forEach(m => m.replaceWith(m.textContent));
  $$('.feature .fbody').forEach(b => b.normalize());
  const words = state.q.split(/\\s+/).filter(w => w.length > 2);
  if (!words.length) return;
  const re = new RegExp('(' + words.map(w => w.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')).join('|') + ')', 'gi');
  for (const el of $$('.feature:not(.hidden) .fbody')) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('pre, figure, script') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (!re.test(node.nodeValue)) continue; re.lastIndex = 0;
      const span = document.createElement('span'); span.innerHTML = node.nodeValue.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(re, '<mark>$1</mark>');
      node.replaceWith(...span.childNodes);
    }
  }
}
let qTimer; $('#q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); apply(); }, 120); });
document.addEventListener('click', e => {
  const c = e.target.closest('.chip[data-effort], .chip[data-wave]');
  if (!c) return;
  const [set, v] = c.dataset.effort ? [state.effort, c.dataset.effort] : [state.wave, +c.dataset.wave];
  set.has(v) ? set.delete(v) : set.add(v); c.setAttribute('aria-pressed', set.has(v)); apply();
});
$('#starOnly').addEventListener('click', e => { state.starOnly = !state.starOnly; e.currentTarget.setAttribute('aria-pressed', state.starOnly); apply(); });

// Shortlist stars (per browser)
function paintStars() { $$('.star').forEach(b => { const on = state.stars.has(+b.dataset.rank); b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', on ? 'Remove from shortlist' : 'Add to shortlist'); }); }
$$('.star').forEach(b => b.addEventListener('click', () => { const r = +b.dataset.rank; state.stars.has(r) ? state.stars.delete(r) : state.stars.add(r); store.set('fr-stars', [...state.stars]); paintStars(); buildTable(); apply(); }));

// Collapse / expand
function fold(el, collapsed) { el.classList.toggle('collapsed', collapsed); const b = el.querySelector('.fold-btn'); b.textContent = collapsed ? 'Expand' : 'Collapse'; b.setAttribute('aria-expanded', !collapsed); }
$$('.fold-btn').forEach(b => b.addEventListener('click', () => fold(b.closest('.feature'), !b.closest('.feature').classList.contains('collapsed'))));
$('#expandAll').onclick = () => $$('.feature').forEach(f => fold(f, false));
$('#collapseAll').onclick = () => $$('.feature').forEach(f => fold(f, true));
function goTo(id) { const el = document.getElementById(id); if (!el) return; if (el.classList.contains('feature')) fold(el, false); el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); history.replaceState(null, '', '#' + id); document.body.classList.remove('nav-open'); $('#menuBtn').setAttribute('aria-expanded', 'false'); }
document.addEventListener('click', e => { const a = e.target.closest('a[href^="#"]'); if (a && a.getAttribute('href').length > 1) { e.preventDefault(); goTo(decodeURIComponent(a.getAttribute('href').slice(1))); } });

// Sortable ranking table
let sort = { key: 'rank', dir: 1 };
const cols = [['rank', '#'], ['title', 'Feature'], ['effort', 'Effort'], ['fit', 'Fit'], ['help', 'Help'], ['cool', 'Cool'], ['wave', 'Wave'], ['issue', 'Issue']];
const eff = { S: 1, M: 2, L: 3 };
const dots = n => '●'.repeat(n) + '<span>' + '●'.repeat(5 - n) + '</span>';
function buildTable() {
  const rows = [...DATA].sort((a, b) => { const k = sort.key, va = k === 'effort' ? eff[a[k]] : a[k], vb = k === 'effort' ? eff[b[k]] : b[k]; return (va > vb ? 1 : va < vb ? -1 : a.rank - b.rank) * sort.dir; });
  $('#ranking').innerHTML = \`<div class="tablewrap"><table><thead><tr>\${cols.map(([k, l]) => \`<th aria-sort="\${sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-sort="\${k}">\${l}</button></th>\`).join('')}</tr></thead><tbody>\${rows.map(f => \`<tr data-rank="\${f.rank}" data-id="\${f.id}"><td class="num">\${f.rank}</td><td>\${state.stars.has(f.rank) ? '★ ' : ''}<a href="#\${f.id}">\${f.title}</a></td><td class="num"><span class="badge e-\${f.effort}">\${f.effort}</span></td><td class="dots" aria-label="\${f.fit} of 5">\${dots(f.fit)}</td><td class="dots" aria-label="\${f.help} of 5">\${dots(f.help)}</td><td class="dots" aria-label="\${f.cool} of 5">\${dots(f.cool)}</td><td class="num">\${f.wave}</td><td><a href="\${f.url}" target="_blank" rel="noopener">#\${f.issue}</a></td></tr>\`).join('')}</tbody></table></div>\`;
  $$('#ranking th button').forEach(b => b.onclick = () => { const k = b.dataset.sort; sort = { key: k, dir: sort.key === k ? -sort.dir : (['fit', 'help', 'cool'].includes(k) ? -1 : 1) }; buildTable(); apply(); });
  $$('#ranking tbody tr').forEach(tr => tr.onclick = e => { if (!e.target.closest('a')) goTo(tr.dataset.id); });
}

// Interactive value vs effort scatter
function buildScatter() {
  const W = 760, H = 460, P = { l: 56, r: 20, t: 20, b: 48 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const Y0 = .25, Y1 = 1.02; // value range actually used
  const X = x => P.l + x * iw, Y = y => P.t + (Y1 - y) / (Y1 - Y0) * ih;
  // [label, x0, x1, y0, y1, label in top (t) or bottom (b) right corner]
  const q = [['Quick wins', 0, .5, .5, Y1, 't'], ['Big bets', .5, 1, .5, Y1, 't'], ['Nice to have', 0, .5, Y0, .5, 'b'], ['Later', .5, 1, Y0, .5, 'b']];
  const color = { S: 'var(--s)', M: 'var(--m)', L: 'var(--l)' };
  $('#scatter').innerHTML = \`<svg viewBox="0 0 \${W} \${H}" role="group" aria-label="Value versus effort scatter plot">
    \${q.map(([t, x0, x1, y0, y1, a]) => \`<rect x="\${X(x0)}" y="\${Y(y1)}" width="\${X(x1) - X(x0)}" height="\${Y(y0) - Y(y1)}" fill="\${t === 'Quick wins' ? 'var(--accent-soft)' : 'transparent'}" stroke="var(--border)"/><text x="\${X(x1) - 10}" y="\${a === 't' ? Y(y1) + 20 : Y(y0) - 10}" text-anchor="end" fill="var(--muted)" font-size="13" font-weight="600">\${t}</text>\`).join('')}
    <text x="\${P.l + iw / 2}" y="\${H - 12}" text-anchor="middle" fill="var(--muted)" font-size="13">Effort →</text>
    <text transform="translate(16 \${P.t + ih / 2}) rotate(-90)" text-anchor="middle" fill="var(--muted)" font-size="13">Value →</text>
    \${DATA.map(f => \`<g class="pt" data-pt="\${f.rank}" tabindex="0" role="button" aria-label="\${f.rank}. \${f.title}, effort \${f.effort}"><circle cx="\${X(f.x)}" cy="\${Y(f.y)}" r="13" fill="\${color[f.effort]}"/><text x="\${X(f.x)}" y="\${Y(f.y) + 4.5}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff" pointer-events="none">\${f.rank}</text></g>\`).join('')}
  </svg><div class="tip hidden" id="tip"></div>
  <div class="legend"><span><i style="background:var(--s)"></i>S effort</span><span><i style="background:var(--m)"></i>M</span><span><i style="background:var(--l)"></i>L</span><span>Hover or focus a dot for details; click to open the chapter.</span></div>\`;
  const tip = $('#tip'), box = $('#scatter');
  $$('#scatter .pt').forEach(g => {
    const f = byRank[g.dataset.pt];
    const show = () => { const c = g.querySelector('circle').getBoundingClientRect(), b = box.getBoundingClientRect(); tip.innerHTML = \`<b>\${f.rank}. \${f.title}</b><br>Effort \${f.effort} · Fit \${f.fit} · Help \${f.help} · Cool \${f.cool}\`; tip.style.left = Math.min(Math.max(c.left - b.left + c.width / 2, 130), b.width - 130) + 'px'; tip.style.top = (c.top - b.top) + 'px'; tip.classList.remove('hidden'); };
    const hide = () => tip.classList.add('hidden');
    g.addEventListener('mouseenter', show); g.addEventListener('focus', show); g.addEventListener('mouseleave', hide); g.addEventListener('blur', hide);
    g.addEventListener('click', () => goTo(f.id)); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(f.id); } });
  });
}

// Scroll spy
const spy = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { $$('#navList a').forEach(a => a.classList.toggle('active', a.dataset.rank === e.target.dataset.rank)); } }), { rootMargin: '-10% 0px -80% 0px' });
$$('.feature').forEach(f => spy.observe(f));

// Theme
const root = document.documentElement;
const savedTheme = store.get('fr-theme', null); if (savedTheme) root.dataset.theme = savedTheme;
const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
$('#theme').onclick = () => { root.dataset.theme = isDark() ? 'light' : 'dark'; store.set('fr-theme', root.dataset.theme); renderDiagrams(); };

// Mobile drawer + keyboard
$('#menuBtn').onclick = () => { const open = document.body.classList.toggle('nav-open'); $('#menuBtn').setAttribute('aria-expanded', open); if (open) $('#q').focus(); };
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); document.body.classList.add('nav-open'); $('#q').focus(); }
  if (e.key === 'Escape') { document.body.classList.remove('nav-open'); $('#menuBtn').setAttribute('aria-expanded', 'false'); }
});

// Mermaid diagrams (CDN); fall back to the pre-rendered SVGs in docs/diagrams
let mermaid;
async function renderDiagrams() {
  const figs = $$('figure.diagram');
  try {
    mermaid ??= (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default;
    mermaid.initialize({ startOnLoad: false, theme: isDark() ? 'dark' : 'default', securityLevel: 'strict' });
    let i = 0;
    for (const fig of figs) {
      try { const { svg } = await mermaid.render('mmd' + (i++) + '-' + Date.now(), fig.querySelector('.mermaid-src').textContent); fig.querySelector('.mermaid-out').innerHTML = svg; }
      catch { fallback(fig); }
    }
  } catch { figs.forEach(fallback); }
}
function fallback(fig) { const src = fig.dataset.fallback; fig.querySelector('.mermaid-out').innerHTML = src ? \`<img src="\${src}" alt="Diagram">\` : '<p>Diagram unavailable.</p>'; }

buildTable(); buildScatter(); paintStars(); apply(); renderDiagrams();
if (location.hash) setTimeout(() => goTo(decodeURIComponent(location.hash.slice(1))), 50);
</script>
</body>
</html>
`;
writeFileSync(join(here, 'feature-report.html'), page);
console.log(`feature-report.html: ${features.length} features, ${appendices.length} appendices, ${(page.length / 1024).toFixed(0)} KB`);
