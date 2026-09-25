import { describe, expect, it } from 'vitest';
import { collapse, lineDiff } from './linediff';

describe('lineDiff', () => {
  it('marks a changed last line as theirs/mine and keeps the rest equal', () => {
    expect(lineDiff('# Home\n\nfirst\nlast theirs\n', '# Home\n\nfirst\nlast mine\n')).toEqual([
      { op: 'eq', text: '# Home' },
      { op: 'eq', text: '' },
      { op: 'eq', text: 'first' },
      { op: 'theirs', text: 'last theirs' },
      { op: 'mine', text: 'last mine' },
    ]);
  });

  it('handles insertions and deletions in the middle', () => {
    expect(lineDiff('a\nb\nc\nd', 'a\nc\nx\nd')).toEqual([
      { op: 'eq', text: 'a' },
      { op: 'theirs', text: 'b' },
      { op: 'eq', text: 'c' },
      { op: 'mine', text: 'x' },
      { op: 'eq', text: 'd' },
    ]);
  });

  it('treats an empty side as all lines added or removed', () => {
    expect(lineDiff('', 'a\nb')).toEqual([{ op: 'mine', text: 'a' }, { op: 'mine', text: 'b' }]);
    expect(lineDiff('a', '')).toEqual([{ op: 'theirs', text: 'a' }]);
    expect(lineDiff('same\n', 'same\n')).toEqual([{ op: 'eq', text: 'same' }]);
  });
});

describe('collapse', () => {
  it('keeps context around changes and collapses long unchanged runs', () => {
    const theirs = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const mine = theirs.replace('l10', 'L10');
    expect(collapse(lineDiff(theirs, mine), 2)).toEqual([
      { op: 'skip', count: 8 },
      { op: 'eq', text: 'l8' },
      { op: 'eq', text: 'l9' },
      { op: 'theirs', text: 'l10' },
      { op: 'mine', text: 'L10' },
      { op: 'eq', text: 'l11' },
      { op: 'eq', text: 'l12' },
      { op: 'skip', count: 7 },
    ]);
  });
});
