import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDelta, dayKey } from '../../engine/game';
import { DEFAULT_GAME, type KidGame } from '../../engine/models';
import { BEETLE_GEMS, DOG_CHEST_GEMS } from './pets';
import { claimChest, offLimitsSpots, openChest, openedSpots, resolveTrip, shutSpots, syncChestDay } from './trip';

const KID = 'kidchestdaily0001';
const T0 = new Date('2026-11-22T10:00:00').getTime();
const LATER = new Date('2026-11-22T21:30:00').getTime();
const NEXT_DAY = new Date('2026-11-23T08:00:00').getTime();
const SPOT = 'meadow:17,5';
const reader = { gemSpeed: 1, gemFullRate: 25 };
const picture = { gemSpeed: 1, gemFullRate: 15 };
const game = (over: Partial<KidGame> = {}): KidGame => ({ ...DEFAULT_GAME, ...over });
const trip = (id: string, now = T0) => resolveTrip(null, now, () => id).trip;

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('a chest pays only for a right answer', () => {
  it('a wrong answer pays 0, opens nothing and shuts the spot for this trip', () => {
    const t = trip('a');
    expect(claimChest(KID, t, SPOT, false, undefined, T0)).toEqual({ opened: false, gems: 0, shut: true });
    expect(openedSpots(t)).toEqual([]);
    expect(shutSpots(t)).toEqual([SPOT]);
    expect(offLimitsSpots(t)).toContain(SPOT);
  });
  it('a right answer on a spot a wrong answer shut on this trip still pays nothing', () => {
    const t = trip('a');
    claimChest(KID, t, SPOT, false, undefined, T0);
    expect(claimChest(KID, t, SPOT, true, undefined, T0)).toEqual({ opened: false, gems: 0, shut: true });
  });
  it('a wrong answer on a dog chest and on a key chest pays 0 too', () => {
    const t = trip('a');
    expect(claimChest(KID, t, 'meadow:1,1', false, DOG_CHEST_GEMS, T0).gems).toBe(0);
    expect(claimChest(KID, t, 'meadow:2,2', false, undefined, T0).gems).toBe(0);
  });
  it('a right answer opens the chest and pays its base', () => {
    const t = trip('a');
    expect(claimChest(KID, t, SPOT, true, DOG_CHEST_GEMS, T0)).toEqual({ opened: true, gems: DOG_CHEST_GEMS });
    expect(openedSpots(t)).toEqual([SPOT]);
  });
  it('the grading result is the only input: the same answer gives the same outcome for a dog chest and a plain chest', () => {
    const plain = claimChest(KID, trip('a'), 'meadow:3,3', true, undefined, T0);
    const dog = claimChest(KID, trip('b'), 'meadow:4,4', true, DOG_CHEST_GEMS, T0);
    expect([plain.opened, dog.opened]).toEqual([true, true]);
    expect(claimChest(KID, trip('c'), 'meadow:5,5', false, undefined, T0).opened).toBe(false);
    expect(claimChest(KID, trip('d'), 'meadow:6,6', false, DOG_CHEST_GEMS, T0).opened).toBe(false);
  });
});

describe('a chest shut by a wrong answer', () => {
  it('stays shut for the rest of the trip, across a reopen of the trip', () => {
    const t = trip('a');
    claimChest(KID, t, SPOT, false, undefined, T0);
    syncChestDay(KID, t, LATER);
    expect(offLimitsSpots(t)).toContain(SPOT);
    expect(openedSpots(t)).not.toContain(SPOT);
  });
  it('is offered again on the next trip the same day, and a right answer then pays', () => {
    const t1 = trip('a');
    claimChest(KID, t1, SPOT, false, undefined, T0);
    const t2 = trip('b', LATER);
    syncChestDay(KID, t2, LATER);
    expect(offLimitsSpots(t2)).not.toContain(SPOT);
    expect(claimChest(KID, t2, SPOT, true, undefined, LATER).opened).toBe(true);
  });
});

