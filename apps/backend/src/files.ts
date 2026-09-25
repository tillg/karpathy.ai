import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileEntry, SearchHit } from '@karpathy/shared';

export function versionOf(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Version of a file on disk, or null when it doesn't exist. */
export async function versionOfFile(abs: string): Promise<string | null> {
  try {
    return versionOf(await readFile(abs));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'EISDIR') return null;
    throw e;
  }
}

/** Recursive listing of the vault root; dot-entries (.git, .obsidian, .claude, …) are hidden. */
export async function listTree(root: string): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  async function walk(dir: string, rel: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ path: p, type: 'dir' });
        await walk(join(dir, e.name), p);
      } else if (e.isFile()) out.push({ path: p, type: 'file' });
    }
  }
  await walk(root, '');
  return out;
}

const MAX_HITS = 200;

/** ripgrep over the vault root (fixed string, case-insensitive), plus file-name matches. */
export async function search(root: string, q: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const needle = q.toLowerCase();
  for (const f of await listTree(root)) {
    if (f.type === 'file' && f.path.toLowerCase().includes(needle)) hits.push({ path: f.path, line: 0, text: f.path });
  }
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      'rg',
      ['--json', '--fixed-strings', '--ignore-case', '--max-count', '20', '--max-columns', '300', '--', q, '.'],
      { cwd: root, maxBuffer: 32 * 1024 * 1024 },
      (err, out) => {
        // Exit code 1 = no matches.
        if (err && (err as { code?: number }).code !== 1) reject(err);
        else resolve(out);
      },
    );
  });
  for (const line of stdout.split('\n')) {
    if (hits.length >= MAX_HITS) break;
    if (!line.startsWith('{"type":"match"')) continue;
    const m = JSON.parse(line) as { data: { path: { text?: string }; line_number: number; lines: { text?: string } } };
    const path = (m.data.path.text ?? '').replace(/^\.\//, '');
    hits.push({ path, line: m.data.line_number, text: (m.data.lines.text ?? '').trimEnd() });
  }
  return hits.slice(0, MAX_HITS);
}
