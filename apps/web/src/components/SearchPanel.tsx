import type { SearchHit } from '@karpathy/shared';
import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from '../lib/api';
import { useApp } from '../store';
import { Icon } from './Icon';

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return text;
  const start = Math.max(0, i - 40);
  return <>{start ? '…' : ''}{text.slice(start, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export function SearchPanel() {
  const { activeId, openNote, online, usable } = useApp();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const text = q.trim();
    if (!text || !activeId || !usable) { setHits(null); return; }
    const c = new AbortController();
    const t = setTimeout(() => {
      api.search(activeId, text, c.signal).then((h) => { setHits(h); setError(null); }).catch((e) => !c.signal.aborted && setError(errorText(e)));
    }, 250);
    return () => { clearTimeout(t); c.abort(); };
  }, [q, activeId, usable]);

  const groups = useMemo(() => {
    const m = new Map<string, SearchHit[]>();
    for (const h of hits ?? []) m.set(h.path, [...(m.get(h.path) ?? []), h]);
    return [...m];
  }, [hits]);

  return (
    <div className="search">
      <div className="sinput">
        <Icon n="search" size={18} />
        <input data-testid="search-input" type="search" placeholder={online ? 'Search vault' : 'Search needs a connection'}
          value={q} onChange={(e) => setQ(e.target.value)} disabled={!online} autoComplete="off" />
      </div>
      {error && <div className="form-error">{error}</div>}
      {hits && <div className="meta">{hits.length} matches · {groups.length} notes</div>}
      {hits && !hits.length && <div className="empty">No results for “{q}”</div>}
      {groups.map(([path, hs]) => (
        <div key={path} className="hit">
          <button className="t" data-testid="search-result" data-path={path} onClick={() => void openNote(path, hs.find((h) => h.line)?.line)}>
            <Icon n="doc_text" size={17} />{path.split('/').pop()}
          </button>
          <div className="p">{path}</div>
          {hs.filter((h) => h.line).slice(0, 4).map((h) => (
            <button key={h.line} className="sn" onClick={() => void openNote(path, h.line)}>
              <em>L{h.line}</em>{highlight(h.text.trim(), q.trim())}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
