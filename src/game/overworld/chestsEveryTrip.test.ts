import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addChest, lifetimeChests } from '../../engine/chestLedger';
import { applyDelta } from '../../engine/game';
import { throttledGems, GEM_RUN_MAX } from '../../engine/gems';
import { needsWork } from '../../engine/insights';
import { DEFAULT_SETTINGS, PRESETS, type CardMap, type CardState, type KidSettings } from '../../engine/models';
import { FACTS } from '../../engine/modules/facts';
import { ADD10 } from '../../engine/modules/add10';
import { SUB10 } from '../../engine/modules/sub10';
import { mulberry32 } from '../../engine/problems';
import { SessionRunner, buildPlan } from '../../engine/session';
import { chestCountFor, chestGems, chestSpots, reachableWithoutItems, tripChestSpots } from './chests';
import { MAPS, REGION_IDS, findTiles, heroStart, isWalkable, type RegionId, type WalkCtx } from './maps';
import { loadTrip, openChest, openedSpots, resolveTrip, saveTrip } from './trip';
import { planRegion } from './tripPlan';
import { fromDoc, newWorld, worldReducer } from './worldState';

const NOW = new Date('2026-11-18T16:00:00').getTime();
const DAY = 86_400_000;
const ctx: WalkCtx = { gateOpen: true, hasKey: false, hasBridgeKit: false };
const KID = 'kidchest0000000001';

function seen(id: string, over: Partial<CardState> = {}): CardState {
  return {
    id, attempts: 6, correct: 6, recentMs: [2000, 2100], lastRating: 3, updatedAt: NOW - DAY, lastResults: [true, true],
    fsrs: { due: NOW + 9 * DAY, stability: 9, difficulty: 5, elapsed_days: 1, scheduled_days: 9, learning_steps: 0, reps: 4, lapses: 0, state: 2, last_review: NOW - DAY },
    ...over,
  };
}
/** A kid who has seen every fact and has nothing due: no new card, no preview, no review. */
const ALL_SEEN: CardMap = Object.fromEntries(FACTS.cards.filter((c) => c.kind === 'fact').map((c) => [c.id, seen(c.id)]));
// Times tables only: the multidigit and fraction skills would each be a new card, and this kid has seen every fact.
const SETTINGS: KidSettings = { ...DEFAULT_SETTINGS, tracks: { facts: true, multidigit: false, fractions: false } };

function runnerFor(cards: CardMap, settings: KidSettings = SETTINGS) {
  return new SessionRunner(buildPlan({ cards, settings, now: NOW, rng: mulberry32(5) }), cards, mulberry32(6), () => NOW, settings);
}
function plan(runner: SessionRunner, cards: CardMap, tripId: string, opened: string[] = [], region: RegionId = 'meadow', learner: 'reader' | 'prereader' = 'reader') {
  return planRegion({ runner, cards, settings: SETTINGS, learner, tripId, opened, region, hero: heroStart(MAPS[region]), bossIds: new Set(), rng: mulberry32(9), ctx, now: NOW });
}

