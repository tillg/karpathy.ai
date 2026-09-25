import type { FileEntry, Settings, Vault, VaultEvent, VaultStatus } from '@karpathy/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, errorText } from './lib/api';
import { readNdjson } from './lib/ndjson';
import { parseWikilink, resolveWikilink } from './lib/wikilink';

export type Section = 'files' | 'search' | 'changes';
export type PhoneTab = Section | 'chat';

export interface NoteView {
  path: string;
  /** Text last loaded from the server; changes only on (re)load, never on save. */
  loaded: string;
  loadNonce: number;
  version: string;
  dirty: boolean;
  saving: boolean;
  goto?: { line: number; nonce: number };
}

const ACTIVE_KEY = 'karpathy.activeVault';
const AUTOSAVE_MS = 1500;

const headingLine = (text: string, heading: string) => {
  const i = text.split('\n').findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s+/, '').trim() === heading);
  return i >= 0 ? i + 1 : undefined;
};

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);
  return online;
}

export function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [q]);
  return m;
}

/** Live vault event stream with reconnect (backoff, on visible, on online). */
function useVaultEvents(vaultId: string | null, enabled: boolean, onEvent: (e: VaultEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!vaultId || !enabled) return;
    let stopped = false;
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const connect = async () => {
      clearTimeout(timer);
      ctrl?.abort();
      const c = new AbortController();
      ctrl = c;
      try {
        const res = await api.events(vaultId, c.signal);
        await readNdjson<VaultEvent>(res, (e) => { attempt = 0; handler.current(e); });
      } catch (e) {
        if (c.signal.aborted || (e instanceof ApiError && e.status === 401)) return;
      }
      if (stopped || c.signal.aborted) return;
      timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
    };
    const wake = () => { if (document.visibilityState === 'visible') { attempt = 0; void connect(); } };
    void connect();
    document.addEventListener('visibilitychange', wake);
    addEventListener('online', wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', wake);
      removeEventListener('online', wake);
    };
  }, [vaultId, enabled]);
}

