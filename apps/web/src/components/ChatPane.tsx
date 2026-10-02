import type { ChatEvent, ChatPart, ChatSummary, ToolCall } from '@karpathy/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, errorText } from '../lib/api';
import { adoptQueued, applyChatEvent, changedPaths, newOpens, opensFromEvent, opensFromLoad, settlePending, turnAnnouncement, turns, userCount, type ChatView, type PendingPrompt, type Turn } from '../lib/chat';
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
  const app = useApp();
  const ui = useRef(app);
  ui.current = app;
  /** The AI's open requests of this chat: only a live one moves the UI, once (lib/chat.ts). */
  const opens = useRef(newOpens());

  const show = useCallback((path: string | null) => {
    const a = ui.current;
    if (!path || a.activeId !== vaultId) return;
    if (a.isEditing()) a.toast(`AI opened ${path}`);
    else void a.openNote(path);
  }, [vaultId]);
  // Outside the wide layout the note covers the chat (phone tab, tablet overlay): wait for the turn's end.
  const defer = () => !ui.current.wide;

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
        // A reload after a dropped stream also picks up opens that completed in the gap.
        show(opensFromLoad(opens.current, d.messages, d.turn, defer()));
        if (d.turn === 'idle') return;
        const res = await api.chatStream(vaultId, chatId, c.signal);
        attempt = 0;
        await readNdjson<ChatEvent>(res, (e) => { setChat((v) => v && applyChatEvent(v, e)); show(opensFromEvent(opens.current, e, defer())); });
        // Stream ended: the turn went idle (or the connection dropped) — reload and check.
      } catch (e) {
        if (c.signal.aborted || (e instanceof ApiError && e.status < 500)) {
          if (!c.signal.aborted) setError(errorText(e));
          return;
        }
        await sleep(Math.min(15_000, 1000 * 2 ** attempt), c.signal);
      }
    }
  }, [vaultId, chatId, show]);

  useEffect(() => {
    setChat(null);
    void attach();
    const wake = () => document.visibilityState === 'visible' && void attach();
    document.addEventListener('visibilitychange', wake);
    return () => { ctrl.current?.abort(); document.removeEventListener('visibilitychange', wake); };
  }, [attach]);

  return { chat, setChat, error, attach };
}

function ToolChip({ call, open, onToggle }: { call: ToolCall; open: boolean; onToggle(): void }) {
  const { openNote } = useApp();
  const target = call.path ?? call.title ?? '';
  const label = call.status === 'denied' || call.status === 'error'
    ? `${call.status === 'denied' ? 'denied · ' : ''}${call.tool} ${target}`
    : `${call.writes ? 'changing' : call.tool} ${target}`;
  // Failed and denied steps open their error on tap: touch devices can't show a tooltip (#63).
  if (call.status === 'denied' || call.status === 'error') {
    const icon = call.status === 'denied' ? <Icon n="nosign" size={14} /> : <span className="err"><Icon n="xmark" size={14} /></span>;
    return (
      <button className={`tc ${call.status}`} data-testid="tool-chip" data-status={call.status} data-writes={String(call.writes)} data-path={call.path}
        aria-expanded={open} onClick={onToggle} title={label}>
        {icon}<span className="tc-t">{label}</span>
      </button>
    );
  }
  if (call.opens && call.status === 'completed' && call.path)
    return <button className="tc ed" data-testid="tool-chip" data-status="completed" data-writes="false" data-opens="true" data-path={call.path} title={`opened ${call.path}`} onClick={() => void openNote(call.path!)}><Icon n="arrow_up_right_square" size={14} /><span className="tc-t">opened {call.path}</span></button>;
  if (call.writes && call.status === 'completed' && call.path)
    return <button className="tc ed" data-testid="tool-chip" data-status="completed" data-writes="true" data-path={call.path} title={`changed ${call.path}`} onClick={() => void openNote(call.path!)}><Icon n="pencil" size={14} /><span className="tc-t">changed {call.path}</span></button>;
  const icon = call.status === 'completed' ? <span className="ok"><Icon n="checkmark" size={14} /></span> : <span className="spin" />;
  return <span className="tc" data-testid="tool-chip" data-status={call.status} data-writes={String(call.writes)} data-path={call.path} title={label}>{icon}<span className="tc-t">{label}</span></span>;
}

