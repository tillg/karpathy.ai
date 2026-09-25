import type { Vault } from '@karpathy/shared';
import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { useApp } from '../store';
import { Modal } from './Dialogs';

interface Form { name: string; repo: string; branch: string; root: string }
const emptyForm: Form = { name: '', repo: '', branch: 'main', root: '' };

function VaultFields({ f, set, prefix }: { f: Form; set(f: Form): void; prefix: string }) {
  const field = (k: keyof Form, label: string, placeholder: string) => (
    <label className="field">
      <span>{label}</span>
      <input data-testid={`${prefix}-${k}`} value={f[k]} placeholder={placeholder} autoCapitalize="off" autoCorrect="off" spellCheck={false}
        onChange={(e) => set({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <>
      {field('name', 'Name', 'My wiki')}
      {field('repo', 'GitHub repo', 'owner/name')}
      {field('branch', 'Branch', 'main')}
      {field('root', 'Vault root (optional)', 'subfolder, empty = repo root')}
    </>
  );
}

function VaultRow({ v }: { v: Vault }) {
  const { reloadVaults, toast } = useApp();
  const [edit, setEdit] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!edit) return;
    const patch: Partial<Form> = {};
    for (const k of ['name', 'repo', 'branch', 'root'] as const) if (edit[k].trim() !== v[k]) patch[k] = edit[k].trim();
    try {
      if (Object.keys(patch).length) await api.patchVault(v.id, patch);
      setEdit(null);
      setError(null);
      await reloadVaults();
    } catch (e) { setError(errorText(e)); }
  };
  const remove = async () => {
    if (!confirm(`Remove vault “${v.name}”? This deletes the local clone only, never the GitHub repo.`)) return;
    try { await api.removeVault(v.id); toast(`Removed ${v.name}`); await reloadVaults(); } catch (e) { setError(errorText(e)); }
  };
  return (
    <div className="vrow" data-testid="admin-vault" data-vault={v.id} data-state={v.state}>
      <div className="vrow-h">
        <div className="nm"><b>{v.name}</b><small>{v.repo} · {v.branch}{v.root ? ` · /${v.root}` : ''}</small></div>
        <span className={`state s-${v.state}`}>{v.state}</span>
      </div>
      {v.state === 'clone-failed' && v.error && <div className="form-error">{v.error}</div>}
      {edit ? (
        <div className="form">
          <VaultFields f={edit} set={setEdit} prefix="edit" />
          <div className="acts"><button className="btn g" onClick={() => { setEdit(null); setError(null); }}>Cancel</button><button className="btn" data-testid="edit-save" onClick={() => void save()}>Save</button></div>
        </div>
      ) : (
        <div className="acts">
          <button className="btn g" data-testid="vault-edit" onClick={() => setEdit({ name: v.name, repo: v.repo, branch: v.branch, root: v.root })}>Edit</button>
          <button className="btn g danger" data-testid="vault-remove" onClick={() => void remove()}>Remove</button>
        </div>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
    </div>
  );
}

function SettingsForm() {
  const { settings, setSettings, toast } = useApp();
  const [threshold, setThreshold] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (settings) { setThreshold(String(settings.commitReminderThreshold)); setModel(settings.model); }
  }, [settings]);
  const save = async () => {
    try {
      setSettings(await api.patchSettings({ commitReminderThreshold: Number(threshold), model: model.trim() }));
      setError(null);
      toast('Settings saved');
    } catch (e) { setError(errorText(e)); }
  };
  return (
    <div className="form">
      <label className="field"><span>Commit reminder after (changed files)</span>
        <input data-testid="settings-threshold" type="number" min={1} max={1000} value={threshold} onChange={(e) => setThreshold(e.target.value)} /></label>
      <label className="field"><span>Model (server-wide, provider/model)</span>
        <input data-testid="settings-model" value={model} autoCapitalize="off" spellCheck={false} onChange={(e) => setModel(e.target.value)} /></label>
      <p className="muted">Provider keys live on the server only; the app never sees them.</p>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="acts"><button className="btn" data-testid="settings-save" onClick={() => void save()}>Save settings</button></div>
    </div>
  );
}

export function Admin() {
  const { vaults, reloadVaults, setAdminOpen, setActiveId, activeId } = useApp();
  const [form, setForm] = useState<Form>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void reloadVaults(); }, [reloadVaults]);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const v = await api.addVault({ name: form.name.trim(), repo: form.repo.trim(), branch: form.branch.trim() || 'main', root: form.root.trim() });
      setForm(emptyForm);
      setError(null);
      await reloadVaults();
      if (!activeId) void setActiveId(v.id);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Vaults & settings" onClose={() => setAdminOpen(false)} wide testid="admin">
      <div className="gh">Vaults</div>
      {vaults?.length === 0 && <p className="muted">No vaults yet. Each vault is an existing GitHub repo.</p>}
      {vaults?.map((v) => <VaultRow key={v.id} v={v} />)}
      <div className="gh">Add vault</div>
      <form className="form" onSubmit={add}>
        <VaultFields f={form} set={setForm} prefix="admin" />
        {error && <div className="form-error" role="alert" data-testid="admin-error">{error}</div>}
        <div className="acts"><button className="btn" data-testid="admin-add" disabled={busy || !form.repo.trim()}>{busy ? 'Adding…' : 'Add vault'}</button></div>
      </form>
      <div className="gh">Settings</div>
      <SettingsForm />
    </Modal>
  );
}
