import { expect, it } from 'vitest';
import { draftAction, dropDraft, getDraft, putDraft } from './drafts';

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

it('stores drafts per vault and path', () => {
  const s = new MemStore();
  putDraft(s, 'a', 'Home.md', { base: 'v1', text: 'x' });
  putDraft(s, 'b', 'Home.md', { base: 'v9', text: 'y' });
  expect(getDraft(s, 'a', 'Home.md')).toEqual({ base: 'v1', text: 'x' });
  expect(getDraft(s, 'b', 'Home.md')).toEqual({ base: 'v9', text: 'y' });
  expect(getDraft(s, 'a', 'Ideas.md')).toBeNull();
  dropDraft(s, 'a', 'Home.md');
  expect(getDraft(s, 'a', 'Home.md')).toBeNull();
  s.setItem('karpathy.draft:a:bad', '{not json');
  expect(getDraft(s, 'a', 'bad')).toBeNull();
});

it('decides restore vs stale by the base version', () => {
  expect(draftAction(null, 'v1', 'x')).toBe('none');
  expect(draftAction({ base: 'v1', text: 'x' }, 'v2', 'x')).toBe('none'); // already on the server
  expect(draftAction({ base: 'v1', text: 'mine' }, 'v1', 'server')).toBe('restore');
  expect(draftAction({ base: 'v1', text: 'mine' }, 'v2', 'server')).toBe('stale');
});
