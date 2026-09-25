import { useApp } from '../store';
import { Admin } from './Admin';
import { ChatPane } from './ChatPane';
import { CommitDialog } from './CommitDialog';
import { ReminderDialog, StaleDialog, Toast } from './Dialogs';
import { Icon } from './Icon';
import { NotePane } from './NotePane';
import { Sidebar } from './Sidebar';

const TABS = [
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'chat', label: 'Chat', icon: 'bubble_left' },
  { id: 'changes', label: 'Changes', icon: 'arrow_2_circlepath' },
] as const;

export function Shell() {
  const s = useApp();
  const { phone, wide, phoneTab, phoneNote, status } = s;
  const cls = [
    phone ? 'phone' : wide ? 'wide' : 'tablet',
    s.chatOpen && !phone ? 'insp' : '',
    s.sidebarOpen && !phone ? 'sbopen' : '',
  ].join(' ');
  // Phone: push navigation. The tab root is "cur"; an open note is pushed over it.
  const pos = (id: 'sidebar' | 'detail' | 'chat') => {
    if (!phone) return undefined;
    if (phoneTab === 'chat') return id === 'chat' ? 'cur' : 'off';
    if (id === 'chat') return 'off';
    if (id === 'sidebar') return phoneNote ? 'behind' : 'cur';
    return phoneNote ? 'cur' : 'ahead';
  };
  // Off-screen/covered panes are inert, so Tab and screen readers skip them (issue #26).
  const tablet = !phone && !wide;
  const inert = (id: 'sidebar' | 'detail' | 'chat') => {
    if (phone) return pos(id) !== 'cur';
    if (!tablet) return false;
    if (id === 'sidebar') return !s.sidebarOpen;
    if (id === 'chat') return !s.chatOpen;
    return s.sidebarOpen || s.chatOpen;
  };
  return (
    <>
      <div id="app" className={cls} data-sb={pos('sidebar')} data-dt={pos('detail')} data-ch={pos('chat')}>
        <Sidebar inert={inert('sidebar')} />
        <NotePane inert={inert('detail')} />
        <ChatPane inert={inert('chat')} />
        {phone && (
          <nav id="tabbar">
            {TABS.map((t) => (
              <button key={t.id} className={phoneTab === t.id ? 'on' : ''} data-testid={`tab-${t.id}`}
                onClick={() => { if (phoneTab === t.id) s.setPhoneNote(false); s.setPhoneTab(t.id); }}>
                <span className="tab-ic"><Icon n={t.icon} size={25} />
                  {t.id === 'changes' && status?.changedCount ? <span className="tab-badge" data-testid="changes-badge-tab">{status.changedCount}</span> : null}
                </span>
                {t.label}
              </button>
            ))}
          </nav>
        )}
        <div id="scrim" className={!phone && !wide && (s.sidebarOpen || s.chatOpen) ? 'on' : ''}
          onClick={() => { s.setSidebarOpen(false); s.setChatOpen(false); }} />
      </div>
      {s.adminOpen && <Admin />}
      {s.commitOpen && <CommitDialog />}
      <StaleDialog />
      <ReminderDialog />
      <Toast />
    </>
  );
}
