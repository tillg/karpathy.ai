import { describe, expect, it } from 'vitest';
import { adoptQueued, applyChatEvent, changedPaths, settlePending, turnAnnouncement, type ChatView, type PendingPrompt } from './chat';

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

describe('adoptQueued (#13: queued prompt after reload / from another device)', () => {
  it('shows the server-side queued prompt when there is no local one', () => {
    const p = adoptQueued(null, { ...empty, turn: 'queued', queuedText: 'hello' });
    expect(p).toEqual({ text: 'hello', userCount: 0, sent: true, ran: false });
    // Stopped while queued → back into the composer.
    expect(settlePending(p!, empty)).toBe('restore');
  });
  it('keeps a local pending prompt and ignores idle/running chats', () => {
    const local: PendingPrompt = { text: 'mine', userCount: 0, sent: false, ran: false };
    expect(adoptQueued(local, { ...empty, turn: 'queued', queuedText: 'x' })).toBe(local);
    expect(adoptQueued(null, { ...empty, turn: 'queued' })).toBeNull();
    expect(adoptQueued(null, { ...empty, turn: 'running', queuedText: 'x' })).toBeNull();
  });
});

describe('turnAnnouncement (issue #45)', () => {
  const reply = (text: string, error?: string): ChatView => ({
    ...empty,
    messages: [
      { id: 'u', role: 'user', createdAt: 1, parts: [{ type: 'text', id: 'p0', text: 'q' }] },
      { id: 'a', role: 'assistant', createdAt: 2, error, parts: [{ type: 'reasoning', id: 'r', text: 'hmm' }, { type: 'text', id: 'p1', text }] },
    ],
  });

  it('says nothing on the first load or without a state change (no deltas)', () => {
    expect(turnAnnouncement(undefined, { ...empty, turn: 'running' })).toBeNull();
    expect(turnAnnouncement('running', { ...reply('partial'), turn: 'running' })).toBeNull();
    expect(turnAnnouncement('idle', reply('old'))).toBeNull();
  });

  it('announces the start and the finished reply text (not the reasoning)', () => {
    expect(turnAnnouncement('queued', { ...empty, turn: 'running' })).toBe('AI is replying…');
    expect(turnAnnouncement('running', reply('It says hello.'))).toBe('Reply finished: It says hello.');
    expect(turnAnnouncement('running', reply('x'.repeat(500)))).toBe(`Reply finished: ${'x'.repeat(300)}…`);
    expect(turnAnnouncement('running', reply(''))).toBe('Reply finished');
  });

  it('announces waiting and failures', () => {
    expect(turnAnnouncement('idle', { ...empty, turn: 'queued', waiting: 'sync' })).toBe('Waiting for sync…');
    expect(turnAnnouncement('running', reply('', 'model down'))).toBe('Reply failed: model down');
    expect(turnAnnouncement('running', { ...reply('ok'), error: 'stream broke' })).toBe('Reply failed: stream broke');
  });
});
