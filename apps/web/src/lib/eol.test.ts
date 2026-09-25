import { EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import { editorText, eolExtension } from './eol';

const edit = (doc: string, find: string, insert: string) => {
  const s = EditorState.create({ doc, extensions: eolExtension(doc) });
  const at = s.doc.toString().indexOf(find) + find.length;
  return editorText(s.update({ changes: { from: at, insert } }).state);
};

it('keeps CRLF line endings on edit (#19)', () => {
  const crlf = '# CRLF\r\n\r\nline one\r\nline two\r\nline three\r\n';
  expect(edit(crlf, 'line two', ' EDITED')).toBe('# CRLF\r\n\r\nline one\r\nline two EDITED\r\nline three\r\n');
});

it('keeps LF files LF', () => {
  expect(edit('a\nb\n', 'a', '!')).toBe('a!\nb\n');
});
