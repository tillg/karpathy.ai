import { EditorState, type Extension } from '@codemirror/state';

// CodeMirror normalizes line breaks; keep a CRLF note CRLF (issue #19, lossless round-trip).

/** The line separator facet for a note loaded as `doc` (CRLF when it contains any). */
export const eolExtension = (doc: string): Extension => (doc.includes('\r\n') ? EditorState.lineSeparator.of('\r\n') : []);

/** The document text joined with the state's line separator (`doc.toString()` always uses \n). */
export const editorText = (s: EditorState) => s.sliceDoc();
