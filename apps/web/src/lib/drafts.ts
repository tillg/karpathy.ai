// Unsaved note drafts persisted locally (issue #14), so a reload, closed tab or killed PWA
// doesn't lose them. Keyed by vault + path; `base` is the server version the draft was edited from.

export interface Draft { base: string; text: string }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const key = (vault: string, path: string) => `karpathy.draft:${vault}:${path}`;

export function putDraft(s: Store, vault: string, path: string, d: Draft) {
  try { s.setItem(key(vault, path), JSON.stringify(d)); } catch { /* quota / private mode: best effort */ }
}

export function getDraft(s: Store, vault: string, path: string): Draft | null {
  try {
    const d = JSON.parse(s.getItem(key(vault, path)) ?? 'null') as Draft | null;
    return d && typeof d.text === 'string' ? d : null;
  } catch {
    return null;
  }
}

export function dropDraft(s: Store, vault: string, path: string) {
  try { s.removeItem(key(vault, path)); } catch { /* ignore */ }
}

/**
 * What to do with a persisted draft when the note is (re)opened with the server's version/text:
 * nothing to restore, restore it (still based on the server version), or stale (the note changed
 * elsewhere since → stale-save flow).
 */
export function draftAction(d: Draft | null, version: string, text: string): 'none' | 'restore' | 'stale' {
  if (!d || d.text === text) return 'none';
  return d.base === version ? 'restore' : 'stale';
}

/** Drops every draft of a vault (it was removed). */
export function dropVaultDrafts(s: Pick<Storage, 'length' | 'key' | 'removeItem'>, vault: string) {
  const prefix = key(vault, '');
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(prefix)) keys.push(k); }
    for (const k of keys) s.removeItem(k);
  } catch { /* ignore */ }
}
