/** Smallest single replacement turning `a` into `b` (common prefix/suffix stripped); null when equal. */
export function minimalChange(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null;
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  // Never cut inside a CRLF pair or a surrogate pair.
  const splits = (t: string, i: number) => i > 0 && i < t.length && ((t[i - 1] === '\r' && t[i] === '\n') || /[\uD800-\uDBFF]/.test(t[i - 1]!));
  while (p > 0 && (splits(a, p) || splits(b, p))) p--;
  while (s > 0 && (splits(a, a.length - s) || splits(b, b.length - s))) s--;
  return { from: p, to: a.length - s, insert: b.slice(p, b.length - s) };
}
