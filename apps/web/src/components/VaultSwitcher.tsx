import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { Icon } from './Icon';

/** Brand + active vault; opens a menu to switch vaults or manage them. */
export function VaultSwitcher({ compact }: { compact?: boolean }) {
  const { vaults, active, setActiveId, setAdminOpen } = useApp();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`vswitch${compact ? ' compact' : ''}`} ref={box}>
      <button className="brand" data-testid="vault-switcher" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        {!compact && <img src="/icon-192.png" alt="" />}
        <div>
          {!compact && <b>karpathy.ai</b>}
          <small>{active ? `${active.name} · ${active.branch}` : 'No vault'} <Icon n="chevron_down" size={11} /></small>
        </div>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="mh">Vaults · GitHub repos</div>
          {vaults?.map((v) => (
            <button key={v.id} className="mi" role="menuitem" data-testid="vault-option" data-vault={v.id}
              onClick={() => { setOpen(false); void setActiveId(v.id); }}>
              <span className="ck">{v.id === active?.id && <Icon n="checkmark" size={17} />}</span>
              <span>{v.name}<small>{v.repo}{v.state !== 'ready' ? ` · ${v.state}` : ''}</small></span>
            </button>
          ))}
          <hr />
          <button className="mi" role="menuitem" data-testid="manage-vaults" onClick={() => { setOpen(false); setAdminOpen(true); }}>
            <span className="ck"><Icon n="gear_alt" size={17} /></span><span>Manage vaults…<small>Add / configure repos, settings</small></span>
          </button>
        </div>
      )}
    </div>
  );
}
