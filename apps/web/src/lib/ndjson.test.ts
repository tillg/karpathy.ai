import { describe, expect, it } from 'vitest';
import { NdjsonDecoder, readNdjson } from './ndjson';

describe('NdjsonDecoder', () => {
  it('parses complete lines and keeps partial ones', () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"a":1}\n{"b"')).toEqual([{ a: 1 }]);
    expect(d.push(':2}\n')).toEqual([{ b: 2 }]);
    expect(d.flush()).toEqual([]);
  });

  it('skips blank keepalive lines', () => {
    const d = new NdjsonDecoder();
    expect(d.push('\n\n{"x":true}\n\n  \n')).toEqual([{ x: true }]);
  });

  it('flushes a trailing line without newline', () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"a":1}\n{"a":2}')).toEqual([{ a: 1 }]);
    expect(d.flush()).toEqual([{ a: 2 }]);
  });

  it('handles CRLF line endings', () => {
    expect(new NdjsonDecoder().push('{"a":1}\r\n')).toEqual([{ a: 1 }]);
  });
});

describe('readNdjson', () => {
  it('reads objects split across chunks from a Response body', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const s of ['{"type":"st', 'atus"}\n\n', '{"n":2}\n{"n":3}']) c.enqueue(enc.encode(s));
        c.close();
      },
    });
    const got: unknown[] = [];
    await readNdjson(new Response(body), (x) => got.push(x));
    expect(got).toEqual([{ type: 'status' }, { n: 2 }, { n: 3 }]);
  });
});
