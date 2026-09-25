import type { Change, ConflictChoice } from '@karpathy/shared';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorText } from '../lib/api';
import { collapse, lineDiff } from '../lib/linediff';
import { useApp } from '../store';
import { Modal } from './Dialogs';
import { Icon } from './Icon';
import { PathLabel } from './PathLabel';

const KIND: Record<Change['kind'], string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U' };

export function DiffView({ diff }: { diff: string }) {
  // Skip git's file header (diff --git / index / --- / +++); the file name is shown above.
  const all = diff.replace(/\n$/, '').split('\n');
  const first = all.findIndex((l) => l.startsWith('@@'));
  const lines = first > 0 ? all.slice(first) : all;
  return (
    <div className="diff" data-testid="diff">
      {lines.map((l, i) => {
        const cls = l.startsWith('@@') || l.startsWith('\\') ? 'hh' : l.startsWith('+') ? 'ad' : l.startsWith('-') ? 'de' : '';
        return <div key={i} className={`dl ${cls}`}>{l || ' '}</div>;
      })}
    </div>
  );
}

function ChangeRow({ c }: { c: Change }) {
  const { activeId, openNote, toast, readOnly, changesNonce } = useApp();
  const [diff, setDiff] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !activeId) return;
    api.diff(activeId, c.path).then((d) => setDiff(d.diff)).catch((e) => setDiff(`(${errorText(e)})`));
  }, [open, activeId, c.path, changesNonce]);
  const discard = async () => {
    if (!activeId || !confirm(`Discard all uncommitted changes to ${c.path}? This cannot be undone.`)) return;
    try { await api.discard(activeId, c.path); toast(`Discarded ${c.path}`); } catch (e) { toast(errorText(e)); }
  };
  return (
    <div className="chg" data-testid="change-item" data-path={c.path}>
      <div className="chg-row">
        <button className="chg-main" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={`kind k-${c.kind}`}>{KIND[c.kind]}</span>
          <PathLabel path={c.path} className="nm" />
          <Icon n={open ? 'chevron_down' : 'chevron_right'} size={13} />
        </button>
        {c.kind !== 'deleted' && <button className="ib sm" title="Open note" onClick={() => void openNote(c.path)}><Icon n="arrow_up_right_square" size={18} /></button>}
        <button className="ib sm danger" title="Discard" data-testid="discard" disabled={readOnly} onClick={() => void discard()}><Icon n="arrow_uturn_left" size={18} /></button>
      </div>
      {open && (diff === null ? <div className="meta">Loading diff…</div> : diff ? <DiffView diff={diff} /> : <div className="meta">No textual diff</div>)}
    </div>
  );
}

type Sides = { mine: string | null; theirs: string | null };

/** Line diff of the two sides of a conflict; unchanged runs beyond `context` lines are collapsed. */
function ConflictDiff({ sides, context }: { sides: Sides; context: number }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(() => collapse(lineDiff(sides.theirs ?? '', sides.mine ?? ''), all ? Infinity : context), [sides, context, all]);
  return (
    <>
      {sides.mine === null && <div className="meta cf-note">Deleted in this app / by the AI.</div>}
      {sides.theirs === null && <div className="meta cf-note">Deleted on GitHub.</div>}
      <div className="diff cdiff" data-testid="conflict-diff">
        {rows.map((r, i) => r.op === 'skip'
          ? <button key={i} className="dl hh skip" title="Show all lines" onClick={() => setAll(true)}>⋯ {r.count} unchanged line{r.count === 1 ? '' : 's'}</button>
          : <div key={i} className={`dl c-${r.op}`} data-op={r.op}><span className="g">{r.op === 'eq' ? '' : r.op}</span>{r.text || ' '}</div>)}
      </div>
    </>
  );
}

