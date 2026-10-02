import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { parseWikilink, wikilinkLabel } from './wikilink';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `---\n…\n---` at the very start of a note. */
export function splitFrontmatter(md: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(md);
  return m ? { frontmatter: m[1]!, body: md.slice(m[0].length) } : { frontmatter: null, body: md };
}

/** A display value: a scalar (quotes removed), a list, or raw text for shapes this reader doesn't know. */
export type FieldValue = string | string[];

/** Strips matching YAML quotes from a scalar (`''` is an escaped `'` in single quotes). */
function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"');
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** `[a, "b, c"]` → items; null when it isn't a well-formed flat inline list. */
function inlineList(v: string): string[] | null {
  if (!v.startsWith('[') || !v.endsWith(']')) return null;
  const body = v.slice(1, -1);
  const items: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of body) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}') return null;
    if (ch === ',') { items.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (quote) return null;
  if (cur.trim() || items.length) items.push(cur.trim());
  return items.map(unquote);
}

/**
 * Top-level frontmatter fields for Read mode (#58; display only, not a YAML parser): flat
 * `key: value`, inline `[a, b]` and block `- a` lists; anything else is shown as raw text.
 */
export function frontmatterFields(fm: string): [string, FieldValue][] {
  const out: [string, FieldValue][] = [];
  const lines = fm.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([\w][\w -]*):(?:\s+(.*))?$/.exec(lines[i]!);
    if (!m) continue;
    const head = (m[2] ?? '').trim();
    // Following lines that belong to this key: indented, or `- ` items flush with it.
    const rest: string[] = [];
    while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]!) || /^- /.test(lines[i + 1]!) || !lines[i + 1]!.trim())) rest.push(lines[++i]!);
    const more = rest.map((l) => l.trim()).filter(Boolean);
    let value: FieldValue;
    if (!head && more.length && more.every((l) => /^- /.test(l) || l === '-')) value = more.map((l) => unquote(l.slice(1).trim()));
    else if (!head) value = more.join('\n');
    else if (/^[|>][+-]?$/.test(head)) value = more.join('\n');
    else if (!more.length) value = inlineList(head) ?? unquote(head);
    else value = [head, ...more].join(' ');
    out.push([m[1]!, value]);
  }
  return out;
}

// Obsidian syntax that must not fire inside code: fenced blocks and code spans are matched first.
const CODE = '```[\\s\\S]*?```|~~~[\\s\\S]*?~~~|`[^`\\n]*`';
const COMMENT_RE = new RegExp(`(${CODE})|%%[\\s\\S]*?%%`, 'g');
const FOOTNOTE_DEF_RE = new RegExp(`(${CODE})|^\\[\\^([^\\]\\s]+)\\]:[ \\t]*(.*(?:\\n(?:[ \\t]{2,}|\\t).*)*)\\n?`, 'gm');

