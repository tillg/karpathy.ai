import { useEffect, useState } from 'react';
import { ApiError, api, errorText } from '../lib/api';
import { useApp } from '../store';
import { Modal } from './Dialogs';

const PROPOSAL_TIMEOUT_MS = 16_000;

export function CommitDialog() {
  const { activeId, flush, setCommitOpen, toast, setStatus, status } = useApp();
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<'saving' | 'proposing' | 'ready' | 'committing'>('saving');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId) return;
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), PROPOSAL_TIMEOUT_MS);
    (async () => {
      await flush(); // the pending autosave must land before the commit (mvp §2.4)
      if (c.signal.aborted) return;
      setPhase('proposing');
      try {
        setMessage((await api.commitMessage(activeId, c.signal)).message);
      } catch {
        const n = status?.changedCount ?? 0;
        setMessage(`Update ${n} file${n === 1 ? '' : 's'}`);
      }
      setPhase('ready');
    })();
    return () => { clearTimeout(t); c.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const close = () => setCommitOpen(false);
  const commit = async () => {
    if (!activeId) return;
    setPhase('committing');
    setError(null);
    try {
      // Never commit without the typed text (mvp §2.4): a failed save (e.g. stale) stops here.
      if (!(await flush())) {
        setError('The open note could not be saved, so nothing was committed. Resolve the save problem first.');
        setPhase('ready');
        return;
      }
      const r = await api.commit(activeId, message);
      if (!r.commit) toast('Nothing to commit');
      else toast(r.pushed ? 'Committed and pushed to GitHub' : `Committed; push failed: ${r.pushError ?? 'unknown error'}`);
      setStatus(await api.status(activeId));
      close();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'conflict' ? 'Pulling from GitHub ran into a conflict. Resolve it in Changes, then commit.' : errorText(e));
      setPhase('ready');
    }
  };

  return (
    <Modal title="Commit & Push" onClose={close} testid="commit-dialog">
      <p className="muted">Records all uncommitted changes of this vault and pushes them to GitHub.</p>
      <div className="ta-wrap">
        <textarea data-testid="commit-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
          disabled={phase !== 'ready'} placeholder={phase === 'saving' ? 'Saving open note…' : 'Proposing a message…'} />
        {(phase === 'saving' || phase === 'proposing') && <span className="spin ta-spin" />}
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="acts">
        <button className="btn g" onClick={close}>Cancel</button>
        <button className="btn" data-testid="commit-submit" disabled={phase !== 'ready' || !message.trim()} onClick={() => void commit()}>
          {phase === 'committing' ? (status?.busy === 'turn' ? 'Waiting for AI turn…' : 'Committing…') : 'Commit & Push'}
        </button>
      </div>
    </Modal>
  );
}
