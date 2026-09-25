import { useEffect, useMemo, useRef } from 'react';
import { frontmatterProps, renderMarkdown, splitFrontmatter } from '../lib/markdown';
import { useApp } from '../store';
import { Editor, type EditorHandle } from './Editor';
import { GitPill } from './GitPill';
import { Icon } from './Icon';

/** Rendered Read mode; `[[wikilinks]]` are clickable. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const { exists, followLink } = useApp();
  const html = useMemo(() => renderMarkdown(text, exists), [text, exists]);
  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest<HTMLElement>('a.wl');
        if (!a) return;
        e.preventDefault();
        followLink(a.dataset.target ?? '');
      }} />
  );
}

function ReadView({ text }: { text: string }) {
  const { frontmatter, body } = splitFrontmatter(text);
  return (
    <div className="read" data-testid="read-view">
      {frontmatter !== null && (
        <div className="props">
          {frontmatterProps(frontmatter).map(([k, v]) => <div className="prop" key={k}><span>{k}</span><span>{v}</span></div>)}
        </div>
      )}
      <Markdown text={body} className="rd" />
    </div>
  );
}

export function NotePane() {
  const s = useApp();
  const { note, mode, setMode, readOnly, online, conflict, phone, wide } = s;
  const editor = useRef<EditorHandle>(null);
  const draft = useRef('');

  useEffect(() => { if (note?.goto && mode === 'write') editor.current?.gotoLine(note.goto.line); }, [note?.goto, mode, note?.loadNonce]);
  useEffect(() => { draft.current = note?.loaded ?? ''; }, [note?.loadNonce, note?.loaded]);

  const title = note ? note.path.split('/').pop()!.replace(/\.md$/i, '') : '';
  const del = () => { if (note && confirm(`Delete ${note.path}? It stays recoverable until you commit.`)) void s.deleteNote(); };

  return (
    <section className="pane always" id="detail">
      <div className="bar">
        {!phone && <button className="ib" title="Toggle sidebar" data-testid="sidebar-toggle" onClick={() => s.setSidebarOpen(!s.sidebarOpen)}><Icon n="sidebar_left" /></button>}
        {phone && <button className="ib back" data-testid="back" onClick={() => s.setPhoneNote(false)}><Icon n="chevron_left" size={24} /><span>{s.phoneTab === 'search' ? 'Search' : s.phoneTab === 'changes' ? 'Changes' : 'Files'}</span></button>}
        {note && !phone && <span className="crumb">{note.path.split('/').join(' › ')}</span>}
        <span className="sp" />
        {!wide && !phone && <GitPill small />}
        {note && (
          <>
            <div className="seg" data-testid="mode-toggle">
              <button className={mode === 'write' ? 'on' : ''} data-testid="mode-write" onClick={() => setMode('write')}>Write</button>
              <button className={mode === 'read' ? 'on' : ''} data-testid="mode-read" onClick={() => setMode('read')}>Read</button>
            </div>
            {mode === 'write' && <button className="ib" title="Find in note" data-testid="find-in-note" onClick={() => editor.current?.openSearch()}><Icon n="search" /></button>}
            <button className="ib" title="Delete note" data-testid="delete-note" disabled={readOnly} onClick={del}><Icon n="trash" /></button>
          </>
        )}
        <button className={`ib${s.chatOpen && !phone ? ' on' : ''}`} title="AI chat" data-testid="chat-toggle"
          onClick={() => (phone ? s.setPhoneTab('chat') : s.setChatOpen(!s.chatOpen))}><Icon n="sparkles" /></button>
      </div>
      <div className="scroll">
        {!online && <div className="banner warn" data-testid="offline-banner">Offline — showing cached notes, read-only.</div>}
        {online && conflict && <div className="banner warn" data-testid="conflict-banner">This vault is in conflict with GitHub — read-only until resolved in <button className="link" onClick={() => { s.setSection('changes'); s.setPhoneTab('changes'); s.setPhoneNote(false); s.setSidebarOpen(true); }}>Changes</button>.</div>}
        {note ? (
          <div className="doc">
            <h1 className="note-title">{title}</h1>
            {mode === 'write'
              ? <Editor key={note.path} ref={editor} doc={note.loaded} readOnly={readOnly}
                  onChange={(t) => { draft.current = t; s.editDraft(t); }} exists={s.exists} onWikilink={s.followLink} />
              : <ReadView text={note.dirty ? draft.current : note.loaded} />}
            <div className="dfoot" data-testid="save-state">
              {note.saving ? 'Saving…' : note.dirty ? '● Unsaved changes' : 'Saved'}{readOnly ? ' · read-only' : ''}
            </div>
          </div>
        ) : (
          <div className="placeholder">
            <img src="/icon-192.png" alt="" />
            <p>{s.usable ? 'Pick a note from the file tree.' : s.active ? `Vault is ${s.active.state}…` : 'Add a vault to get started.'}</p>
            {!s.active && <button className="btn" onClick={() => s.setAdminOpen(true)}>Manage vaults</button>}
          </div>
        )}
      </div>
    </section>
  );
}
