import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapEvent, mapToolPart, toVaultPath, writtenPaths, type HarnessEvent } from '../src/harness/map.js';

// Real opencode 1.18.25 event captures from the Phase 0 spike (vault root /vaults/a).
const raw = readFileSync(join(import.meta.dirname, 'fixtures/opencode-events.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const events = raw.map((e) => mapEvent(e, '/vaults/a')).filter((e): e is HarnessEvent => e !== null);

describe('opencode → harness mapping (real captures)', () => {
  it('maps busy/idle status, messages, text deltas', () => {
    const states = events.filter((e) => e.type === 'status').map((e) => (e as { state: string }).state);
    expect(states).toContain('busy');
    expect(states).toContain('idle');
    expect(events.some((e) => e.type === 'message' && e.message.role === 'user')).toBe(true);
    expect(events.some((e) => e.type === 'text-delta' && e.delta.length > 0)).toBe(true);
  });

  it('maps write/edit tool parts with vault-relative paths; denied calls get status denied', () => {
    const tools = events.flatMap((e) => (e.type === 'part' && e.part.type === 'tool' ? [e.part.call] : []));
    const completedWrite = tools.find((t) => t.tool === 'write' && t.status === 'completed');
    expect(completedWrite).toMatchObject({ writes: true });
    expect(completedWrite!.path).not.toMatch(/^\/vaults\/a\//);
    const denied = tools.find((t) => t.status === 'denied');
    expect(denied).toMatchObject({ tool: 'write', path: 'opencode.json' });
    expect(denied!.error).toBeUndefined();
  });

  it('file.edited → vault-relative path', () => {
    const fe = events.filter((e) => e.type === 'file-edited');
    expect(fe.length).toBeGreaterThan(0);
    for (const e of fe) expect((e as { path: string }).path.startsWith('/')).toBe(false);
  });
});

describe('mapping edge cases', () => {
  it('relative tool paths are resolved against the vault root (#12)', () => {
    expect(toVaultPath('./Home.md', '/vaults/a')).toBe('Home.md');
    expect(toVaultPath('notes/../Home.md', '/vaults/a')).toBe('Home.md');
    expect(toVaultPath('../b/x.md', '/vaults/a')).toBe('/vaults/b/x.md');
    // The vault root itself: no container path in the chip.
    expect(toVaultPath('/vaults/a', '/vaults/a')).toBe('');
    expect(mapToolPart({ id: 'p', tool: 'glob', state: { status: 'completed', input: { path: '/vaults/a' } } }, '/vaults/a').path).toBeUndefined();
  });

  it('paths outside the root stay absolute', () => {
    expect(toVaultPath('/vaults/b/x.md', '/vaults/a')).toBe('/vaults/b/x.md');
    expect(toVaultPath('/vaults/a/n/x.md', '/vaults/a')).toBe('n/x.md');
  });

  it('apply_patch files come from metadata', () => {
    const part = { id: 'p', tool: 'apply_patch', state: { status: 'completed', input: { patchText: '…' }, metadata: { files: [{ filePath: '/vaults/a/x.md' }, { filePath: '/vaults/a/y.md', movePath: '/vaults/a/z.md' }] } } };
    expect(mapToolPart(part, '/vaults/a')).toMatchObject({ path: 'x.md', writes: true, status: 'completed' });
    expect(writtenPaths(part, '/vaults/a')).toEqual(['x.md', 'y.md', 'z.md']);
  });

  it('abort → error event with aborted flag', () => {
    const e = mapEvent({ type: 'session.error', properties: { sessionID: 's', error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } } }, '/v');
    expect(e).toEqual({ type: 'error', sessionId: 's', message: 'Aborted', aborted: true });
  });
});
