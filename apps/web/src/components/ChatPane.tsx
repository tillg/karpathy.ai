import type { ChatEvent, ChatMessage, ChatPart, ChatSummary, ToolCall } from '@karpathy/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, errorText } from '../lib/api';
import { applyChatEvent, changedPaths, type ChatView } from '../lib/chat';
import { readNdjson } from '../lib/ndjson';
import { useApp } from '../store';
import { Icon } from './Icon';
import { Markdown } from './NotePane';
import { VaultSwitcher } from './VaultSwitcher';

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((r) => {
  const t = setTimeout(r, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); r(); });
});

const when = (t: number) => {
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** Loads a chat and, while its turn isn't idle, follows the live stream (reattaching on drops). */
function useChat(vaultId: string, chatId: string) {
  const [chat, setChat] = useState<ChatView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const attach = useCallback(async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    for (let attempt = 0; !c.signal.aborted; attempt++) {
      try {
        const d = await api.chat(vaultId, chatId);
        if (c.signal.aborted) return;
        setError(null);
        setChat((prev) => ({ ...d, readonly: d.turn === 'idle' ? undefined : prev?.readonly }));
        if (d.turn === 'idle') return;
        const res = await api.chatStream(vaultId, chatId, c.signal);
        attempt = 0;
        await readNdjson<ChatEvent>(res, (e) => setChat((v) => v && applyChatEvent(v, e)));
        // Stream ended: the turn went idle (or the connection dropped) — reload and check.
      } catch (e) {
        if (c.signal.aborted || (e instanceof ApiError && e.status < 500)) {
          if (!c.signal.aborted) setError(errorText(e));
          return;
        }
        await sleep(Math.min(15_000, 1000 * 2 ** attempt), c.signal);
      }
    }
  }, [vaultId, chatId]);

  useEffect(() => {
    setChat(null);
    void attach();
    const wake = () => document.visibilityState === 'visible' && void attach();
    document.addEventListener('visibilitychange', wake);
    return () => { ctrl.current?.abort(); document.removeEventListener('visibilitychange', wake); };
  }, [attach]);

  return { chat, setChat, error, attach };
}

function ToolChip({ call }: { call: ToolCall }) {
  const { openNote } = useApp();
  const target = call.path ?? call.title ?? '';
  if (call.status === 'denied')
    return <span className="tc denied" data-testid="tool-chip" data-status="denied" data-path={call.path} title={call.error}><Icon n="nosign" size={14} />denied · {call.tool} {target}</span>;
  if (call.writes && call.status === 'completed' && call.path)
    return <button className="tc ed" data-testid="tool-chip" data-status="completed" data-writes="true" data-path={call.path} onClick={() => void openNote(call.path!)}><Icon n="pencil" size={14} />changed {call.path}</button>;
  const icon = call.status === 'completed' ? <span className="ok"><Icon n="checkmark" size={14} /></span>
    : call.status === 'error' ? <span className="err"><Icon n="xmark" size={14} /></span> : <span className="spin" />;
  return <span className={`tc${call.status === 'error' ? ' error' : ''}`} data-testid="tool-chip" data-status={call.status} data-writes={String(call.writes)} data-path={call.path} title={call.error}>{icon}{call.writes ? 'changing' : call.tool} {target}</span>;
}

function Parts({ parts }: { parts: ChatPart[] }) {
  const out: React.ReactNode[] = [];
  let tools: ToolCall[] = [];
  const flushTools = (key: string) => {
    if (tools.length) out.push(<div className="tcs" key={key}>{tools.map((t) => <ToolChip key={t.id} call={t} />)}</div>);
    tools = [];
  };
  parts.forEach((p, i) => {
    if (p.type === 'tool') { tools.push(p.call); return; }
    flushTools(`t${i}`);
    if (p.type === 'reasoning') out.push(<details key={p.id} className="reason"><summary>Thinking</summary><div>{p.text}</div></details>);
    else out.push(<Markdown key={p.id} text={p.text} className="atext" />);
  });
  flushTools('end');
  return <>{out}</>;
}

