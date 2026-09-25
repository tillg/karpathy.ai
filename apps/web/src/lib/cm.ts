// CodeMirror 6 live-preview extensions. They only add decorations over the raw text; the
// document itself is never rewritten (lossless round-trip, mvp §2.2).
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { splitFrontmatter } from './markdown';
import { WIKILINK_RE } from './wikilink';

const style = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700' },
  { tag: tags.heading2, fontWeight: '650' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '650' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, class: 'cm-md-code' },
  { tag: [tags.link, tags.url], class: 'cm-md-link' },
  { tag: tags.processingInstruction, class: 'cm-md-mark' },
  { tag: tags.quote, class: 'cm-md-quote' },
]);

const lineDeco = (cls: string) => Decoration.line({ class: cls });
const HEADING: Record<string, string> = { ATXHeading1: 'cm-h1', ATXHeading2: 'cm-h2', ATXHeading3: 'cm-h3', ATXHeading4: 'cm-h4', ATXHeading5: 'cm-h4', ATXHeading6: 'cm-h4' };

/** Frontmatter block + heading/quote line classes. */
const lines = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view: EditorView): DecorationSet {
    const doc = view.state.doc;
    const b = new RangeSetBuilder<Decoration>();
    // Frontmatter: only when the note starts with `---` and a closing `---` exists.
    let fmEnd = 0;
    if (doc.line(1).text.trimEnd() === '---') {
      const head = doc.sliceString(0, Math.min(doc.length, 20_000));
      if (splitFrontmatter(head).frontmatter !== null) {
        for (let n = 2; n <= doc.lines; n++) if (doc.line(n).text.trimEnd() === '---') { fmEnd = n; break; }
      }
    }
    const deco = new Map<number, string>();
    for (let n = 1; n <= fmEnd; n++) deco.set(doc.line(n).from, n === 1 ? 'cm-fm cm-fm-top' : n === fmEnd ? 'cm-fm cm-fm-bot' : 'cm-fm');
    const fmTo = fmEnd ? doc.line(fmEnd).to : -1;
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from, to,
        enter: (n) => {
          if (n.from <= fmTo) return;
          const cls = HEADING[n.name] ?? (n.name === 'Blockquote' ? 'cm-bq' : null);
          if (!cls) return;
          for (let pos = n.from; pos <= n.to;) {
            const line = doc.lineAt(pos);
            if (!deco.has(line.from)) deco.set(line.from, cls);
            pos = line.to + 1;
          }
        },
      });
    }
    for (const from of [...deco.keys()].sort((a, c) => a - c)) b.add(from, from, lineDeco(deco.get(from)!));
    return b.finish();
  }
}, { decorations: (v) => v.decorations });

/** `[[wikilink]]` marks; click navigates unless the cursor is already inside the link. */
function wikilinks(exists: (target: string) => boolean, open: (inner: string) => void): Extension {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
    build(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        for (const m of text.matchAll(WIKILINK_RE)) {
          const start = from + m.index;
          const inner = m[1]!;
          const target = inner.split('|')[0]!.split('#')[0]!.trim();
          b.add(start, start + 2, Decoration.mark({ class: 'cm-md-mark' }));
          b.add(start + 2, start + 2 + inner.length, Decoration.mark({
            class: !target || exists(target) ? 'cm-wl' : 'cm-wl cm-wl-miss',
            attributes: { 'data-target': inner },
          }));
          b.add(start + 2 + inner.length, start + 4 + inner.length, Decoration.mark({ class: 'cm-md-mark' }));
        }
      }
      return b.finish();
    }
  }, { decorations: (v) => v.decorations });

  const click = EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.cm-wl');
      if (!el || e.button !== 0) return false;
      const pos = view.posAtDOM(el);
      const head = view.state.selection.main.head;
      const inner = el.dataset.target ?? '';
      if (view.hasFocus && head >= pos - 2 && head <= pos + inner.length + 2) return false;
      e.preventDefault();
      open(inner);
      return true;
    },
  });
  return [plugin, click];
}

export function liveMarkdown(exists: (target: string) => boolean, open: (inner: string) => void): Extension {
  return [markdown(), syntaxHighlighting(style), lines, wikilinks(exists, open), EditorView.lineWrapping];
}