/** Markdown → HTML (not sanitized). Wikilinks become `<a class="wl" data-target>`. */
export function toHtml(md: string, exists: (target: string) => boolean): string {
  // `%%comment%%` is never shown (#112); `[^id]: text` definitions are collected for the footnotes section (#115).
  const defs = new Map<string, string>();
  md = md
    .replace(COMMENT_RE, (_m, code?: string) => code ?? '')
    .replace(FOOTNOTE_DEF_RE, (m, code: string | undefined, id: string, text: string) => {
      if (code !== undefined) return m;
      defs.set(id, text.replace(/\s*\n\s*/g, ' ').trim());
      return '';
    });
  const order: string[] = [];
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    extensions: [{
      name: 'wikilink',
      level: 'inline',
      start: (src) => src.indexOf('[['),
      tokenizer(src) {
        const m = /^\[\[([^[\]\n]+?)\]\]/.exec(src);
        return m ? { type: 'wikilink', raw: m[0], inner: m[1] } : undefined;
      },
      renderer(tok) {
        const inner = tok.inner as string;
        const l = parseWikilink(inner);
        const cls = !l.target || exists(l.target) ? 'wl' : 'wl miss';
        return `<a href="#" class="${cls}" data-target="${esc(inner)}">${esc(wikilinkLabel(l))}</a>`;
      },
    }],
  });
  marked.use({
    extensions: [{
      // `![[note]]` → the wikilink as a link marked as embed, no transclusion (#114).
      name: 'wikiembed',
      level: 'inline',
      start: (src) => src.indexOf('![['),
      tokenizer(src) {
        const m = /^!\[\[([^[\]\n]+?)\]\]/.exec(src);
        return m ? { type: 'wikiembed', raw: m[0], inner: m[1] } : undefined;
      },
      renderer(tok) {
        const link = marked.defaults.extensions!.renderers.wikilink!.call(this, { type: 'wikilink', raw: tok.raw, inner: tok.inner });
        return String(link).replace('class="wl', 'class="wl embed');
      },
    }, {
      name: 'highlight',
      level: 'inline',
      start: (src) => src.indexOf('=='),
      tokenizer(src) {
        const m = /^==(?!=)([^=\n](?:[^\n]*?[^=\n])?)==(?!=)/.exec(src);
        return m ? { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]!) } : undefined;
      },
      renderer(tok) {
        return `<mark>${this.parser.parseInline(tok.tokens!)}</mark>`;
      },
    }, {
      name: 'footnoteRef',
      level: 'inline',
      start: (src) => src.indexOf('[^'),
      tokenizer(src) {
        const m = /^\[\^([^\]\s]+)\]/.exec(src);
        return m && defs.has(m[1]!) ? { type: 'footnoteRef', raw: m[0], id: m[1] } : undefined;
      },
      renderer(tok) {
        const id = tok.id as string;
        if (!order.includes(id)) order.push(id);
        const n = order.indexOf(id) + 1;
        return `<sup class="fn"><a href="#fn-${n}" id="fnref-${n}">${n}</a></sup>`;
      },
    }],
    renderer: {
      // GFM task items: DOMPurify drops <input>, so show a non-interactive marker (#102).
      checkbox({ checked }) {
        return `<span class="task" data-done="${checked}" aria-label="${checked ? 'done' : 'not done'}" role="img">${checked ? '☑' : '☐'}</span> `;
      },
      // Obsidian callouts `> [!type] Title` (#111); foldable `+`/`-` markers are ignored.
      blockquote({ tokens }) {
        const html = this.parser.parse(tokens);
        const m = /^<p>\[!([\w-]+)\][+-]?[ \t]*([^\n]*?)(\n|<\/p>)/.exec(html);
        if (!m) return false;
        const type = m[1]!.toLowerCase();
        const title = m[2] || type.charAt(0).toUpperCase() + type.slice(1);
        const body = (m[3] === '\n' ? '<p>' : '') + html.slice(m[0].length);
        return `<div class="callout" data-callout="${esc(type)}"><div class="callout-title">${title}</div><div class="callout-body">${body}</div></div>\n`;
      },
    },
  });
  const html = marked.parse(md, { async: false });
  if (!order.length) return html;
  const items = order.map((id, i) => `<li id="fn-${i + 1}">${marked.parseInline(defs.get(id)!, { async: false })} <a href="#fnref-${i + 1}" class="fn-back">↩</a></li>`);
  return `${html}<section class="footnotes"><ol>${items.join('')}</ol></section>\n`;
}

// Notes come from git (other devices, collaborators, AI-ingested sources): no forms (phishing
// on our origin) and no inline styles (full-screen overlays / clickjacking) (#31).
const PURIFY = {
  FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'option', 'style', 'link', 'meta', 'base', 'dialog'],
  FORBID_ATTR: ['style', 'formaction', 'form', 'autofocus'],
};

// Code blocks scroll sideways: focusable, so the keyboard can scroll them (#45).
const focusablePre = (html: string) => html.replace(/<pre>/g, '<pre tabindex="0">');

/** How rendered links point into the app: `href` for a wikilink target, `relative` for a Markdown link to a vault file. */
export interface LinkCtx {
  href: (target: string) => string | null;
  relative: (href: string) => { path: string; href: string } | null;
}

const EXTERNAL = /^(https?:|mailto:)/i;

/**
 * Link fix-ups after sanitizing (DOMPurify drops `target`): external links open in a new tab
 * (#110); wikilinks get their note's route as href so open-in-new-tab/copy-link work (#109);
 * relative links to vault notes get that route plus `data-note` for in-app clicks (#116).
 */
function linkHook(ctx?: LinkCtx) {
  return (node: Element) => {
    if (node.tagName !== 'A') return;
    const href = node.getAttribute('href') ?? '';
    if (node.classList.contains('wl')) {
      const l = parseWikilink(node.getAttribute('data-target') ?? '');
      const h = l.target ? ctx?.href(l.target) : null;
      if (h) node.setAttribute('href', h);
    } else if (EXTERNAL.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } else {
      const r = ctx?.relative(href);
      if (r) { node.setAttribute('href', r.href); node.setAttribute('data-note', r.path); }
    }
  };
}

export const renderMarkdown = (md: string, exists: (target: string) => boolean, ctx?: LinkCtx) => {
  const hook = linkHook(ctx);
  DOMPurify.addHook('afterSanitizeAttributes', hook);
  try {
    return focusablePre(DOMPurify.sanitize(toHtml(md, exists), PURIFY));
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes', hook);
  }
};
