import { expect, it } from 'vitest';
import { buildTree } from './tree';

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
