import { useApp } from '../store';

/** Changed-files count, always visible; opens Show changes. */
export function GitPill({ small }: { small?: boolean }) {
  const { status, setSection, setSidebarOpen, setPhoneTab, setPhoneNote, phone } = useApp();
  if (!status) return null;
  const n = status.changedCount;
  const busy = status.busy === 'sync' ? 'Syncing…' : status.busy === 'turn' ? 'AI working…' : null;
  const cls = status.state === 'conflict' ? 'conflict' : busy ? 'busy' : n ? 'dirty' : '';
  const text = status.state === 'conflict' ? 'Conflict' : busy ?? (n ? `${n} uncommitted` : 'All committed');
  return (
    <button className={`gitpill ${cls}${small ? ' small' : ''}`} data-testid="changes-badge" data-count={n}
      title={status.pullError ? `Last pull from GitHub failed: ${status.pullError}` : undefined}
      onClick={() => { setSection('changes'); setSidebarOpen(true); if (phone) { setPhoneTab('changes'); setPhoneNote(false); } }}>
      <span className="dot" />{text}{status.unpushedCount ? ` · ${status.unpushedCount} unpushed` : ''}{status.pullError ? ' · offline' : ''}
    </button>
  );
}
