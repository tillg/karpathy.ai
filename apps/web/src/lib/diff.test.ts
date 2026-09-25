import { expect, it } from 'vitest';
import { minimalChange } from './diff';

const apply = (a: string, c: ReturnType<typeof minimalChange>) => (c ? a.slice(0, c.from) + c.insert + a.slice(c.to) : a);

it('returns null for equal texts', () => {
  expect(minimalChange('abc', 'abc')).toBeNull();
});

it('replaces only the changed middle', () => {
  const a = 'line 1\nline 2\nline 3\n';
  const b = 'line 1\nline two\nline 3\n';
  const c = minimalChange(a, b)!;
  expect(c).toEqual({ from: 12, to: 13, insert: 'two' });
  expect(apply(a, c)).toBe(b);
});

it('handles pure insertions and deletions at the ends', () => {
  for (const [a, b] of [['abc', 'xabc'], ['abc', 'abcx'], ['abc', ''], ['', 'abc'], ['aaa', 'aa'], ['abab', 'ab']]) {
    expect(apply(a!, minimalChange(a!, b!))).toBe(b);
  }
});

it('never splits a CRLF or a surrogate pair', () => {
  const c = minimalChange('a\r\nb', 'a\r\r\nb')!;
  expect(apply('a\r\nb', c)).toBe('a\r\r\nb');
  expect('a\r\nb'.slice(c.from, c.to)).not.toMatch(/^\n/);
  const e = minimalChange('x😀y', 'x😁y')!;
  expect(e.insert).toBe('😁');
});
