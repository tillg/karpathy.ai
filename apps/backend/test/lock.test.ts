import { describe, expect, it } from 'vitest';
import { VaultLock } from '../src/lock.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('VaultLock', () => {
  it('lets shared holders overlap', async () => {
    const lock = new VaultLock();
    const a = await lock.acquireShared('save');
    const b = await lock.acquireShared('turn');
    expect(lock.busy).toBe('turn');
    a();
    b();
    expect(lock.isFree).toBe(true);
  });

  it('exclusive waits for running shared holders and blocks new ones', async () => {
    const lock = new VaultLock();
    const order: string[] = [];
    const save = await lock.acquireShared('save');
    const ex = lock.acquireExclusive().then((r) => {
      order.push('exclusive');
      return r;
    });
    const later = lock.acquireShared('save').then((r) => {
      order.push('later-save');
      return r;
    });
    await tick();
    expect(order).toEqual([]);
    expect(lock.busy).toBe('sync');
    save();
    const releaseEx = await ex;
    await tick();
    expect(order).toEqual(['exclusive']);
    releaseEx();
    (await later)();
    expect(order).toEqual(['exclusive', 'later-save']);
  });

  it('tryExclusive is null when not immediately free', async () => {
    const lock = new VaultLock();
    const s = await lock.acquireShared('turn');
    expect(lock.tryExclusive()).toBeNull();
    s();
    const r = lock.tryExclusive();
    expect(r).not.toBeNull();
    r!();
  });

  it('exclusiveThenShared keeps queued exclusives out until the shared part ends', async () => {
    const lock = new VaultLock();
    const order: string[] = [];
    const turn = lock.exclusiveThenShared('turn', async () => {
      order.push('pull');
      lock.acquireExclusive().then((r) => {
        order.push('commit');
        r();
      });
      await tick();
    });
    const releaseTurn = await turn;
    await tick();
    expect(order).toEqual(['pull']);
    expect(lock.busy).toBe('turn');
    releaseTurn();
    await tick();
    expect(order).toEqual(['pull', 'commit']);
  });

  it('releases the exclusive lock when the exclusive part throws', async () => {
    const lock = new VaultLock();
    await expect(lock.exclusiveThenShared('turn', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(lock.isFree).toBe(true);
  });
});
