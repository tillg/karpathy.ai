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
