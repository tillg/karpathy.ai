import type { ChatDetail, ChatEvent, ChatPart } from '@karpathy/shared';

export interface ChatView extends ChatDetail {
  readonly?: boolean;
  /** What a queued turn waits for. */
  waiting?: 'turn' | 'sync';
  error?: string;
}

/** Applies one stream event to the chat (pure). */
export function applyChatEvent(c: ChatView, e: ChatEvent): ChatView {
  switch (e.type) {
    case 'turn':
      return { ...c, turn: e.state, readonly: e.readonly ?? c.readonly, waiting: e.waiting };
    case 'error':
      return { ...c, error: e.message };
    case 'message': {
      const i = c.messages.findIndex((m) => m.id === e.message.id);
      if (i < 0) return { ...c, messages: [...c.messages, { ...e.message, parts: [] }] };
      const messages = [...c.messages];
      messages[i] = { ...messages[i]!, ...e.message };
      return { ...c, messages };
    }
    case 'part':
      return mapMessage(c, e.messageId, (parts) => {
        const i = parts.findIndex((p) => p.id === e.part.id);
        if (i < 0) return [...parts, e.part];
        const next = [...parts];
        next[i] = e.part;
        return next;
      });
    case 'text-delta':
      return mapMessage(c, e.messageId, (parts) => {
        const i = parts.findIndex((p) => p.id === e.partId);
        if (i < 0) return [...parts, { type: 'text', id: e.partId, text: e.delta }];
        const p = parts[i]!;
        if (p.type === 'tool') return parts;
        const next = [...parts];
        next[i] = { ...p, text: p.text + e.delta };
        return next;
      });
  }
}

function mapMessage(c: ChatView, id: string, fn: (parts: ChatPart[]) => ChatPart[]): ChatView {
  let found = false;
  const messages = c.messages.map((m) => {
    if (m.id !== id) return m;
    found = true;
    return { ...m, parts: fn(m.parts) };
  });
  // A part can arrive before its message meta; create a placeholder assistant message.
  if (!found) messages.push({ id, role: 'assistant', createdAt: Date.now(), parts: fn([]) });
  return { ...c, messages };
}

/** Files a message's completed write tools changed, in order, deduplicated. */
export function changedPaths(parts: ChatPart[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === 'tool' && p.call.writes && p.call.status === 'completed' && p.call.path && !out.includes(p.call.path)) out.push(p.call.path);
  }
  return out;
}

/** An optimistic prompt shown as a user bubble until the server has the message. */
export interface PendingPrompt {
  text: string;
  /** User messages in the chat when the prompt was sent. */
  userCount: number;
  /** The server accepted (queued) the prompt. */
  sent: boolean;
  /** The turn was seen running. */
  ran: boolean;
}

export const userCount = (c: ChatView | null) => c?.messages.filter((m) => m.role === 'user').length ?? 0;

/**
 * Next state of a pending prompt given the latest chat (pure): keep it (possibly updated),
 * `drop` it (the server has the message), or `restore` it to the composer — the turn went idle
 * without ever running (stopped while queued, or the pull before it failed).
 */
export function settlePending(p: PendingPrompt, c: ChatView): PendingPrompt | 'drop' | 'restore' {
  if (userCount(c) > p.userCount) return 'drop';
  if (!p.sent) return p;
  if (c.turn === 'running') return p.ran ? p : { ...p, ran: true };
  if (c.turn === 'idle') return p.ran ? 'drop' : 'restore';
  return p;
}

/**
 * A prompt queued on the server (after a reload, or sent from another device) becomes the pending
 * bubble when this client has none, so it is visible and a Stop restores it (pure).
 */
export function adoptQueued(p: PendingPrompt | null, c: ChatView): PendingPrompt | null {
  if (p || c.turn !== 'queued' || !c.queuedText) return p;
  return { text: c.queuedText, userCount: userCount(c), sent: true, ran: false };
}
