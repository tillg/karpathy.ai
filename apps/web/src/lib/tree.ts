import type { FileEntry } from '@karpathy/shared';

export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: TreeNode[];
}

/** Nests a flat listing; folders first, then files, each alphabetical. */
export function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);
  const dirOf = (path: string): TreeNode => {
    const hit = dirs.get(path);
    if (hit) return hit;
    const i = path.lastIndexOf('/');
    const node: TreeNode = { name: path.slice(i + 1), path, dir: true, children: [] };
    dirOf(i < 0 ? '' : path.slice(0, i)).children.push(node);
    dirs.set(path, node);
    return node;
  };
  for (const e of entries) {
    if (e.type === 'dir') dirOf(e.path);
    else {
      const i = e.path.lastIndexOf('/');
      dirOf(i < 0 ? '' : e.path.slice(0, i)).children.push({ name: e.path.slice(i + 1), path: e.path, dir: false, children: [] });
    }
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

/** The folders above a path, outermost first (`a/b/c.md` → `a`, `a/b`). */
export function ancestors(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

// Expanded folders per vault (#53): everything starts collapsed; the user's choice survives
// tab switches and reloads.
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const expandedKey = (vault: string) => `karpathy.tree:${vault}`;

export function loadExpanded(s: Store, vault: string): Set<string> {
  try {
    const v = JSON.parse(s.getItem(expandedKey(vault)) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveExpanded(s: Store, vault: string, expanded: Set<string>) {
  try { s.setItem(expandedKey(vault), JSON.stringify([...expanded])); } catch { /* quota / private mode: best effort */ }
}
