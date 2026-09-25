import { useMemo, useState } from 'react';
import { buildTree, type TreeNode } from '../lib/tree';
import { useApp } from '../store';
import { Icon } from './Icon';

export function FileTree() {
  const { files, note, openNote, newNote, readOnly, usable, online } = useApp();
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (p: string) => setCollapsed((c) => {
    const n = new Set(c);
    if (n.has(p)) n.delete(p); else n.add(p);
    return n;
  });

  const create = () => {
    const dir = note?.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/') + 1) : '';
    const name = prompt('New note (path inside the vault)', `${dir}Untitled.md`);
    if (!name?.trim()) return;
    const path = name.trim().replace(/^\/+/, '');
    // A trailing `/` goes to the server as typed, which rejects it with a readable message.
    void newNote(/\.[a-z0-9]+$/i.test(path) || path.endsWith('/') ? path : `${path}.md`);
  };

  const render = (nodes: TreeNode[], depth: number) => nodes.map((n) => (
    <div key={n.path}>
      <button
        className={`trow${n.dir ? ' dir' : ''}${note?.path === n.path ? ' sel' : ''}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        data-testid="tree-item" data-path={n.path} data-type={n.dir ? 'dir' : 'file'}
        aria-expanded={n.dir ? !collapsed.has(n.path) : undefined} aria-current={note?.path === n.path ? 'page' : undefined}
        onClick={() => (n.dir ? toggle(n.path) : void openNote(n.path))}
      >
        {n.dir
          ? <span className="tw"><Icon n={collapsed.has(n.path) ? 'chevron_right' : 'chevron_down'} size={12} /></span>
          : <span className="tw" />}
        <span className="ic"><Icon n={n.dir ? 'folder' : /\.md$/i.test(n.name) ? 'doc_text' : 'doc'} size={18} /></span>
        <span className="nm">{n.dir ? n.name : n.name.replace(/\.md$/i, '')}</span>
      </button>
      {n.dir && !collapsed.has(n.path) && render(n.children, depth + 1)}
    </div>
  ));

  return (
    <div className="tree">
      <div className="gh">Notes
        <button className="ib sm" title="New note" data-testid="new-note" onClick={create} disabled={readOnly || !usable}><Icon n="square_pencil" size={19} /></button>
      </div>
      {tree.length ? render(tree, 0) : <div className="empty">{!usable ? '' : online ? 'This vault is empty.' : 'Offline — the file list is not cached yet.'}</div>}
    </div>
  );
}
