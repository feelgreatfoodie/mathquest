import { describe, expect, it } from 'vitest';
import { LocalRepo } from './localRepo';
import { DEFAULT_SETTINGS, bossTimerOf, bossTimerPreOn, type KidSettings } from '../engine/models';
import { makeKid } from '../engine/newKid';
import { pauseOf } from '../engine/pause';

function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe('boss timer settings', () => {
  it('a missing value reads as normal and off, and junk reads the same', () => {
    expect(bossTimerOf(DEFAULT_SETTINGS)).toBe('normal');
    expect(bossTimerOf({ bossTimer: 'weird' })).toBe('normal');
    expect(bossTimerOf({ bossTimer: 'harder' })).toBe('harder');
    expect(bossTimerOf({ bossTimer: 'easier' })).toBe('easier');
    expect(bossTimerPreOn(DEFAULT_SETTINGS)).toBe(false);
    expect(bossTimerPreOn({ bossTimerPre: 'yes' })).toBe(false);
    expect(bossTimerPreOn({ bossTimerPre: true })).toBe(true);
  });

  it('saving bossTimer and bossTimerPre from a stale copy keeps a pause set since (settings.pause, #49)', async () => {
    installStorage();
    const repo = new LocalRepo();
    const kid = makeKid('Pip', 'prereader');
    await repo.createKid(kid);
    // The parent screen read the kid before this pause was set.
    const stale: KidSettings = { ...(await repo.getKid(kid.id))!.settings };
    await repo.setKidPause([kid.id], {});
    await repo.saveKidSettings(kid.id, { ...stale, bossTimer: 'harder', bossTimerPre: true });
    const got = (await repo.getKid(kid.id))!.settings;
    expect(got).toMatchObject({ bossTimer: 'harder', bossTimerPre: true });
    expect(pauseOf(got)).toMatchObject({ on: true });
    expect(got.sessionSize).toBe(stale.sessionSize);
  });

  it('the two fields write only themselves: nothing else in settings changes', async () => {
    installStorage();
    const repo = new LocalRepo();
    const kid = makeKid('Wren', 'reader');
    await repo.createKid(kid);
    const before = (await repo.getKid(kid.id))!.settings;
    await repo.saveKidSettings(kid.id, { ...before, bossTimer: 'easier' });
    const after = (await repo.getKid(kid.id))!.settings;
    expect({ ...after, bossTimer: undefined }).toEqual({ ...before, bossTimer: undefined });
    expect(after.bossTimer).toBe('easier');
  });
});
