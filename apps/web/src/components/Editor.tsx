import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { liveMarkdown } from '../lib/cm';
import { minimalChange } from '../lib/diff';

export interface EditorHandle {
  openSearch(): void;
  gotoLine(line: number): void;
}

interface Props {
  doc: string;
  readOnly: boolean;
  onChange(text: string): void;
  exists(target: string): boolean;
  onWikilink(inner: string): void;
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
        // Keep CRLF files CRLF: CM would otherwise normalize line breaks to \n.
        ...(doc.includes('\r\n') ? [EditorState.lineSeparator.of('\r\n')] : []),
        history(),
        search({ top: true }),
        keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
        liveMarkdown((t) => latest.current.exists(t), (i) => latest.current.onWikilink(i)),
        ro.current.of([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]),
        EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'sentences', 'aria-label': 'Note editor' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) latest.current.onChange(u.state.doc.toString());
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
    const cur = v.state.doc.toString();
    const c = minimalChange(cur, props.doc);
    if (!c) return;
    // With a CRLF separator a line break is one position in CM but two chars in the string.
    const pos = (s: string, i: number) => (v.state.lineBreak === '\r\n' ? i - (s.slice(0, i).match(/\r\n/g)?.length ?? 0) : i);
    v.dispatch({ changes: { from: pos(cur, c.from), to: pos(cur, c.to), insert: c.insert }, annotations: External.of(true) });
  }, [props.doc]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]) });
  }, [props.readOnly]);

  useImperativeHandle(ref, () => ({
    openSearch: () => { if (view.current) openSearchPanel(view.current); },
    gotoLine: (line) => {
      const v = view.current;
      if (!v) return;
      const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
      v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
      v.focus();
    },
  }), []);

  return <div className="editor" data-testid="editor" ref={host} />;
});