function useAppState() {
  const online = useOnline();
  const phone = useMedia('(max-width: 699px)');
  const wide = useMedia('(min-width: 1024px)');

  const [toastMsg, setToastMsg] = useState<{ text: string; n: number } | null>(null);
  const toast = useCallback((text: string) => setToastMsg({ text, n: Date.now() }), []);

  // ---- vaults + settings ----
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activeId, setActiveIdState] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const reloadVaults = useCallback(async () => {
    try { setVaults(await api.vaults()); } catch (e) { toast(errorText(e)); setVaults((v) => v ?? []); }
  }, [toast]);
  useEffect(() => {
    void reloadVaults();
    api.settings().then(setSettings).catch(() => {});
  }, [reloadVaults]);
  useEffect(() => {
    if (!vaults?.some((v) => v.state === 'cloning')) return;
    const t = setInterval(() => void reloadVaults(), 2000);
    return () => clearInterval(t);
  }, [vaults, reloadVaults]);
  const active = vaults?.find((v) => v.id === activeId) ?? null;
  useEffect(() => {
    // Fall back to the first vault when the stored one is gone.
    if (vaults && vaults.length && !active) setActiveIdState(vaults[0]!.id);
  }, [vaults, active]);
  useEffect(() => { if (activeId) localStorage.setItem(ACTIVE_KEY, activeId); }, [activeId]);
  const usable = !!active && (active.state === 'ready' || active.state === 'conflict');

  // ---- status, files ----
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [changesNonce, setChangesNonce] = useState(0);
  const paths = useMemo(() => files.filter((f) => f.type === 'file').map((f) => f.path), [files]);
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const refreshFiles = useCallback(async () => {
    if (!activeId) return;
    try { setFiles(await api.files(activeId)); } catch (e) { toast(errorText(e)); }
  }, [activeId, toast]);

  useEffect(() => {
    setStatus(null);
    setFiles([]);
    if (!usable || !activeId) return;
    if (online) api.open(activeId).then(setStatus).catch((e) => toast(errorText(e)));
    void refreshFiles();
  }, [activeId, usable, online, refreshFiles, toast]);

  // ---- note + autosave ----
  const [note, setNote] = useState<NoteView | null>(null);
  const noteRef = useRef<{ path: string; version: string; saved: string; draft: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  const [stale, setStale] = useState<{ path: string } | null>(null);

  /** Resolves true when the open note's text is on the server (nothing to save counts). */
  const save = useCallback(async (force = false): Promise<boolean> => {
    clearTimeout(timer.current);
    while (inflight.current) await inflight.current;
    const n = noteRef.current;
    if (!n || !activeId || (!force && n.draft === n.saved)) return true;
    let ok = false;
    const text = n.draft;
    setNote((v) => v && { ...v, saving: true });
    inflight.current = api.putFile(activeId, n.path, text, n.version, force)
      .then((r) => {
        if (noteRef.current !== n) return;
        n.version = r.version;
        n.saved = text;
        ok = true;
        setStale(null);
        setNote((v) => v && { ...v, version: r.version, dirty: n.draft !== text });
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 409) setStale({ path: n.path });
        else if (e instanceof ApiError && e.status === 423) toast('Vault is in conflict — resolve it before editing');
        else toast(`Save failed: ${errorText(e)}`);
      })
      .finally(() => {
        inflight.current = null;
        setNote((v) => v && { ...v, saving: false });
      });
    await inflight.current;
    return ok;
  }, [activeId, toast]);

  const flush = useCallback(() => save(false), [save]);

  const editDraft = useCallback((text: string) => {
    const n = noteRef.current;
    if (!n) return;
    n.draft = text;
    setNote((v) => v && (v.dirty === (text !== n.saved) ? v : { ...v, dirty: text !== n.saved }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(false), AUTOSAVE_MS);
  }, [save]);

  const load = useCallback(async (path: string, line?: number, heading?: string) => {
    if (!activeId) return false;
    try {
      const f = await api.file(activeId, path);
      noteRef.current = { path, version: f.version, saved: f.content, draft: f.content };
      if (heading) line = headingLine(f.content, heading) ?? line;
      setNote({ path, loaded: f.content, loadNonce: Date.now(), version: f.version, dirty: false, saving: false, ...(line ? { goto: { line, nonce: Date.now() } } : {}) });
      return true;
    } catch (e) {
      toast(e instanceof ApiError && e.status === 404 ? `No page “${path}”` : errorText(e));
      return false;
    }
  }, [activeId, toast]);

  // ---- UI state ----
  const [section, setSection] = useState<Section>('files');
  const [phoneTab, setPhoneTab] = useState<PhoneTab>('files');
  // Phone: each tab has its own push stack; the note is pushed onto the tab it was opened from.
  const [noteTab, setNoteTab] = useState<PhoneTab | null>(null);
  const phoneNote = noteTab !== null && noteTab === phoneTab;
  const setPhoneNote = useCallback((on: boolean) => setNoteTab(on ? phoneTab : null), [phoneTab]);
  const [chatOpen, setChatOpen] = useState(() => innerWidth >= 1280);
  const [sidebarOpen, setSidebarOpen] = useState(wide);
  // Wide: the sidebar is a column (shown by default); tablet: an overlay (hidden by default).
  useEffect(() => setSidebarOpen(wide), [wide]);
  const [mode, setMode] = useState<'write' | 'read'>('write');
  const [adminOpen, setAdminOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);

  const openNote = useCallback(async (path: string, line?: number, heading?: string) => {
    const cur = noteRef.current;
    if (cur?.path === path) {
      const l = heading ? headingLine(cur.draft, heading) : line;
      if (l) setNote((v) => v && { ...v, goto: { line: l, nonce: Date.now() } });
    } else {
      await flush();
      if (!(await load(path, line, heading))) return;
      setMode('write');
    }
    if (phone) {
      const tab = phoneTab === 'chat' ? 'files' : phoneTab;
      setPhoneTab(tab);
      setNoteTab(tab);
    } else if (!wide) {
      setSidebarOpen(false);
      setChatOpen(false);
    }
  }, [flush, load, phone, wide, phoneTab]);

  const closeNote = useCallback(async () => {
    await flush();
    noteRef.current = null;
    setNote(null);
    setNoteTab(null);
  }, [flush]);

  const followLink = useCallback((inner: string) => {
    const l = parseWikilink(inner);
    if (!l.target) {
      if (l.heading && noteRef.current) void openNote(noteRef.current.path, undefined, l.heading);
      return;
    }
    const p = resolveWikilink(l.target, pathsRef.current);
    if (p) void openNote(p, undefined, l.heading);
    else toast(`No page “${l.target}” yet`);
  }, [openNote, toast]);

  const exists = useCallback((target: string) => resolveWikilink(target, pathsRef.current) !== null, []);

  const reloadNote = useCallback(async () => {
    const n = noteRef.current;
    clearTimeout(timer.current);
    setStale(null);
    if (n) await load(n.path);
  }, [load]);

  const overwriteNote = useCallback(() => save(true), [save]);

  const deleteNote = useCallback(async () => {
    const n = noteRef.current;
    if (!n || !activeId) return;
    try {
      clearTimeout(timer.current);
      await api.deleteFile(activeId, n.path, n.version);
      noteRef.current = null;
      setNote(null);
      setNoteTab(null);
      toast(`Deleted ${n.path}`);
      void refreshFiles();
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? 'The note changed since it was loaded — reload it first' : errorText(e));
    }
  }, [activeId, refreshFiles, toast]);

  const newNote = useCallback(async (path: string) => {
    if (!activeId) return;
    const title = path.split('/').pop()!.replace(/\.md$/i, '');
    try {
      await api.putFile(activeId, path, `# ${title}\n`, null);
      await refreshFiles();
      await openNote(path);
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? `${path} already exists` : errorText(e));
    }
  }, [activeId, refreshFiles, openNote, toast]);

  // Switching vaults: flush and drop the open note and chat.
  const setActiveId = useCallback(async (id: string) => {
    await flush();
    noteRef.current = null;
    setNote(null);
    setNoteTab(null);
    setChatId(null);
    setActiveIdState(id);
  }, [flush]);

  // ---- event stream ----
  const onEvent = useCallback((e: VaultEvent) => {
    if (e.type === 'status') {
      setStatus(e.status);
      setChangesNonce((x) => x + 1);
      return;
    }
    setChangesNonce((x) => x + 1);
    if (e.files.some((f) => f.version === null || !pathsRef.current.includes(f.path))) void refreshFiles();
    const n = noteRef.current;
    const hit = n && e.files.find((f) => f.path === n.path);
    if (!n || !hit || hit.version === n.version) return;
    if (hit.version === null) {
      if (n.draft === n.saved) toast(`${n.path} was deleted`);
      return;
    }
    // Unsaved changes are kept; the stale-save flow handles them on the next save.
    if (n.draft === n.saved && !inflight.current) {
      void load(n.path).then((ok) => ok && toast('Updated by AI or another device'));
    }
  }, [refreshFiles, load, toast]);
  useVaultEvents(usable ? activeId : null, online, onEvent);

  const conflict = status?.state === 'conflict';
  const readOnly = !online || conflict;

  return {
    online, phone, wide, toast, toastMsg,
    vaults, reloadVaults, settings, setSettings, active, activeId, setActiveId, usable,
    status, setStatus, files, paths, refreshFiles, changesNonce,
    note, openNote, closeNote, editDraft, flush, reloadNote, overwriteNote, deleteNote, newNote, stale, setStale,
    followLink, exists, readOnly, conflict,
    section, setSection, phoneTab, setPhoneTab, phoneNote, setPhoneNote, chatOpen, setChatOpen,
    sidebarOpen, setSidebarOpen, mode, setMode, adminOpen, setAdminOpen, commitOpen, setCommitOpen, chatId, setChatId,
  };
}

export type AppState = ReturnType<typeof useAppState>;
const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const s = useAppState();
  return <Ctx.Provider value={s}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useApp outside AppProvider');
  return s;
}
