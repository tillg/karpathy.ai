import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore } from '../src/config-store.js';
import { GitHubToken } from '../src/github-token.js';

const store = async () => ConfigStore.open(await mkdtemp(join(tmpdir(), 'tok-')));
const A = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('GitHubToken', () => {
  it('stored token wins over secret; clear falls back; none when neither', async () => {
    const t = new GitHubToken(await store(), A);
    expect(t.current()).toBe(A);
    expect(t.source()).toBe('secret');
    await t.set(B);
    expect(t.current()).toBe(B);
    expect(t.source()).toBe('settings');
    await t.clear();
    expect(t.current()).toBe(A);
    expect(t.source()).toBe('secret');
    const none = new GitHubToken(await store(), undefined);
    expect(none.current()).toBeUndefined();
    expect(none.source()).toBe('none');
  });

  it('after set(B), messages containing old token A and B are both redacted', async () => {
    const t = new GitHubToken(await store(), A);
    await t.set(B);
    expect(t.redact(`fatal: ${A} and ${B}`)).toBe('fatal: *** and ***');
    expect(new GitHubToken(await store(), undefined).redact('plain')).toBe('plain');
  });
});