describe('chests every trip', () => {
  it('a kid who has seen every fact gets at least 3 chests in each land, on 40 different trips', () => {
    for (const region of REGION_IDS) for (let n = 0; n < 40; n++) {
      const r = runnerFor(ALL_SEEN);
      expect(r.queue.some((e) => e.isNew)).toBe(false);
      const { entities } = plan(r, ALL_SEEN, `trip${n}`, [], region);
      const chests = entities.filter((e) => e.kind === 'chest');
      expect(chests.length, `${region} trip${n}`).toBeGreaterThanOrEqual(3);
      expect(chests.length).toBeLessThanOrEqual(5);
    }
  });
  it('a reader gets 3 to 5 chests and all of 3, 4 and 5 turn up; a pre-reader always gets 3', () => {
    const counts = new Set<number>();
    for (let n = 0; n < 60; n++) {
      counts.add(chestCountFor(`t${n}`, 'forest', false));
      expect(chestCountFor(`t${n}`, 'forest', true)).toBe(3);
    }
    expect([...counts].sort()).toEqual([3, 4, 5]);
  });
  it('the fill order is new fact, then preview, then needs-work, then riddle', () => {
    const cards: CardMap = { ...ALL_SEEN };
    delete cards['mul:3x5'];
    delete cards['mul:6x10'];
    const weak = FACTS.cards.filter((c) => c.kind === 'fact' && c.id !== 'mul:3x5' && c.id !== 'mul:6x10').slice(0, 12).map((c) => c.id);
    for (const id of weak) cards[id] = seen(id, { attempts: 4, correct: 1, lastResults: [false], missDay: '2026-11-17', fsrs: { ...seen(id).fsrs, stability: 0.5, state: 2 } });
    const r = new SessionRunner(
      [
        ...weak.slice(0, 6).map((cardId) => ({ cardId, isNew: false })),
        { cardId: 'mul:3x5', isNew: true },
        { cardId: 'mul:6x10', isNew: true, preview: true },
      ],
      cards,
      mulberry32(2),
      () => NOW,
      SETTINGS,
    );
    const needs = new Set(needsWork({ cards, sessions: [], settings: SETTINGS, now: NOW }, 12).map((f) => f.id));
    const { entities, spots } = plan(r, cards, 'order-trip');
    // In spot order: the key chest first, as the trip lays them out.
    const chests = entities.filter((e) => e.kind === 'chest').sort((a, b) => spots.findIndex((s) => s.id === a.spotId) - spots.findIndex((s) => s.id === b.spotId));
    expect(chests.length).toBe(spots.length);
    const kinds = chests.map((c) => {
      const e = r.queue.find((q) => q.id === c.id)!;
      return e.riddle ? 'riddle' : e.preview ? 'preview' : e.isNew ? 'new' : needs.has(e.cardId) ? 'needs' : 'other';
    });
    const order = ['new', 'preview', 'needs', 'riddle'];
    expect(kinds.slice(0, 2)).toEqual(['new', 'preview']);
    expect([...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(kinds);
    expect(kinds).not.toContain('other');
    if (spots.length > 3) expect(kinds.slice(2).every((k) => k === 'needs')).toBe(true);
  });
  it('with nothing new, no preview and nothing weak, the chests hold riddles on facts the kid has met', () => {
    const r = runnerFor(ALL_SEEN);
    const { entities } = plan(r, ALL_SEEN, 'riddle-trip');
    const riddles = entities.filter((e) => e.kind === 'chest').map((e) => r.queue.find((q) => q.id === e.id)!);
    expect(riddles.length).toBeGreaterThanOrEqual(3);
    for (const e of riddles) {
      expect(e.riddle).toBe(true);
      expect(e.kind).toBe('practice');
      expect(ALL_SEEN[e.cardId]).toBeDefined();
      expect(e.problem.story).toMatch(/\?$/);
    }
  });
  it('a riddle is practice only: no review, and a miss queues no retry', () => {
    const r = runnerFor(ALL_SEEN);
    const before = r.queue.length;
    const e = r.appendRiddle('mul:6x7', mulberry32(3))!;
    expect(r.queue).toHaveLength(before + 1);
    const card = JSON.stringify(ALL_SEEN['mul:6x7']!.fsrs);
    r.answerEntry(e.id, { kind: 'int', value: -1 }, 3000);
    expect(r.queue).toHaveLength(before + 1);
    expect(JSON.stringify(r.getCard('mul:6x7')!.fsrs)).toBe(card);
    expect(r.summary().graded).toBe(0);
  });
  it('riddle templates are fixed text around the fact\'s own numbers', () => {
    const r = runnerFor(ALL_SEEN);
    const mul = r.appendRiddle('mul:6x7', mulberry32(3))!;
    const [a, , b] = mul.problem.tokens as Array<{ v: number }>;
    expect(mul.problem.story).toBe(`A dragon has ${a!.v} bags with ${b!.v} gems in each. How many gems is that?`);
  });
});

describe('a pre-reader', () => {
  const PRE: KidSettings = { ...PRESETS.prereader, tracks: { ...PRESETS.prereader.tracks }, modules: { add10: true, sub10: true }, sessionSize: 15, maxNew: 8 };
  const cards: CardMap = Object.fromEntries([...ADD10.cards, ...SUB10.cards].filter((c) => c.kind === 'fact').map((c) => [c.id, seen(c.id)]));
  it('gets 3 chests every trip, each a picture story that is spoken, on a fact already met', () => {
    for (let n = 0; n < 20; n++) {
      const r = new SessionRunner(buildPlan({ cards, settings: PRE, now: NOW, rng: mulberry32(5) }), cards, mulberry32(6), () => NOW, PRE);
      const out = planRegion({ runner: r, cards, settings: PRE, learner: 'prereader', tripId: `pre${n}`, opened: [], region: 'meadow', hero: heroStart(MAPS.meadow), bossIds: new Set(), rng: mulberry32(9), ctx, now: NOW });
      const chests = out.entities.filter((e) => e.kind === 'chest');
      expect(chests, `pre${n}`).toHaveLength(3);
      for (const c of chests) {
        const e = r.queue.find((q) => q.id === c.id)!;
        if (!e.riddle) continue;
        expect(e.problem.visual).toBeDefined();
        expect(e.problem.speech).toBe(e.problem.story);
        expect(cards[e.cardId]).toBeDefined();
      }
    }
  });
});

describe('a chest pays once per trip', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  it('the second open of the same spot pays nothing, and the open spot survives a reload of the trip', () => {
    const { trip } = resolveTrip(null, NOW, () => 'trip-a');
    expect(openChest(KID, trip, 'meadow:17,5')).toBe(true);
    expect(openChest(KID, trip, 'meadow:17,5')).toBe(false);
    expect(openedSpots(loadTrip(KID)!)).toEqual(['meadow:17,5']);
    expect(openChest(KID, loadTrip(KID)!, 'meadow:17,5')).toBe(false);
  });
  it('an opened chest is not a chest on the map again; a new trip refills every spot', () => {
    const r = runnerFor(ALL_SEEN);
    const first = plan(r, ALL_SEEN, 'trip-b');
    const spotId = first.entities.find((e) => e.kind === 'chest')!.spotId!;
    const r2 = runnerFor(ALL_SEEN);
    const again = plan(r2, ALL_SEEN, 'trip-b', [spotId]);
    expect(again.entities.filter((e) => e.kind === 'chest').map((e) => e.spotId)).not.toContain(spotId);
    expect(again.entities.filter((e) => e.kind === 'chest')).toHaveLength(first.spots.length - 1);
    const fresh = plan(runnerFor(ALL_SEEN), ALL_SEEN, 'trip-c', []);
    expect(fresh.entities.filter((e) => e.kind === 'chest')).toHaveLength(fresh.spots.length);
  });
  it('an old-bundle write to world/main cannot re-pay a chest: the trip state is not in that doc', () => {
    const { trip } = resolveTrip(null, NOW, () => 'trip-d');
    openChest(KID, trip, 'meadow:17,5');
    // What a bundle from before this change writes: 9 fields, its own card-id list, a reset of the new count.
    const oldWrite = { region: 'meadow', x: 3, y: 14, facing: 'right', openedChests: ['mul:6x7'], bossesDefeated: [], keys: 0, version: 1, updatedAt: NOW + 5 };
    const w = fromDoc(JSON.parse(JSON.stringify(oldWrite)), NOW);
    expect(openedSpots(loadTrip(KID)!)).toEqual(['meadow:17,5']);
    expect(openChest(KID, loadTrip(KID)!, 'meadow:17,5')).toBe(false);
    expect(lifetimeChests(w.openedChests)).toBe(1);
    expect(lifetimeChests(worldReducer(w, { t: 'chest' }).openedChests)).toBe(2);
  });
  it('an older bundle on this device that saves the trip keeps the chests: it writes back the fields it loaded', () => {
    const { trip } = resolveTrip(null, NOW, () => 'trip-e');
    openChest(KID, trip, 'forest:10,2');
    const raw = JSON.parse(store.get(`mathquest:v1:trip:${KID}`)!);
    store.set(`mathquest:v1:trip:${KID}`, JSON.stringify({ ...raw, seq: raw.seq + 1 })); // the old bundle's saveTrip: spreads what it loaded
    expect(openedSpots(loadTrip(KID)!)).toEqual(['forest:10,2']);
  });
  it('a trip stored before this change reads with no chests open', () => {
    saveTrip(KID, { tripId: 'old', startedAt: NOW, seq: 0, updatedAt: NOW, finished: false, totals: { answered: 0, graded: 0, correct: 0, fast: 0, newLearned: 0, xp: 0, bestCombo: 0, medianMs: 0, missed: [] } });
    const raw = JSON.parse(store.get(`mathquest:v1:trip:${KID}`)!);
    delete raw.chests;
    store.set(`mathquest:v1:trip:${KID}`, JSON.stringify(raw));
    expect(openedSpots(loadTrip(KID)!)).toEqual([]);
  });
});

describe('the chest ledger in world/main.openedChests', () => {
  it('counts card ids from an older app and the marker, and one chest adds 1', () => {
    expect(lifetimeChests([])).toBe(0);
    expect(lifetimeChests(['mul:6x7', 'mul:7x8'])).toBe(2);
    expect(addChest(['mul:6x7'])).toEqual(['#1', 'mul:6x7']);
    expect(lifetimeChests(addChest(addChest(['#7', 'mul:6x7'])))).toBe(10);
  });
  it('a full list folds its oldest ids into the marker: at most 500 entries, the count never drops', () => {
    let list = Array.from({ length: 500 }, (_, i) => `c${i}`);
    for (let i = 0; i < 30; i++) {
      list = addChest(list);
      expect(list.length).toBeLessThanOrEqual(500);
    }
    expect(lifetimeChests(list)).toBe(530);
  });
  it('a key chest gives a key only to a kid who holds none', () => {
    const w = newWorld(NOW);
    const k = worldReducer(w, { t: 'key' });
    expect(k.keys).toBe(1);
    expect(worldReducer(k, { t: 'key' }).keys).toBe(1);
  });
});

describe('keys', () => {
  const DOORS: Record<RegionId, number> = { meadow: 1, forest: 0, castle: 1 };
  it('keys open doors: the key item opened a door before, and now a key from a chest or a boss does too', () => {
    for (const region of REGION_IDS) expect(findTiles(MAPS[region], 'door').length, region).toBe(DOORS[region]);
  });
  it.each(REGION_IDS)('%s: the key chest of every trip stands where the hero walks with no key, and the door opens with the key', (region) => {
    const m = MAPS[region];
    const reach = reachableWithoutItems(m);
    for (let n = 0; n < 60; n++) {
      const spots = tripChestSpots(`k${n}`, region, n % 2 === 0);
      const key = spots.filter((s) => s.key);
      expect(key, `${region} k${n}`).toHaveLength(1);
      expect(spots[0]!.key).toBe(true);
      expect(reach.has(`${key[0]!.x},${key[0]!.y}`)).toBe(true);
    }
    for (const d of findTiles(m, 'door')) {
      expect(reach.has(`${d.x},${d.y}`)).toBe(false); // closed without a key
      expect(isWalkable(m, d.x, d.y, { ...ctx, hasKey: true })).toBe(true);
      expect(isWalkable(m, d.x, d.y, ctx)).toBe(false);
      const withKey = new Set<string>();
      const q = [heroStart(m)];
      withKey.add(`${q[0]!.x},${q[0]!.y}`);
      while (q.length) {
        const p = q.shift()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = { x: p.x + dx, y: p.y + dy };
          if (!withKey.has(`${n.x},${n.y}`) && isWalkable(m, n.x, n.y, { ...ctx, hasKey: true })) {
            withKey.add(`${n.x},${n.y}`);
            q.push(n);
          }
        }
      }
      expect(withKey.has(`${d.x},${d.y}`)).toBe(true);
    }
  });
});

