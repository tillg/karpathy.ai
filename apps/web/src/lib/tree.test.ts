import { describe, expect, it } from 'vitest';
import { ancestors, buildTree, loadExpanded, saveExpanded } from './tree';

it('nests entries with folders first', () => {
  const t = buildTree([
    { path: 'b.md', type: 'file' },
    { path: 'wiki', type: 'dir' },
    { path: 'wiki/x.md', type: 'file' },
    { path: 'a.md', type: 'file' },
    { path: 'raw/deep/y.md', type: 'file' },
  ]);
  expect(t.map((n) => n.path)).toEqual(['raw', 'wiki', 'a.md', 'b.md']);
  expect(t[0]!.children[0]!.children[0]!.path).toBe('raw/deep/y.md');
  expect(t[1]!.children.map((n) => n.name)).toEqual(['x.md']);
});

describe('folder expansion (#53)', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('lists the folders above a path, outermost first', () => {
    expect(ancestors('wiki/concepts/x.md')).toEqual(['wiki', 'wiki/concepts']);
    expect(ancestors('Home.md')).toEqual([]);
  });

  it('starts collapsed and persists per vault', () => {
    const s = mem();
    expect([...loadExpanded(s, 'v1')]).toEqual([]);
    saveExpanded(s, 'v1', new Set(['wiki', 'wiki/concepts']));
    expect([...loadExpanded(s, 'v1')]).toEqual(['wiki', 'wiki/concepts']);
    expect([...loadExpanded(s, 'v2')]).toEqual([]);
  });

  it('survives broken storage', () => {
    const s = mem();
    s.setItem('karpathy.tree:v1', '{nope');
    expect([...loadExpanded(s, 'v1')]).toEqual([]);
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    expect([...loadExpanded(throwing, 'v1')]).toEqual([]);
    expect(() => saveExpanded(throwing, 'v1', new Set(['a']))).not.toThrow();
  });
});
