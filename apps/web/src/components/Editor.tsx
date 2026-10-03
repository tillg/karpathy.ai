import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { liveMarkdown, refreshLinks } from '../lib/cm';
import { minimalChange } from '../lib/diff';
import { editorText, eolExtension } from '../lib/eol';
import type { Embed, Resolved } from '../lib/media';
import type { EmbedCtx } from '../lib/embed';

export interface EditorHandle {
  openSearch(): void;
  /** `focus: false` keeps the keyboard closed (mode switch); `align: 'start'` puts the line at the top, below the header. */
  gotoLine(line: number, opts?: { focus?: boolean; align?: 'center' | 'start' }): void;
  /** The document line at the top of the visible pane. */
  topLine(): number;
}

interface Props {
  doc: string;
  /** Changes on every (re)load, so a reload back to the same `doc` still replaces edited text. */
  docNonce?: number;
  readOnly: boolean;
  onChange(text: string): void;
  exists(target: string): boolean;
  onWikilink(inner: string): void;
  resolveEmbed(e: Embed): Resolved;
  embedCtx(): EmbedCtx;
  /** Changes when cached media bytes were dropped (see store `mediaEpoch`). */
  mediaEpoch: number;
}

/** Marks transactions that load content from the server (not user edits). */
const External = Annotation.define<boolean>();

/** CM6 in Write mode. Remount per note (key = path); `doc` updates replace the text in place. */
export const Editor = forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const ro = useRef(new Compartment());

  useEffect(() => {
    const doc = props.doc;
    const state = EditorState.create({
      doc,
      extensions: [
        eolExtension(doc),
        history(),
        search({ top: true }),
        keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
        liveMarkdown((t) => latest.current.exists(t), (i) => latest.current.onWikilink(i), {
          resolve: (e) => latest.current.resolveEmbed(e),
          ctx: () => latest.current.embedCtx(),
          epoch: () => latest.current.mediaEpoch,
        }),
        ro.current.of([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]),
        EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'sentences', 'aria-label': 'Note editor' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) latest.current.onChange(editorText(u.state));
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current! });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload in place as a minimal change, so the selection and scroll position survive (issue #4).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = editorText(v.state);
    const c = minimalChange(cur, props.doc);
    if (!c) return;
    // With a CRLF separator a line break is one position in CM but two chars in the string.
    const pos = (s: string, i: number) => (v.state.lineBreak === '\r\n' ? i - (s.slice(0, i).match(/\r\n/g)?.length ?? 0) : i);
    v.dispatch({ changes: { from: pos(cur, c.from), to: pos(cur, c.to), insert: c.insert }, annotations: External.of(true) });
  }, [props.doc, props.docNonce]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]) });
  }, [props.readOnly]);

  // A new file list or dropped media bytes: missing-link marks and embeds follow (#55).
  useEffect(() => { view.current?.dispatch({ effects: refreshLinks.of(null) }); }, [props.exists, props.mediaEpoch]);

  useImperativeHandle(ref, () => ({
    openSearch: () => { if (view.current) openSearchPanel(view.current); },
    gotoLine: (line, opts) => {
      // `view.current` is read late: dev StrictMode remounts the view right after the effect that calls this.
      let settled = 0;
      const go = (): { done: boolean } => {
        const v = view.current;
        if (!v) return { done: true };
        const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
        const sc = v.dom.closest<HTMLElement>('.scroll');
        const pad = sc ? parseFloat(getComputedStyle(sc).paddingTop) : 0; // the header overlays this much
        if (opts?.align === 'start' && sc) {
          // Settled when the line is rendered right at the top, twice in a row (measuring can shift it).
          const top = v.coordsAtPos(l.from)?.top;
          if (top !== undefined && Math.abs(top - (sc.getBoundingClientRect().top + pad)) < 3) return { done: ++settled >= 2 };
          settled = 0;
          v.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: pad }) });
          return { done: false };
        }
        v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
        if (opts?.focus !== false) v.focus();
        return { done: true };
      };
      if (opts?.align !== 'start') { go(); return; }
      // Aligning to the top: after a layout pass (a scroll before it is clamped away), and again while CodeMirror measures its lines.
      let stop = false;
      const sc = view.current?.dom.closest<HTMLElement>('.scroll');
      const halt = () => { stop = true; };
      const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
      for (const e of events) sc?.addEventListener(e, halt, { passive: true });
      const retry = (left: number) => {
        if (stop || go().done || left === 0) for (const e of events) sc?.removeEventListener(e, halt);
        else setTimeout(() => retry(left - 1), 100);
      };
      requestAnimationFrame(() => requestAnimationFrame(() => retry(8)));
    },
    topLine: () => {
      const v = view.current;
      const sc = v?.dom.closest<HTMLElement>('.scroll');
      if (!v || !sc) return 1;
      const top = sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).paddingTop);
      // The rendered lines have exact positions (CodeMirror's height map is only an estimate away from them).
      const el = [...v.contentDOM.querySelectorAll<HTMLElement>('.cm-line')].find((e) => e.getBoundingClientRect().bottom > top + 1);
      return el ? v.state.doc.lineAt(v.posAtDOM(el)).number : 1;
    },
  }), []);

  return <div className="editor" data-testid="editor" ref={host} />;
});
