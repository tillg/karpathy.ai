import { useEffect, useState, type ReactNode } from 'react';
import { dismissReminder, reminderDue, type Dismissed } from '../lib/reminder';
import { useApp } from '../store';

export function Modal({ title, onClose, children, wide, testid }: { title: string; onClose(): void; children: ReactNode; wide?: boolean; testid?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title} data-testid={testid}>
        <div className="modal-bar"><b>{title}</b><button className="ib txt" onClick={onClose}>Close</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Toast() {
  const { toastMsg } = useApp();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!toastMsg) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), 2600);
    return () => clearTimeout(t);
  }, [toastMsg]);
  return <div id="toast" className={on ? 'on' : ''} role="status" data-testid="toast">{toastMsg?.text}</div>;
}

export function StaleDialog() {
  const { stale, reloadNote, overwriteNote, setStale } = useApp();
  if (!stale) return null;
  return (
    <Modal title="Note changed elsewhere" onClose={() => setStale(null)} testid="stale-dialog">
      <p><b>{stale.path}</b> was changed by the AI or another device since you opened it. Your edits were not saved.</p>
      <div className="acts">
        <button className="btn g" data-testid="stale-reload" onClick={() => void reloadNote()}>Reload (drop my edits)</button>
        <button className="btn" data-testid="stale-overwrite" onClick={() => void overwriteNote()}>Overwrite with mine</button>
      </div>
    </Modal>
  );
}

/** Commit reminder (mvp §2.4); the show/dismiss logic lives in lib/reminder. */
export function ReminderDialog() {
  const { status, settings, activeId, commitOpen, setCommitOpen } = useApp();
  const [dismissed, setDismissed] = useState<Record<string, Dismissed>>({});
  const count = status?.changedCount ?? 0;
  const threshold = settings?.commitReminderThreshold ?? 4;
  const level = (activeId && dismissed[activeId]) || 0;
  const r = reminderDue(count, threshold, level);
  useEffect(() => {
    if (activeId && r.dismissed !== level) setDismissed((d) => ({ ...d, [activeId]: r.dismissed }));
  }, [activeId, r.dismissed, level]);
  if (!r.show || commitOpen || !activeId) return null;
  const dismiss = () => setDismissed((d) => ({ ...d, [activeId]: dismissReminder(count, threshold) }));
  return (
    <Modal title="Time to commit?" onClose={dismiss} testid="reminder-dialog">
      <p>This vault has <b>{count} uncommitted changes</b>. Commit and push them to GitHub so Obsidian and your other devices see them.</p>
      <div className="acts">
        <button className="btn g" onClick={dismiss}>Later</button>
        <button className="btn" data-testid="reminder-commit" onClick={() => { dismiss(); setCommitOpen(true); }}>Commit…</button>
      </div>
    </Modal>
  );
}