describe('an opened chest waits for the next local day', () => {
  it('stays open on a new trip the same day and pays nothing again', () => {
    const t1 = trip('a');
    expect(claimChest(KID, t1, SPOT, true, undefined, T0).opened).toBe(true);
    const t2 = trip('b', LATER);
    syncChestDay(KID, t2, LATER);
    expect(openedSpots(t2)).toContain(SPOT);
    expect(claimChest(KID, t2, SPOT, true, undefined, LATER)).toEqual({ opened: false, gems: 0 });
  });
  it('refills on the next local day, on the same long trip and on a new one', () => {
    const t1 = trip('a');
    claimChest(KID, t1, SPOT, true, undefined, T0);
    syncChestDay(KID, t1, NEXT_DAY);
    expect(openedSpots(t1)).toEqual([]);
    expect(claimChest(KID, t1, SPOT, true, undefined, NEXT_DAY).opened).toBe(true);
    const t2 = trip('c', NEXT_DAY);
    syncChestDay(KID, t2, NEXT_DAY);
    expect(openedSpots(t2)).toEqual([SPOT]);
  });
  it('a trip stored before the day stamp counts as the day it started', () => {
    const old = trip('old', T0);
    old.chests = { opened: [SPOT] };
    syncChestDay(KID, old, LATER);
    expect(openedSpots(old)).toEqual([SPOT]);
    const stale = trip('stale', T0);
    stale.chests = { opened: [SPOT] };
    store.clear();
    syncChestDay(KID, stale, NEXT_DAY);
    expect(openedSpots(stale)).toEqual([]);
  });
  it('merges the spots another device paid today from the synced game', () => {
    const t = trip('a');
    syncChestDay(KID, t, T0, { chestsDay: dayKey(T0), chestsOpened: [SPOT] });
    expect(openChest(KID, t, SPOT, T0)).toBe(false);
    const t2 = trip('b', NEXT_DAY);
    syncChestDay(KID, t2, NEXT_DAY, { chestsDay: dayKey(T0), chestsOpened: [SPOT] });
    expect(openedSpots(t2)).toEqual([]);
  });
});

describe('chest gems go through the daily throttle', () => {
  const grant = (g: KidGame, base: number, settings = reader, learner: 'reader' | 'prereader' = 'reader', spot?: string, at = T0) =>
    applyDelta(g, { gemGrant: { base, learner, settings, ...(spot ? { spot } : {}) }, playedAt: at });
  const gained = (before: KidGame, after: KidGame) => after.gems - before.gems;
  const today = (n: number) => game({ gemsEarnedToday: n, gemsDay: dayKey(T0) });

  it('a reader gets the full chest to 25, half to 50 and a quarter after', () => {
    expect(gained(today(24), grant(today(24), 2))).toBe(2);
    expect(gained(today(25), grant(today(25), 2))).toBe(1);
    expect(gained(today(50), grant(today(50), 2))).toBe(1);
    expect(gained(today(24), grant(today(24), DOG_CHEST_GEMS))).toBe(3);
    expect(gained(today(25), grant(today(25), DOG_CHEST_GEMS))).toBe(1);
    expect(gained(today(50), grant(today(50), DOG_CHEST_GEMS))).toBe(1);
  });
  it('a picture player switches at 15 and 30', () => {
    expect(gained(today(14), grant(today(14), DOG_CHEST_GEMS, picture, 'prereader'))).toBe(3);
    expect(gained(today(15), grant(today(15), DOG_CHEST_GEMS, picture, 'prereader'))).toBe(1);
    expect(gained(today(30), grant(today(30), DOG_CHEST_GEMS, picture, 'prereader'))).toBe(1);
  });
  it('a chest gem counts toward today, so the next gem moves up a tier', () => {
    const g = grant(today(24), 2);
    expect(g.gemsEarnedToday).toBe(26);
    expect(gained(g, grant(g, 2))).toBe(1);
  });
  it('the Beetle gem passes the same tier and the same count', () => {
    const g = grant(today(0), BEETLE_GEMS);
    expect(g.gemsEarnedToday).toBe(1);
  });
  it('a spot pays at most once a day, on any trip and any device', () => {
    const first = grant(game(), 2, reader, 'reader', SPOT);
    expect(gained(game(), first)).toBe(2);
    expect(first.chestsOpened).toEqual([SPOT]);
    const second = grant(first, 2, reader, 'reader', SPOT, LATER); // a second device reading the stored game
    expect(gained(first, second)).toBe(0);
    expect(second.gemsEarnedToday).toBe(first.gemsEarnedToday);
    const other = grant(first, 2, reader, 'reader', 'meadow:9,9', LATER);
    expect(gained(first, other)).toBe(2);
    expect(other.chestsOpened).toEqual([SPOT, 'meadow:9,9']);
  });
  it('the spot pays again on the next local day, and the old list does not carry over', () => {
    const first = grant(game(), 2, reader, 'reader', SPOT);
    const next = grant(first, 2, reader, 'reader', SPOT, NEXT_DAY);
    expect(gained(first, next)).toBe(2);
    expect(next.chestsOpened).toEqual([SPOT]);
    expect(next.chestsDay).toBe(dayKey(NEXT_DAY));
  });
  it('a game stored before this change (no chest list) pays as before', () => {
    expect(gained(game(), grant(game(), 2, reader, 'reader', SPOT))).toBe(2);
  });
});
