import { useEffect, useMemo, useRef } from 'react';
import { frontmatterFields, renderMarkdown, splitFrontmatter, type FieldValue, type LinkCtx } from '../lib/markdown';
import { formatRoute } from '../lib/route';
import { parseWikilink, resolveRelativeLink, resolveWikilink, wikilinkLabel, WIKILINK_RE } from '../lib/wikilink';
import { useApp } from '../store';
import { Editor, type EditorHandle } from './Editor';
import { GitPill } from './GitPill';
import { Icon } from './Icon';

/** A plain left click is handled in-app; modified clicks (new tab, window, download) go to the browser (#109). */
const plainClick = (e: React.MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/** Where links in the open note point: wikilinks and relative Markdown links resolve to app routes (#109, #116). */
function useLinkCtx(): LinkCtx {
  const { activeId, paths, note } = useApp();
  const from = note?.path;
  return useMemo(() => {
    const route = (p: string) => formatRoute(activeId, p);
    return {
      href: (target) => { const p = resolveWikilink(target, paths); return p ? route(p) : null; },
      relative: (href) => { const p = from && resolveRelativeLink(href, from, paths); return p ? { path: p, href: route(p) } : null; },
    };
  }, [activeId, paths, from]);
}

/** Rendered Read mode; `[[wikilinks]]` and relative links to vault notes are clickable. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const { exists, followLink, openNote } = useApp();
  const ctx = useLinkCtx();
  const html = useMemo(() => renderMarkdown(text, exists, ctx), [text, exists, ctx]);
  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        // Footnote links jump inside this block, not through the hash router (#115).
        const fn = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#fn"]');
        if (fn) {
          e.preventDefault();
          e.currentTarget.querySelector(`[id="${fn.getAttribute('href')!.slice(1)}"]`)?.scrollIntoView({ block: 'center' });
          return;
        }
        const a = (e.target as HTMLElement).closest<HTMLElement>('a.wl, a[data-note]');
        if (!a || !plainClick(e)) return;
        e.preventDefault();
        if (a.dataset.note) void openNote(a.dataset.note, undefined, undefined, true);
        else followLink(a.dataset.target ?? '');
      }} />
  );
}

/**
 * Text with its `[[wikilinks]]` as links, resolved like the body's (#58). `bare`: a value without
 * `[[ ]]` that names an existing note (slug or file name) links too (#108).
 */
function Linked({ text, bare }: { text: string; bare?: boolean }) {
  const { exists, followLink } = useApp();
  const ctx = useLinkCtx();
  const out: React.ReactNode[] = [];
  let last = 0;
  const link = (key: number, inner: string) => {
    const l = parseWikilink(inner);
    out.push(
      <a key={key} href={(l.target && ctx.href(l.target)) || '#'} className={!l.target || exists(l.target) ? 'wl' : 'wl miss'} data-target={inner}
        onClick={(e) => { if (plainClick(e)) { e.preventDefault(); followLink(inner); } }}>{wikilinkLabel(l)}</a>,
    );
  };
  if (bare && !text.includes('[[') && text.trim() && exists(text.trim())) {
    link(0, text.trim());
    return <>{out}</>;
  }
  for (const m of text.matchAll(WIKILINK_RE)) {
    out.push(text.slice(last, m.index));
    link(m.index, m[1]!);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** Frontmatter keys whose list items are note references. */
const NOTE_REF_KEYS = new Set(['related', 'sources']);

function PropValue({ k, v }: { k: string; v: FieldValue }) {
  if (typeof v === 'string') return <span className="pv"><Linked text={v} /></span>;
  const bare = NOTE_REF_KEYS.has(k.toLowerCase());
  return <span className="pv chips">{v.map((item, i) => <span className="chip" key={i}><Linked text={item} bare={bare} /></span>)}</span>;
}

function ReadView({ text }: { text: string }) {
  const { frontmatter, body } = splitFrontmatter(text);
  return (
    <div className="read" data-testid="read-view">
      {frontmatter !== null && (
        <div className="props">
          {frontmatterFields(frontmatter).map(([k, v], i) => <div className="prop" key={`${k}${i}`}><span>{k}</span><PropValue k={k} v={v} /></div>)}
        </div>
      )}
      <Markdown text={body} className="rd" />
    </div>
  );
}

export function NotePane({ inert }: { inert?: boolean }) {
  const s = useApp();
  const { note, mode, setMode, readOnly, online, conflict, phone, wide } = s;
  const editor = useRef<EditorHandle>(null);

  useEffect(() => { if (note?.goto && mode === 'write') editor.current?.gotoLine(note.goto.line); }, [note?.goto, mode, note?.loadNonce]);
  // The editor opens with the current text (not `loaded`, which predates our own saves); it only
  // changes on (re)load or mode switch, so typing and saving never replace the editor's text (#101).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const editorDoc = useMemo(() => s.currentText(), [note?.path, note?.loadNonce, mode]);

  const title = note ? note.path.split('/').pop()!.replace(/\.md$/i, '') : '';
  const del = () => { if (note && confirm(`Delete ${note.path}? It stays recoverable until you commit.`)) void s.deleteNote(); };

  return (
    <main className="pane always" id="detail" inert={inert} aria-label="Note">
      <header className="bar">
        {!phone && <button className="ib" title="Toggle sidebar" data-testid="sidebar-toggle" onClick={() => s.setSidebarOpen(!s.sidebarOpen)}><Icon n="sidebar_left" /></button>}
        {phone && <button className="ib back" data-testid="back" onClick={() => s.setPhoneNote(false)}><Icon n="chevron_left" size={24} /><span>{s.phoneTab === 'search' ? 'Search' : s.phoneTab === 'changes' ? 'Changes' : 'Files'}</span></button>}
        {note && !phone && <span className="crumb">{note.path.split('/').join(' › ')}</span>}
        <span className="sp" />
        {!wide && !phone && <GitPill small />}
        {note && (
          <>
            {!note.binary && (
              <div className="seg" role="group" aria-label="Mode" data-testid="mode-toggle">
                <button className={mode === 'write' ? 'on' : ''} aria-pressed={mode === 'write'} data-testid="mode-write" onClick={() => setMode('write')}>Write</button>
                <button className={mode === 'read' ? 'on' : ''} aria-pressed={mode === 'read'} data-testid="mode-read" onClick={() => setMode('read')}>Read</button>
              </div>
            )}
            {mode === 'write' && !note.binary && <button className="ib" title="Find in note" data-testid="find-in-note" onClick={() => editor.current?.openSearch()}><Icon n="search" /></button>}
            <button className="ib" title="Delete note" data-testid="delete-note" disabled={readOnly || note.deleted} onClick={del}><Icon n="trash" /></button>
          </>
        )}
        <button className={`ib${s.chatOpen && !phone ? ' on' : ''}`} title="AI chat" data-testid="chat-toggle"
          onClick={() => (phone ? s.setPhoneTab('chat') : s.setChatOpen(!s.chatOpen))}><Icon n="sparkles" /></button>
      </header>
      <div className="scroll">
        {!online && <div className="banner warn" data-testid="offline-banner">Offline — showing cached notes, read-only.</div>}
        {note?.deleted && (
          <div className="banner warn" data-testid="deleted-banner">
            This note was deleted by the AI, another device or a discard.{note.dirty ? ' Your unsaved changes are still here.' : ''}
            <span className="banner-acts">
              <button className="link" data-testid="deleted-keep" disabled={readOnly} onClick={() => void s.keepDeletedNote()}>Keep as new note</button>
              <button className="link" data-testid="deleted-close" onClick={s.closeDeletedNote}>Close</button>
            </span>
          </div>
        )}
        {online && conflict && <div className="banner warn" data-testid="conflict-banner">This vault is in conflict with GitHub — read-only until resolved in <button className="link" onClick={() => { s.setSection('changes'); s.setPhoneTab('changes'); s.setPhoneNote(false); s.setSidebarOpen(true); }}>Changes</button>.</div>}
        {note?.binary ? (
          <div className="placeholder" data-testid="binary-file">
            <Icon n="doc" size={48} />
            <p><b>{note.path.split('/').pop()}</b><br />Binary file — can’t be edited here.</p>
          </div>
        ) : note ? (
          <div className="doc">
            <h2 className="note-title">{title}</h2>
            {mode === 'write'
              ? <Editor key={note.path} ref={editor} doc={editorDoc} docNonce={note.loadNonce} readOnly={readOnly || !!note.deleted}
                  onChange={s.editDraft} exists={s.exists} onWikilink={s.followLink} />
              : <ReadView text={s.currentText()} />}
            <div className="dfoot" data-testid="save-state">
              {note.saving ? 'Saving…' : note.dirty ? '● Unsaved changes' : 'Saved'}{readOnly ? ' · read-only' : ''}
            </div>
          </div>
        ) : (
          <div className="placeholder">
            <img src="/icon-192.png" alt="" />
            {s.active?.state === 'clone-failed' ? (
              <p data-testid="clone-failed">Vault could not be cloned{s.active.error ? `: ${s.active.error}` : '.'}</p>
            ) : (
              <p>{s.usable ? 'Pick a note from the file tree.' : s.active ? `Vault is ${s.active.state}…` : 'Add a vault to get started.'}</p>
            )}
            {(!s.active || s.active.state === 'clone-failed') && (
              <button className="btn" data-testid="manage-vaults-cta" onClick={() => s.setAdminOpen(true, s.active?.id)}>{s.active ? 'Edit vault' : 'Manage vaults'}</button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
