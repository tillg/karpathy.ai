import { describe, expect, it } from 'vitest';
import { applyChatEvent, changedPaths, settlePending, type ChatView, type PendingPrompt } from './chat';

const empty: ChatView = { id: 'c1', title: 'T', messages: [], turn: 'idle' };

describe('applyChatEvent', () => {
  it('tracks turn state and read-only flag', () => {
    const c = applyChatEvent(empty, { type: 'turn', state: 'queued', readonly: true });
    expect(c.turn).toBe('queued');
    expect(c.readonly).toBe(true);
    expect(applyChatEvent(c, { type: 'turn', state: 'running' }).readonly).toBe(true);
  });

  it('adds messages, upserts parts by id and appends text deltas', () => {
    let c = applyChatEvent(empty, { type: 'message', message: { id: 'm1', role: 'assistant', createdAt: 1 } });
    c = applyChatEvent(c, { type: 'part', messageId: 'm1', part: { type: 'text', id: 'p1', text: 'Hel' } });
    c = applyChatEvent(c, { type: 'text-delta', messageId: 'm1', partId: 'p1', delta: 'lo' });
    c = applyChatEvent(c, { type: 'part', messageId: 'm1', part: { type: 'tool', id: 't1', call: { id: 't1', tool: 'read', status: 'running', path: 'a.md', writes: false } } });
    c = applyChatEvent(c, { type: 'part', messageId: 'm1', part: { type: 'tool', id: 't1', call: { id: 't1', tool: 'read', status: 'completed', path: 'a.md', writes: false } } });
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0]!.parts).toEqual([
      { type: 'text', id: 'p1', text: 'Hello' },
      { type: 'tool', id: 't1', call: { id: 't1', tool: 'read', status: 'completed', path: 'a.md', writes: false } },
    ]);
  });

  it('creates a placeholder message for a delta that arrives first', () => {
    const c = applyChatEvent(empty, { type: 'text-delta', messageId: 'm9', partId: 'p', delta: 'x' });
    expect(c.messages[0]).toMatchObject({ id: 'm9', role: 'assistant', parts: [{ type: 'text', id: 'p', text: 'x' }] });
  });
});

describe('changedPaths', () => {
  it('lists completed write paths once', () => {
    const call = (id: string, path: string, writes: boolean, status: 'completed' | 'denied' = 'completed') =>
      ({ type: 'tool' as const, id, call: { id, tool: writes ? 'edit' : 'read', status, path, writes } });
    expect(changedPaths([call('1', 'a.md', true), call('2', 'b.md', false), call('3', 'a.md', true), call('4', 'c.md', true, 'denied')])).toEqual(['a.md']);
  });
});

describe('settlePending', () => {
  const p: PendingPrompt = { text: 'hi', userCount: 0, sent: true, ran: false };
  const user = { id: 'u1', role: 'user' as const, createdAt: 1, parts: [{ type: 'text' as const, id: 'x', text: 'hi' }] };

  it('keeps the bubble while the prompt is queued or not yet accepted', () => {
    expect(settlePending(p, { ...empty, turn: 'queued' })).toBe(p);
    const unsent = { ...p, sent: false };
    expect(settlePending(unsent, empty)).toBe(unsent);
  });

  it('drops it once the server has the user message', () => {
    expect(settlePending(p, { ...empty, turn: 'running', messages: [user] })).toBe('drop');
  });

  it('restores the text when the turn goes idle without having run (stopped while queued)', () => {
    expect(settlePending(p, empty)).toBe('restore');
  });

  it('does not restore after the turn ran', () => {
    const ran = settlePending(p, { ...empty, turn: 'running' });
    expect(ran).toEqual({ ...p, ran: true });
    expect(settlePending(ran as PendingPrompt, empty)).toBe('drop');
  });
});
