import { expect, it } from 'vitest';
import { formatRoute, parseRoute } from './route';

it('round-trips vault and path, incl. spaces, unicode and #', () => {
  for (const path of ['Home.md', 'raw/articles/Graph Wissen 0.md', 'wiki/Réflexion #1?.md']) {
    const h = formatRoute('big', path);
    expect(h.startsWith('#/big/')).toBe(true);
    expect(parseRoute(h)).toEqual({ vault: 'big', path });
  }
  expect(formatRoute('big', 'a b/c.md')).toBe('#/big/a%20b/c.md');
});

it('vault only and empty routes', () => {
  expect(formatRoute('v')).toBe('#/v');
  expect(parseRoute('#/v')).toEqual({ vault: 'v', path: null });
  expect(formatRoute(null)).toBe('');
  for (const h of ['', '#', '#/', '#foo', '#/%E0%A4%A']) expect(parseRoute(h)).toEqual({ vault: null, path: null });
  // #49: a trailing slash still names the vault.
  expect(parseRoute('#/v/')).toEqual({ vault: 'v', path: null });
});
