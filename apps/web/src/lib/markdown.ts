import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { parseWikilink, wikilinkLabel } from './wikilink';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `---\n…\n---` at the very start of a note. */
export function splitFrontmatter(md: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(md);
  return m ? { frontmatter: m[1]!, body: md.slice(m[0].length) } : { frontmatter: null, body: md };
}

/** Top-level `key: value` pairs of a frontmatter block (display only; not a YAML parser). */
export function frontmatterProps(fm: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of fm.split(/\r?\n/)) {
    const m = /^([\w][\w -]*):\s?(.*)$/.exec(line);
    if (m) out.push([m[1]!, m[2]!]);
    else if (out.length && line.trim()) out[out.length - 1]![1] += ` ${line.trim()}`;
  }
  return out;
}

/** Markdown → HTML (not sanitized). Wikilinks become `<a class="wl" data-target>`. */
export function toHtml(md: string, exists: (target: string) => boolean): string {
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
  return marked.parse(md, { async: false });
}

// Notes come from git (other devices, collaborators, AI-ingested sources): no forms (phishing
// on our origin) and no inline styles (full-screen overlays / clickjacking) (#31).
const PURIFY = {
  FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'option', 'style', 'link', 'meta', 'base', 'dialog'],
  FORBID_ATTR: ['style', 'formaction', 'form', 'autofocus'],
};

// Code blocks scroll sideways: focusable, so the keyboard can scroll them (#45).
const focusablePre = (html: string) => html.replace(/<pre>/g, '<pre tabindex="0">');

export const renderMarkdown = (md: string, exists: (target: string) => boolean) =>
  focusablePre(DOMPurify.sanitize(toHtml(md, exists), PURIFY));
