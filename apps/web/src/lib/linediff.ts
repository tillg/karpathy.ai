/** One line of a line diff: `eq` in both, `theirs` only in theirs, `mine` only in mine. */
export interface DiffLine { op: 'eq' | 'theirs' | 'mine'; text: string }

/** A shown row: a diff line, or a run of `count` unchanged lines collapsed away. */
export type DiffRow = DiffLine | { op: 'skip'; count: number };

const lines = (s: string) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'));

/** Line-level LCS diff from `theirs` to `mine` (pure). Common prefix/suffix are trimmed first. */
export function lineDiff(theirs: string, mine: string): DiffLine[] {
  const a = lines(theirs);
  const b = lines(mine);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const x = a.slice(pre, a.length - suf);
  const y = b.slice(pre, b.length - suf);
  const eq = (t: string): DiffLine => ({ op: 'eq', text: t });
  // The LCS table is |x|·|y| cells: past ~4M (e.g. two 2000-line sides that differ throughout)
  // show the middle as removed-then-added instead of freezing a phone.
  if (x.length * y.length > 4_000_000)
    return [...a.slice(0, pre).map(eq), ...x.map((t): DiffLine => ({ op: 'theirs', text: t })), ...y.map((t): DiffLine => ({ op: 'mine', text: t })), ...b.slice(b.length - suf).map(eq)];
  // lcs[i][j] = LCS length of x[i..] and y[j..]
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { mid.push({ op: 'eq', text: x[i]! }); i++; j++; }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) mid.push({ op: 'theirs', text: x[i++]! });
    else mid.push({ op: 'mine', text: y[j++]! });
  }
  while (i < x.length) mid.push({ op: 'theirs', text: x[i++]! });
  while (j < y.length) mid.push({ op: 'mine', text: y[j++]! });
  return [...a.slice(0, pre).map(eq), ...mid, ...b.slice(b.length - suf).map(eq)];
}

/** Keeps `context` unchanged lines around each change and collapses the rest. */
export function collapse(diff: DiffLine[], context = 3): DiffRow[] {
  const keep = diff.map(() => false);
  diff.forEach((d, i) => {
    if (d.op === 'eq') return;
    for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep[k] = true;
  });
  const out: DiffRow[] = [];
  let skipped = 0;
  diff.forEach((d, i) => {
    if (keep[i]) {
      if (skipped) out.push({ op: 'skip', count: skipped });
      skipped = 0;
      out.push(d);
    } else skipped++;
  });
  if (skipped) out.push({ op: 'skip', count: skipped });
  return out;
}
