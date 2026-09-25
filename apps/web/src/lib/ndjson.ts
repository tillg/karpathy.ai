/** Splits a text stream into NDJSON objects. Blank lines are keepalives and are skipped. */
export class NdjsonDecoder {
  private buf = '';

  /** Feeds a chunk; returns the objects of every line completed by it. */
  push(chunk: string): unknown[] {
    this.buf += chunk;
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? '';
    return parseLines(lines);
  }

  /** Parses a trailing line that had no newline. */
  flush(): unknown[] {
    const rest = this.buf;
    this.buf = '';
    return parseLines([rest]);
  }
}

function parseLines(lines: string[]): unknown[] {
  const out: unknown[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (t) out.push(JSON.parse(t));
  }
  return out;
}

/** Reads an NDJSON response body until it ends (or the request is aborted). */
export async function readNdjson<T>(res: Response, onItem: (item: T) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const dec = new NdjsonDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const item of dec.push(value)) onItem(item as T);
  }
  for (const item of dec.flush()) onItem(item as T);
}
