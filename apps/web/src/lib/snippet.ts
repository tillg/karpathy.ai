/**
 * The part of a search-result line that fits `budget` characters, with the first match of `q`
 * centered (#54): room one side doesn't need goes to the other. `…` marks a cut. Null: no match.
 */
export function snippet(text: string, q: string, budget: number): { pre: string; hit: string; post: string } | null {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return null;
  const end = i + q.length;
  const room = Math.max(0, budget - q.length);
  let before = Math.floor(room / 2);
  let after = room - before;
  const tail = text.length - end;
  if (tail < after) { before += after - tail; after = tail; }
  if (i < before) { after += before - i; before = i; }
  const start = i - before;
  const stop = Math.min(text.length, end + after);
  return {
    pre: (start > 0 ? '…' : '') + text.slice(start, i),
    hit: text.slice(i, end),
    post: text.slice(end, stop) + (stop < text.length ? '…' : ''),
  };
}
