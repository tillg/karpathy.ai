import { useState } from 'react';
import { api, errorText, setToken } from '../lib/api';

export function TokenScreen({ onDone }: { onDone(): void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setToken(value.trim());
    try {
      await api.health();
      onDone();
    } catch (err) {
      setError(errorText(err) === 'unauthorized' ? 'That token was not accepted.' : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="token-screen">
      <form className="token-card" onSubmit={submit}>
        <img src="/icon-192.png" alt="" className="token-logo" />
        <h1>karpathy.ai</h1>
        <p>Enter the access token of this server. It is stored on this device only.</p>
        <input
          data-testid="token-input" type="password" autoComplete="current-password" placeholder="Access token"
          value={value} onChange={(e) => setValue(e.target.value)} autoFocus
        />
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn wide" data-testid="token-submit" disabled={!value.trim() || busy}>{busy ? 'Checking…' : 'Continue'}</button>
      </form>
    </main>
  );
}