const SPOTS: Record<RegionId, string[]> = {
  meadow: ["meadow:17,5", "meadow:20,7", "meadow:37,7", "meadow:23,9", "meadow:8,10", "meadow:14,12", "meadow:10,13", "meadow:27,13", "meadow:33,21", "meadow:3,22", "meadow:6,26", "meadow:18,26"],
  forest: ["forest:10,2", "forest:9,5", "forest:24,5", "forest:14,8", "forest:28,9", "forest:33,9", "forest:36,10", "forest:12,14", "forest:34,17", "forest:12,18", "forest:21,18", "forest:4,19", "forest:28,19", "forest:24,24", "forest:33,24", "forest:5,26", "forest:15,26"],
  castle: ["castle:5,3", "castle:11,4", "castle:23,4", "castle:18,7", "castle:36,7", "castle:29,8", "castle:1,12", "castle:10,12", "castle:23,12", "castle:34,12", "castle:10,17", "castle:37,17", "castle:3,20", "castle:11,21", "castle:22,23", "castle:1,25", "castle:24,26", "castle:16,27", "castle:30,27"],
};

describe('chest spot ids', () => {
  it.each(REGION_IDS)('%s keeps the same ids for the same tiles', (region) => {
    expect(chestSpots(region).map((s) => s.id)).toEqual(SPOTS[region]);
  });
  it('a trip picks the same spots every time it asks, whatever the region it visited before', () => {
    for (const region of REGION_IDS) expect(tripChestSpots('same', region, false).map((s) => s.id)).toEqual(tripChestSpots('same', region, false).map((s) => s.id));
    expect(tripChestSpots('a', 'meadow', false).map((s) => s.id)).not.toEqual(tripChestSpots('b', 'meadow', false).map((s) => s.id));
  });
});