function ConflictFile({ path }: { path: string }) {
  const { activeId, setStatus, toast } = useApp();
  const [sides, setSides] = useState<Sides | null>(null);
  const [choice, setChoice] = useState<ConflictChoice>('both');
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (activeId) api.conflictSides(activeId, path).then(setSides).catch((e) => toast(errorText(e)));
  }, [activeId, path, toast]);
  const resolve = async () => {
    if (!activeId) return;
    setBusy(true);
    try { setStatus(await api.resolve(activeId, path, choice)); toast(`Resolved ${path}`); } catch (e) { toast(errorText(e)); } finally { setBusy(false); }
  };
  const controls = (
    <>
      <div className="seg full" role="radiogroup">
        {(['mine', 'theirs', 'both'] as const).map((c) => (
          <button key={c} className={choice === c ? 'on' : ''} data-testid={`keep-${c}`} onClick={() => setChoice(c)}>Keep {c}</button>
        ))}
      </div>
      <button className="btn wide" disabled={busy} data-testid="resolve" onClick={() => void resolve()}>{busy ? 'Resolving…' : 'Resolve'}</button>
    </>
  );
  const legend = <div className="cf-legend"><span><b className="c-mine">mine</b> this app / AI</span><span><b className="c-theirs">theirs</b> GitHub</span></div>;
  return (
    <div className="conflict" data-testid="conflict-item" data-path={path}>
      <div className="chg-row"><Icon n="exclamationmark_triangle" size={17} /><PathLabel path={path} className="nm mono" /></div>
      {legend}
      {sides ? <ConflictDiff sides={sides} context={1} /> : <div className="meta">Loading…</div>}
      <button className="btn g wide" data-testid="conflict-compare" disabled={!sides} onClick={() => setBig(true)}>
        <Icon n="arrow_up_left_arrow_down_right" size={15} />Compare larger
      </button>
      {controls}
      {big && sides && createPortal(
        <Modal title={path} onClose={() => setBig(false)} className="compare" testid="conflict-compare-dialog">
          {legend}
          <ConflictDiff sides={sides} context={3} />
          <div className="cf-controls">{controls}</div>
        </Modal>,
        document.body,
      )}
    </div>
  );
}

export function ChangesPanel() {
  const { activeId, status, changesNonce, setCommitOpen, readOnly, toast, setStatus, online, usable, note, active, setAdminOpen } = useApp();
  // Tagged with its vault, so another vault's list is never shown (issue #22).
  const [loaded, setLoaded] = useState<{ vault: string; changes: Change[] } | null>(null);
  const [pushing, setPushing] = useState(false);
  useEffect(() => {
    if (!activeId || !online || !usable) return;
    api.changes(activeId).then((changes) => setLoaded({ vault: activeId, changes })).catch(() => {});
  }, [activeId, changesNonce, online, usable]);
  const changes = usable && loaded?.vault === activeId ? loaded.changes : null;

  const retryPush = async () => {
    if (!activeId) return;
    setPushing(true);
    try {
      const r = await api.push(activeId);
      toast(r.pushed ? 'Pushed to GitHub' : `Push failed: ${r.pushError ?? 'unknown error'}`);
      setStatus(await api.status(activeId));
    } catch (e) { toast(errorText(e)); } finally { setPushing(false); }
  };

  const unpushed = status?.unpushedCount ?? 0;
  if (!usable) {
    return (
      <div className="changes">
        <div className="empty" data-testid="changes-unavailable">
          {active?.state === 'clone-failed'
            ? <>Vault could not be cloned. <button className="link" onClick={() => setAdminOpen(true)}>Edit vault</button></>
            : active ? `Vault is ${active.state}…` : 'No vault.'}
        </div>
      </div>
    );
  }
  return (
    <div className="changes">
      {status?.state === 'conflict' && (
        <>
          <div className="banner warn">Conflict with changes pulled from GitHub. Writes are blocked until every file is resolved.</div>
          {status.conflictPaths.map((p) => <ConflictFile key={p} path={p} />)}
        </>
      )}
      {unpushed > 0 && (
        <div className="banner" data-testid="unpushed">
          {unpushed} unpushed commit{unpushed === 1 ? '' : 's'} · <button className="link" disabled={pushing} onClick={() => void retryPush()}>{pushing ? 'pushing…' : 'retry'}</button>
        </div>
      )}
      <div className="commit-bar">
        <span>{changes ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : '…'}</span>
        <button className="btn" data-testid="commit-button" disabled={readOnly || (!changes?.length && !note?.dirty)} onClick={() => setCommitOpen(true)}>
          <Icon n="arrow_up" size={16} />Commit &amp; Push
        </button>
      </div>
      {changes?.length === 0 && <div className="empty">No uncommitted changes.</div>}
      {changes?.map((c) => <ChangeRow key={c.path} c={c} />)}
    </div>
  );
}
