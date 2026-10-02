import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * The open_note check (import-free, so the backend tests load it): `path` must name an existing file
 * inside `dir` that the file list would show (no dot-segments). Returns it vault-relative; throws
 * otherwise, which the AI sees as a tool error.
 */
export async function resolveNote(dir: string, path: string): Promise<string> {
  const root = await realpath(dir);
  const rel = relative(root, resolve(root, path));
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`outside the vault: ${path}`);
  if (rel.split(sep).some((s) => s.startsWith('.'))) throw new Error(`no such note: ${rel}`);
  const real = await realpath(resolve(root, rel)).catch(() => null);
  if (!real || !(await stat(real)).isFile()) throw new Error(`no such note: ${rel}`);
  if (relative(root, real).startsWith('..')) throw new Error(`outside the vault: ${path}`);
  return rel;
}
