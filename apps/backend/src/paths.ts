import { lstat } from 'node:fs/promises';
import { isAbsolute, join, posix } from 'node:path';

export class PathError extends Error {}

/**
 * Resolves a vault-root-relative path to an absolute one, rejecting anything that escapes
 * the vault root: absolute paths, `..`, `.git`, and symlinks anywhere along the path
 * (mvp §3.2). Missing trailing components are fine (new files).
 */
export async function resolveInVault(vaultRoot: string, relPath: string): Promise<string> {
  const rel = normalizeRel(relPath);
  let cur = vaultRoot;
  for (const seg of rel.split('/')) {
    cur = join(cur, seg);
    let st;
    try {
      st = await lstat(cur);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw e;
    }
    if (st.isSymbolicLink()) throw new PathError(`symlinks are not allowed: ${relPath}`);
  }
  return join(vaultRoot, rel);
}

export function normalizeRel(relPath: string): string {
  if (typeof relPath !== 'string' || relPath === '' || relPath.includes('\0')) throw new PathError('invalid path');
  const p = relPath.replaceAll('\\', '/');
  if (isAbsolute(p) || p.startsWith('/')) throw new PathError(`absolute paths are not allowed: ${relPath}`);
  const segs = p.split('/').filter((s) => s !== '' && s !== '.');
  if (segs.length === 0) throw new PathError('invalid path');
  if (segs.includes('..')) throw new PathError(`path escapes the vault: ${relPath}`);
  if (segs[0] === '.git' || segs.includes('.git')) throw new PathError(`.git is off limits: ${relPath}`);
  return posix.join(...segs);
}