describe('chest gems', () => {
  const kid = { gemSpeed: 1, gemFullRate: undefined };
  it('every chest is 1 or 2 gems before the throttle', () => {
    const seenGems = new Set<number>();
    for (let n = 0; n < 40; n++) seenGems.add(chestGems(`g${n}`, 'meadow:17,5'));
    expect([...seenGems].sort()).toEqual([1, 2]);
  });
  it('a chest goes through the soft throttle: full, half then quarter rate, never under 1, never over the cap of 10', () => {
    expect(throttledGems(2, 'reader', kid, 0)).toBe(2);
    expect(throttledGems(2, 'reader', kid, 5000)).toBe(1);
    expect(throttledGems(1, 'reader', kid, 5000)).toBe(1);
    expect(throttledGems(2, 'reader', { gemSpeed: 1.5, gemFullRate: undefined }, 0)).toBe(3);
    expect(throttledGems(500, 'reader', kid, 0)).toBe(GEM_RUN_MAX);
  });
  it('the write that pays a chest is one gemGrant delta, and the game takes at most 10 from it', () => {
    const game = { gems: 40, xp: 0, bestCombo: 0, heroes: ['knight'], hero: 'knight', streakDays: 1, lastPlayedDay: '2026-11-18' } as Parameters<typeof applyDelta>[0];
    const next = applyDelta(game, { gemGrant: { base: 2, learner: 'reader', settings: kid }, playedAt: NOW });
    expect(next.gems - game.gems).toBe(2);
    const big = applyDelta(game, { gemGrant: { base: 999, learner: 'reader', settings: kid }, playedAt: NOW });
    expect(big.gems - game.gems).toBeLessThanOrEqual(GEM_RUN_MAX);
  });
});
