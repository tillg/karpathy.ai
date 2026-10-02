import { useState } from 'react';
import { api, errorText, setToken } from '../lib/api';
import { parseLoginCode } from '../lib/login-code';
import { QrScanner } from './QrScanner';

export function TokenScreen({ onDone }: { onDone(): void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const login = async (token: string) => {
    setBusy(true);
    setError(null);
    setToken(token);
    try {
      await api.health();
      onDone();
    } catch (err) {
      setError(errorText(err) === 'unauthorized' ? 'That token was not accepted.' : errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void login(value.trim());
  };
  const scanned = (text: string) => {
    setScanning(false);
    const token = parseLoginCode(text);
    if (token) void login(token);
    else setError('That QR code is not a karpathy.app login code.');
  };

  return (
    <main className="token-screen">
      <form className="token-card" onSubmit={submit}>
        <img src="/icon-192.png" alt="" className="token-logo" />
        <h1>karpathy.app</h1>
        <p>Enter the access token of this server. It is stored on this device only.</p>
        <input
          data-testid="token-input" type="password" autoComplete="current-password" placeholder="Access token"
          value={value} onChange={(e) => setValue(e.target.value)} autoFocus
        />
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn wide" data-testid="token-submit" disabled={!value.trim() || busy}>{busy ? 'Checking…' : 'Continue'}</button>
        {scanning
          ? <QrScanner onCode={scanned} onCancel={() => setScanning(false)} />
          : <button type="button" className="btn g wide" data-testid="token-scan" disabled={busy} onClick={() => { setError(null); setScanning(true); }}>Scan QR code</button>}
      </form>
    </main>
  );
}