/** One row of chips; a tapped failed chip shows its error under the row. */
function ToolRow({ tools }: { tools: ToolCall[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = tools.find((t) => t.id === open);
  return (
    <div className="tcs">
      {tools.map((t) => <ToolChip key={t.id} call={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />)}
      {shown && <div className="tc-msg" data-testid="tool-error" role="status">{shown.error || 'No error details.'}</div>}
    </div>
  );
}

function Parts({ parts }: { parts: ChatPart[] }) {
  const out: React.ReactNode[] = [];
  let tools: ToolCall[] = [];
  const flushTools = (key: string) => {
    if (tools.length) out.push(<ToolRow key={key} tools={tools} />);
    tools = [];
  };
  parts.forEach((p, i) => {
    if (p.type === 'tool') { tools.push(p.call); return; }
    flushTools(`t${i}`);
    if (p.type === 'reasoning') out.push(<details key={p.id} className="reason"><summary>Thinking</summary><div>{p.text}</div></details>);
    else out.push(<Markdown key={p.id} text={p.text} className="atext" base="" />);
  });
  flushTools('end');
  return <>{out}</>;
}

/** A user prompt, or one assistant turn: all its steps under one header (#63). */
function Message({ t, model }: { t: Turn; model: string }) {
  const { openNote } = useApp();
  if (t.role === 'user') return <div className="u">{t.message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}</div>;
  const changed = changedPaths(t.parts);
  return (
    <div className="a" data-testid="assistant-message">
      <div className="who"><img src="/icon-192.png" alt="" />karpathy.app · {t.model?.split('/').pop() ?? model}</div>
      <Parts parts={t.parts} />
      {t.errors.map((e, i) => <div className="form-error" key={i}>{e}</div>)}
      {changed.length > 0 && (
        <div className="changed" data-testid="turn-changed">
          <span>{changed.length === 1 ? 'Changed' : `${changed.length} pages changed`}</span>
          {changed.map((p) => (
            <button key={p} className="link" data-testid="open-changed" data-path={p} title={p} onClick={() => void openNote(p)}>
              <Icon n="arrow_up_right_square" size={14} />{p.split('/').pop()}
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
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const model = (settings?.model ?? '').split('/').pop() ?? '';
  const busy = chat?.turn === 'queued' || chat?.turn === 'running';
  // Screen readers hear turn changes and the finished reply, not every streamed delta (issue #45).
  const [said, setSaid] = useState('');
  const prevTurn = useRef<ChatView['turn'] | undefined>(undefined);
  useEffect(() => {
    if (!chat) return;
    const a = turnAnnouncement(prevTurn.current, chat);
    prevTurn.current = chat.turn;
    if (a) setSaid(a);
  }, [chat]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, pending]);
  // A list that was at the end stays there when its width changes and the text reflows (#105);
  // one scrolled up keeps its position.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Was it at the end before this resize? scrollTop is unchanged by a reflow, so compare with the previous sizes.
    // A scroll event may be delivered after a resize already changed the layout: then its sizes are not "before".
    let last = { h: el.scrollHeight, ch: el.clientHeight, w: el.offsetWidth };
    const measure = () => { last = { h: el.scrollHeight, ch: el.clientHeight, w: el.offsetWidth }; };
    const syncHeight = () => { if (el.offsetWidth === last.w) last = { ...last, h: el.scrollHeight, ch: el.clientHeight }; };
    el.addEventListener('scroll', syncHeight, { passive: true });
    const ro = new ResizeObserver(() => {
      if (last.h - last.ch - el.scrollTop <= 4) el.scrollTop = el.scrollHeight;
      measure();
    });
    // The list's own box and whatever it holds (a banner, the messages) all change its scroll height.
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    const mo = new MutationObserver((ms) => { ms.forEach((m) => m.addedNodes.forEach((n) => n instanceof Element && ro.observe(n))); syncHeight(); });
    mo.observe(el, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); el.removeEventListener('scroll', syncHeight); };
  }, []);
  useEffect(() => {
    // Keep the optimistic bubble until the server has the message; a prompt stopped while
    // still queued goes back into the composer.
    // A prompt queued before a reload or from another device comes from the server (`queuedText`).
    const p = chat && adoptQueued(pending, chat);
    if (!p || !chat) return;
    const r = settlePending(p, chat);
    if (r === 'drop') setPending(null);
    else if (r === 'restore') { setPending(null); setText((t) => t || p.text); }
    else if (r !== pending) setPending(r);
  }, [chat, pending]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy || pending) return;
    setText('');
    setPending({ text: t, userCount: userCount(chat), sent: false, ran: false });
    try {
      await api.prompt(vaultId, chatId, t);
      setPending((p) => p && { ...p, sent: true });
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
      <div className="sr-only" aria-live="polite" data-testid="chat-live">{said}</div>
      <div className="scroll" ref={scroller} tabIndex={0} role="region" aria-label="Messages">
        {(chat?.readonly || conflict) && <div className="banner warn" data-testid="chat-readonly">The vault is in conflict — the AI can only read, not change notes, until it is resolved.</div>}
        <div className="msgs" data-testid="chat-messages">
          {!chat && !error && <div className="day">Loading…</div>}
          {error && <div className="form-error">{error}</div>}
          {chat && !chat.messages.length && !pending && <div className="day">New chat · ask about this vault</div>}
          {chat && turns(chat.messages).map((t) => <Message key={t.id} t={t} model={model} />)}
          {pending && <div className="u pending" data-testid="chat-pending">{pending.text}</div>}
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
  // Refresh the running/queued markers until every chat is idle.
  const busy = chats?.some((c) => c.turn !== 'idle');
  useEffect(() => {
    if (!busy || !online) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [busy, online, load]);
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
                <span className="ic"><Icon n="bubble_left" size={20} /></span><span className="nm" title={c.title || undefined}>{c.title || 'Untitled chat'}</span>
                {c.turn !== 'idle' && <span className={`turn-mark ${c.turn}`} data-testid="chat-turn" data-turn={c.turn}>{c.turn === 'running' ? 'Running' : 'Queued'}</span>}
                <span className="cnt">{when(c.updatedAt)}</span>
              </button>
              <button className="ib sm danger" title="Delete chat" data-testid="chat-delete" onClick={() => void remove(c)}><Icon n="trash" size={17} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Shown while a new chat is being created: nothing typed here can reach the chat just left (#62). */
function Starting() {
  return (
    <>
      <div className="scroll"><div className="msgs" data-testid="chat-messages"><div className="day">Starting new chat…</div></div></div>
      <div className="comp">
        <div className="inrow">
          <textarea data-testid="chat-composer" rows={1} placeholder="Starting new chat…" disabled />
          <button className="send" data-testid="chat-send" aria-label="Send" disabled><Icon n="arrow_up" size={20} /></button>
        </div>
      </div>
    </>
  );
}

export function ChatPane({ inert }: { inert?: boolean }) {
  const { activeId, chatId, setChatId, usable, settings, phone, setChatOpen, toast } = useApp();
  const [starting, setStarting] = useState(false);
  const vault = useRef(activeId);
  vault.current = activeId;
  /** Cleanup of the chat left for a new one; the chat list waits for it. */
  const cleaning = useRef<Promise<void>>(Promise.resolve());
  /** A chat that never got a message (e.g. its only prompt was stopped while queued) is deleted. */
  const dropIfEmpty = async (vaultId: string, id: string) => {
    try {
      const d = await api.chat(vaultId, id);
      if (!d.messages.length && d.turn === 'idle') await api.deleteChat(vaultId, id);
    } catch { /* best effort */ }
  };
  const leave = async () => {
    await cleaning.current;
    if (chatId && activeId) await dropIfEmpty(activeId, chatId);
    setChatId(null);
  };
  // The new chat replaces the old one at once; the old one is cleaned up behind it.
  const newChat = async () => {
    const v = activeId;
    if (!v || starting) return;
    const prev = chatId;
    setStarting(true);
    try {
      const { chatId: id } = await api.newChat(v);
      if (vault.current !== v) return;
      setChatId(id);
      if (prev) cleaning.current = dropIfEmpty(v, prev);
    } catch (e) { toast(errorText(e)); } finally { setStarting(false); }
  };
  return (
    <aside className="pane always" id="chat" inert={inert} aria-label="AI chat">
      <header className="bar">
        {chatId || starting
          ? <button className="ib back" data-testid="chat-back" disabled={starting} onClick={() => void leave()}><Icon n="chevron_left" size={24} /><span>Chats</span></button>
          : <span className="bar-title">Chats</span>}
        <div className="ctitle">{(chatId || starting) && <span className="model">{(settings?.model ?? '').split('/').pop()}</span>}</div>
        <span className="sp" />
        <button className="ib" title="New chat" data-testid="new-chat" disabled={!usable || starting} onClick={() => void newChat()}><Icon n="square_pencil" /></button>
        {!phone && <button className="ib" title="Close chat" onClick={() => setChatOpen(false)}><Icon n="xmark" /></button>}
      </header>
      {!usable || !activeId ? <div className="scroll"><div className="empty">Open a vault to chat about it.</div></div>
        : starting ? <Starting />
          : chatId ? <Conversation key={chatId} vaultId={activeId} chatId={chatId} /> : <ChatList vaultId={activeId} />}
    </aside>
  );
}
