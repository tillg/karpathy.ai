import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { dismissReminder, reminderDue, type Dismissed } from '../lib/reminder';
import { useApp } from '../store';

const TABBABLE = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
const tabbables = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));

/** Open dialogs, innermost last: only the top one is interactive (Escape, Tab trap); the app behind them is inert. */
const stack: HTMLElement[] = [];
function syncInert() {
  const root = document.getElementById('root');
  if (root) root.inert = stack.length > 0;
  stack.forEach((el, i) => { el.inert = i < stack.length - 1; });
}

/**
 * Modal dialog (ARIA dialog pattern, issue #39): labelled by its title; on open, focus moves to
 * `[data-autofocus]`, else the first field, else the primary button, else the title (`focusTitle`
 * forces the title), and back to the opener on close. Tab stays inside, Escape closes, the rest
 * of the page is inert.
 */
export function Modal({ title, onClose, children, wide, testid, className, focusTitle }: { title: string; onClose(): void; children: ReactNode; wide?: boolean; testid?: string; className?: string; focusTitle?: boolean }) {
  const titleId = useId();
  const scrim = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });

  useLayoutEffect(() => {
    const el = scrim.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(el);
    syncInert();
    const body = box.current!.querySelector<HTMLElement>('.modal-body')!;
    const first = (focusTitle ? null : body.querySelector<HTMLElement>('[data-autofocus]')
      ?? tabbables(body).find((x) => x.matches('input, textarea, select'))
      ?? tabbables(body).find((x) => x.matches('.btn:not(.g)')))
      ?? box.current!.querySelector<HTMLElement>('h2');
    first?.focus();
    return () => {
      stack.splice(stack.indexOf(el), 1);
      syncInert();
      if (opener?.isConnected && !opener.closest('[inert]')) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== scrim.current) return;
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const t = tabbables(box.current!);
      if (!t.length) return;
      // Always move focus ourselves: Safari's native Tab skips buttons and would leave the dialog.
      e.preventDefault();
      const i = t.indexOf(document.activeElement as HTMLElement);
      const n = t.length;
      t[i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n]!.focus();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  return createPortal(
    <div className="modal-scrim" ref={scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`} ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid={testid}>
        <div className="modal-bar"><h2 id={titleId} tabIndex={-1}>{title}</h2><button className="ib txt" onClick={onClose}>Close</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
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
  // Outside #root, which is inert while a dialog is open: toasts must still be announced.
  return createPortal(<div id="toast" className={on ? 'on' : ''} role="status" data-testid="toast">{toastMsg?.text}</div>, document.body);
}

export function StaleDialog() {
  const { stale, reloadNote, overwriteNote, setStale } = useApp();
  if (!stale) return null;
  return (
    // Both choices drop someone's text: focus the title, not a button Enter would trigger.
    <Modal title="Note changed elsewhere" onClose={() => setStale(null)} testid="stale-dialog" focusTitle>
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
  const { status, settings, activeId, commitOpen, setCommitOpen, conflict } = useApp();
  const [dismissed, setDismissed] = useState<Record<string, Dismissed>>({});
  const count = status?.changedCount ?? 0;
  const threshold = settings?.commitReminderThreshold ?? 4;
  const level = (activeId && dismissed[activeId]) || 0;
  const r = reminderDue(count, threshold, level);
  useEffect(() => {
    if (activeId && r.dismissed !== level) setDismissed((d) => ({ ...d, [activeId]: r.dismissed }));
  }, [activeId, r.dismissed, level]);
  // In Conflict a commit can only fail; the conflict banner is the call to action (issue #21).
  if (!r.show || commitOpen || !activeId || conflict) return null;
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