function Message({ m, model }: { m: ChatMessage; model: string }) {
  const { openNote } = useApp();
  if (m.role === 'user') return <div className="u">{m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}</div>;
  const changed = changedPaths(m.parts);
  return (
    <div className="a" data-testid="assistant-message">
      <div className="who"><img src="/icon-192.png" alt="" />karpathy.ai · {m.model?.split('/').pop() ?? model}</div>
      <Parts parts={m.parts} />
      {m.error && <div className="form-error">{m.error}</div>}
      {changed.length > 0 && (
        <div className="acts">
          {changed.map((p) => (
            <button key={p} className="btn" data-testid="open-changed" data-path={p} onClick={() => void openNote(p)}>
              <Icon n="arrow_up_right_square" size={16} />Open {changed.length > 1 ? p.split('/').pop() : 'changed page'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Conversation({ vaultId, chatId }: { vaultId: string; chatId: string }) {
  const { settings, conflict, online, toast } = useApp();
  const { chat, setChat, error, attach } = useChat(vaultId, chatId);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const model = (settings?.model ?? '').split('/').pop() ?? '';
  const busy = chat?.turn === 'queued' || chat?.turn === 'running';

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, pending]);
  useEffect(() => {
    // Drop the optimistic bubble once the server has the message (or the turn is over).
    if (!pending || !chat) return;
    const last = [...chat.messages].reverse().find((m) => m.role === 'user');
    const lastText = last?.parts.map((p) => (p.type === 'text' ? p.text : '')).join('').trim();
    if (lastText === pending || chat.turn === 'idle') setPending(null);
  }, [chat, pending]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    setPending(t);
    try {
      await api.prompt(vaultId, chatId, t);
      setChat((c) => c && { ...c, turn: 'queued' });
      void attach();
    } catch (e) {
      setPending(null);
      setText(t);
      toast(errorText(e));
    }
  };
  const stop = async () => {
    try { await api.abort(vaultId, chatId); } catch (e) { toast(errorText(e)); }
  };

  return (
    <>
      <div className="scroll" ref={scroller}>
        {(chat?.readonly || conflict) && <div className="banner warn" data-testid="chat-readonly">The vault is in conflict — the AI can only read, not change notes, until it is resolved.</div>}
        <div className="msgs" data-testid="chat-messages">
          {!chat && !error && <div className="day">Loading…</div>}
          {error && <div className="form-error">{error}</div>}
          {chat && !chat.messages.length && !pending && <div className="day">New chat · ask about this vault</div>}
          {chat?.messages.map((m) => <Message key={m.id} m={m} model={model} />)}
          {pending && <div className="u pending">{pending}</div>}
          {chat?.turn === 'queued' && <div className="turn-state" data-testid="chat-queued"><span className="spin" />{chat.waiting === 'sync' ? 'Waiting for sync…' : 'Waiting for other chat…'}</div>}
          {chat?.turn === 'running' && <div className="turn-state"><span className="spin" />Working…</div>}
          {chat?.error && <div className="form-error">{chat.error}</div>}
        </div>
      </div>
      <div className="comp">
        <div className="inrow">
          <textarea data-testid="chat-composer" rows={1} placeholder={online ? 'Ask about your vault…' : 'Chat needs a connection'}
            value={text} disabled={!online}
            onChange={(e) => { setText(e.target.value); e.target.style.height = ''; e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          {busy
            ? <button className="send stop" data-testid="chat-stop" aria-label="Stop" onClick={() => void stop()}><Icon n="stop_fill" size={16} /></button>
            : <button className="send" data-testid="chat-send" aria-label="Send" disabled={!text.trim() || !online} onClick={() => void send()}><Icon n="arrow_up" size={20} /></button>}
        </div>
      </div>
    </>
  );
}

function ChatList({ vaultId }: { vaultId: string }) {
  const { setChatId, toast, online, phone } = useApp();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.chats(vaultId).then((c) => { setChats(c); setError(null); })
      .catch((e) => setError(e instanceof ApiError && e.status === 503 ? 'The AI chat is not available on this server yet.' : errorText(e)));
  }, [vaultId]);
  useEffect(() => { if (online) load(); }, [load, online]);
  const remove = async (c: ChatSummary) => {
    if (!confirm(`Delete chat “${c.title || 'Untitled'}”?`)) return;
    try { await api.deleteChat(vaultId, c.id); load(); } catch (e) { toast(errorText(e)); }
  };
  return (
    <div className="scroll">
      {phone && <VaultSwitcher />}
      {!online && <div className="empty">Chat needs a connection.</div>}
      {online && error && <div className="empty" data-testid="chat-unavailable">{error}</div>}
      {chats && !chats.length && <div className="empty">No chats in this vault yet.</div>}
      {chats && chats.length > 0 && (
        <div className="grp">
          {chats.map((c) => (
            <div className="row" key={c.id}>
              <button className="row-main" data-testid="chat-item" onClick={() => setChatId(c.id)}>
                <span className="ic"><Icon n="bubble_left" size={20} /></span><span className="nm">{c.title || 'Untitled chat'}</span><span className="cnt">{when(c.updatedAt)}</span>
              </button>
              <button className="ib sm danger" title="Delete chat" data-testid="chat-delete" onClick={() => void remove(c)}><Icon n="trash" size={17} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatPane() {
  const { activeId, chatId, setChatId, usable, settings, phone, setChatOpen, toast } = useApp();
  const newChat = async () => {
    if (!activeId) return;
    try { setChatId((await api.newChat(activeId)).chatId); } catch (e) { toast(errorText(e)); }
  };
  return (
    <section className="pane always" id="chat">
      <div className="bar">
        {chatId
          ? <button className="ib back" data-testid="chat-back" onClick={() => setChatId(null)}><Icon n="chevron_left" size={24} /><span>Chats</span></button>
          : <span className="bar-title">Chats</span>}
        <div className="ctitle">{chatId && <span className="model">{(settings?.model ?? '').split('/').pop()}</span>}</div>
        <span className="sp" />
        <button className="ib" title="New chat" data-testid="new-chat" disabled={!usable} onClick={() => void newChat()}><Icon n="square_pencil" /></button>
        {!phone && <button className="ib" title="Close chat" onClick={() => setChatOpen(false)}><Icon n="xmark" /></button>}
      </div>
      {!usable || !activeId ? <div className="scroll"><div className="empty">Open a vault to chat about it.</div></div>
        : chatId ? <Conversation key={chatId} vaultId={activeId} chatId={chatId} /> : <ChatList vaultId={activeId} />}
    </section>
  );
}
