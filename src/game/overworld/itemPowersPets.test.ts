import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyDelta } from '../../engine/game';
import { GEM_RUN_MAX, throttledGems } from '../../engine/gems';
import { DEFAULT_SETTINGS, PRESETS, type CardMap, type CardState, type KidSettings } from '../../engine/models';
import { FACTS } from '../../engine/modules/facts';
import { ADD10 } from '../../engine/modules/add10';
import { SUB10 } from '../../engine/modules/sub10';
import { mulberry32 } from '../../engine/problems';
import { SessionRunner, buildPlan } from '../../engine/session';
import { chestSpots, reachableWithoutItems, tripChestSpots } from './chests';
import { MAPS, REGION_IDS, heroStart, tileAt, type WalkCtx } from './maps';
import { BEETLE_GEMS, DOG_CHEST_GEMS, DOG_SNIFF_RANGE, activePet, beetleId, beetleTile, claimPetGrant, lairRingFill, pupCheer, snapPetTap, withDogSpot } from './pets';
import { bossReady } from './boss';
import { claimChest, loadTrip, openedSpots, resolveTrip } from './trip';
import { planRegion } from './tripPlan';

// Item powers, pets PR. PDR rule 1: no pet touches questions, answers, timing or grading.

const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const NOW = new Date('2026-11-19T16:00:00').getTime();
const DAY = 86_400_000;
const KID = 'kidpets0000000000001';
const ctx: WalkCtx = { gateOpen: true, hasKey: false, hasBridgeKit: false };

function seen(id: string): CardState {
  return {
    id, attempts: 6, correct: 6, recentMs: [2000, 2100], lastRating: 3, updatedAt: NOW - DAY, lastResults: [true, true],
    fsrs: { due: NOW + 9 * DAY, stability: 9, difficulty: 5, elapsed_days: 1, scheduled_days: 9, learning_steps: 0, reps: 4, lapses: 0, state: 2, last_review: NOW - DAY },
  };
}
const ALL_SEEN: CardMap = Object.fromEntries(FACTS.cards.filter((c) => c.kind === 'fact').map((c) => [c.id, seen(c.id)]));
const SETTINGS: KidSettings = { ...DEFAULT_SETTINGS, tracks: { facts: true, multidigit: false, fractions: false } };
const PRE: KidSettings = { ...PRESETS.prereader, tracks: { ...PRESETS.prereader.tracks }, modules: { add10: true, sub10: true }, sessionSize: 15, maxNew: 8 };
const PRE_CARDS: CardMap = Object.fromEntries([...ADD10.cards, ...SUB10.cards].filter((c) => c.kind === 'fact').map((c) => [c.id, seen(c.id)]));

type Who = 'reader' | 'prereader';
function runnerFor(who: Who) {
  const [cards, settings] = who === 'reader' ? [ALL_SEEN, SETTINGS] : [PRE_CARDS, PRE];
  return { cards, settings, runner: new SessionRunner(buildPlan({ cards, settings, now: NOW, rng: mulberry32(5) }), cards, mulberry32(6), () => NOW, settings) };
}
function planWith(who: Who, tripId: string, region: (typeof REGION_IDS)[number], dog: boolean, opened: string[] = []) {
  const { cards, settings, runner } = runnerFor(who);
  const out = planRegion({ runner, cards, settings, learner: who, tripId, opened, region, hero: heroStart(MAPS[region]), bossIds: new Set(), rng: mulberry32(9), ctx, now: NOW, ...(dog ? { dog: true } : {}) });
  return { ...out, runner };
}
function play(runner: SessionRunner) {
  for (const e of [...runner.queue]) runner.answerEntry(e.id, { kind: 'int', value: -1 }, 2500);
  return runner.summary();
}

describe('pets work only while owned and equipped', () => {
  it('names the pet of the equipped item, and none when it is not owned or not equipped', () => {
    expect(activePet('p-dog', ['p-dog'])).toBe('dog');
    expect(activePet('p-beetle', ['p-beetle', 'p-dog'])).toBe('beetle');
    expect(activePet('p-owl', ['p-owl'])).toBe('owl');
    expect(activePet('p-pup', ['p-pup'])).toBe('pup');
    expect(activePet('p-dog', [])).toBeNull();
    expect(activePet(undefined, ['p-dog'])).toBeNull();
    expect(activePet('w-sword', ['w-sword'])).toBeNull();
  });
});

describe('Dog: one hidden bonus chest a trip', () => {
  it.each(REGION_IDS)('%s: the Dog swaps a plain chest for a hidden one on a grass tile and keeps the count', (region) => {
    for (const who of ['reader', 'prereader'] as const) {
      const a = planWith(who, 'dog1', region, false);
      const b = planWith(who, 'dog1', region, true);
      expect(b.spots).toHaveLength(a.spots.length);
      const dogs = b.spots.filter((s) => s.power === 'dog');
      expect(dogs).toHaveLength(1);
      const d = dogs[0]!;
      expect(d.hidden).toBe(true);
      expect(d.key).toBe(false);
      expect(tileAt(MAPS[region], d.x, d.y)).toBe('grass');
      expect(reachableWithoutItems(MAPS[region]).has(`${d.x},${d.y}`)).toBe(true);
      expect(chestSpots(region).some((c) => c.x === d.x && c.y === d.y)).toBe(false);
      // The key chest is never the one swapped out.
      expect(b.spots.find((s) => s.key)?.id).toBe(a.spots.find((s) => s.key)?.id);
    }
  });
  it('the same trip finds the same bonus chest on every render', () => {
    for (const region of REGION_IDS) {
      const one = planWith('reader', 'dog2', region, true).spots.find((s) => s.power === 'dog');
      const two = planWith('reader', 'dog2', region, true).spots.find((s) => s.power === 'dog');
      expect(two).toEqual(one);
    }
  });
  it('the bonus chest is unshown until the hero is near, and it holds a question like any chest', () => {
    const { entities } = planWith('reader', 'dog3', 'meadow', true);
    const e = entities.find((x) => x.dog);
    expect(e).toBeDefined();
    expect(e!.kind).toBe('chest');
    expect(e!.shown).toBe(false);
    expect(entities.filter((x) => x.kind === 'chest' && !x.dog).every((x) => x.shown)).toBe(true);
    expect(DOG_SNIFF_RANGE).toBeGreaterThanOrEqual(3);
  });
  it('an opened bonus chest keeps its slot, and a base chest opened before the Dog came is not swapped out', () => {
    const first = withDogSpot('dog4', 'forest', tripChestSpots('dog4', 'forest', false), []);
    const dog = first.find((s) => s.power === 'dog')!;
    const again = withDogSpot('dog4', 'forest', tripChestSpots('dog4', 'forest', false), [dog.id]);
    expect(again.find((s) => s.power === 'dog')).toEqual(dog);
    const base = tripChestSpots('dog4', 'forest', false);
    const slot = base.find((s) => !first.some((f) => f.id === s.id))!;
    const guarded = withDogSpot('dog4', 'forest', base, [slot.id]);
    expect(guarded.some((s) => s.power === 'dog')).toBe(false);
    expect(guarded).toHaveLength(base.length);
  });
  it('grading equality: the Dog adds no question and no entry, so the session records the same graded set and timings', () => {
    for (const who of ['reader', 'prereader'] as const) {
      for (const region of REGION_IDS) {
        const a = planWith(who, 'dog5', region, false);
        const b = planWith(who, 'dog5', region, true);
        // The same entries sit on the map: the same ids, in the same count, only a chest stands on another tile.
        expect(b.entities.map((e) => e.id).sort()).toEqual(a.entities.map((e) => e.id).sort());
        expect(b.entities.filter((e) => e.kind === 'chest')).toHaveLength(a.entities.filter((e) => e.kind === 'chest').length);
      }
      expect(play(planWith(who, 'dog5', 'meadow', true).runner)).toEqual(play(planWith(who, 'dog5', 'meadow', false).runner));
    }
  });
  it('the Dog never leaks into the engine, the grader or the boss', () => {
    for (const f of ['../../engine/session.ts', '../../engine/grading.ts', '../../engine/pause.ts', './boss.ts', './encounters.ts']) {
      expect(readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/p-dog|p-beetle|p-owl|p-pup|activePet|withDogSpot/);
    }
  });
});

describe('Beetle: 1 gem a trip', () => {
  it.each(REGION_IDS)('%s: the dig is on a grass tile the hero reaches, 4 or more tiles from the start, and stays put per trip', (region) => {
    const t = beetleTile('bt1', region)!;
    expect(t).toBeTruthy();
    expect(tileAt(MAPS[region], t.x, t.y)).toBe('grass');
    expect(reachableWithoutItems(MAPS[region]).has(`${t.x},${t.y}`)).toBe(true);
    const s = heroStart(MAPS[region]);
    expect(Math.abs(t.x - s.x) + Math.abs(t.y - s.y)).toBeGreaterThanOrEqual(4);
    expect(beetleTile('bt1', region)).toEqual(t);
    expect(chestSpots(region).some((c) => c.x === t.x && c.y === t.y)).toBe(false);
  });
  it('varies with the trip', () => {
    const tiles = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(beetleTile(`trip-${i}`, 'meadow'))));
    expect(tiles.size).toBeGreaterThan(3);
  });

  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('the same grant id twice pays once, and a reopened trip still pays nothing', () => {
    const { trip } = resolveTrip(null, NOW, () => 'beetle-trip-1');
    const id = beetleId(trip.tripId);
    expect(claimPetGrant(KID, trip, id, BEETLE_GEMS)).toEqual({ paid: true, gems: BEETLE_GEMS });
    expect(claimPetGrant(KID, trip, id, BEETLE_GEMS)).toEqual({ paid: false, gems: 0 });
    const reopened = loadTrip(KID)!;
    expect(claimPetGrant(KID, reopened, id, BEETLE_GEMS)).toEqual({ paid: false, gems: 0 });
    // A different trip is a different id and pays again.
    const { trip: next } = resolveTrip(null, NOW, () => 'beetle-trip-2');
    expect(claimPetGrant(KID, next, beetleId(next.tripId), BEETLE_GEMS).paid).toBe(true);
  });
  it('the Dog chest claims once per spot id, and pays the bonus only for a right answer', () => {
    const d = withDogSpot('dog6', 'meadow', tripChestSpots('dog6', 'meadow', false), []).find((s) => s.power === 'dog')!;
    const { trip } = resolveTrip(null, NOW, () => 'dog6');
    expect(claimChest(KID, trip, d.id, true, DOG_CHEST_GEMS)).toEqual({ opened: true, gems: DOG_CHEST_GEMS });
    expect(claimChest(KID, trip, d.id, true, DOG_CHEST_GEMS)).toEqual({ opened: false, gems: 0 });
    expect(openedSpots(trip)).toEqual([d.id]);
    const t2 = resolveTrip(null, NOW, () => 'dog7').trip;
    expect(claimChest(KID, t2, d.id, false, DOG_CHEST_GEMS)).toEqual({ opened: true, gems: 0 });
  });
  it('an older bundle reads a trip with pets claimed: its chests and totals are untouched', () => {
    const { trip } = resolveTrip(null, NOW, () => 'old-pets');
    claimPetGrant(KID, trip, beetleId(trip.tripId), 1);
    const raw = JSON.parse(store.get(`mathquest:v1:trip:${KID}`)!);
    // An older loader keeps only the fields it knows: dropping `pets` leaves a valid trip.
    delete raw.pets;
    expect(raw.tripId).toBe('old-pets');
    expect(raw.chests ?? { opened: [] }).toEqual({ opened: [] });
    expect(raw.totals.graded).toBe(0);
  });
  it('a pet gem goes through gemGrant and the soft throttle, counts toward the daily total and never beats the cap of 10', () => {
    const kid = { gemSpeed: 1, gemFullRate: undefined };
    const game = { gems: 40, xp: 0, bestCombo: 0, heroes: ['knight'], hero: 'knight', streakDays: 1, lastPlayedDay: '2026-11-19' } as Parameters<typeof applyDelta>[0];
    expect(throttledGems(DOG_CHEST_GEMS, 'reader', kid, 0)).toBe(DOG_CHEST_GEMS);
    expect(throttledGems(DOG_CHEST_GEMS, 'reader', kid, 5000)).toBeLessThan(DOG_CHEST_GEMS);
    let g = game;
    let paid = 0;
    for (let i = 0; i < 30; i++) {
      const before = g.gems;
      g = applyDelta(g, { gemGrant: { base: DOG_CHEST_GEMS, learner: 'reader', settings: kid }, playedAt: NOW });
      paid += g.gems - before;
    }
    expect(paid).toBeLessThan(30 * DOG_CHEST_GEMS);
    const big = applyDelta(game, { gemGrant: { base: 999, learner: 'reader', settings: kid }, playedAt: NOW });
    expect(big.gems - game.gems).toBeLessThanOrEqual(GEM_RUN_MAX);
    expect(DOG_CHEST_GEMS).toBeLessThanOrEqual(GEM_RUN_MAX);
  });
  it('grading equality: the Beetle reads no session state, so the same plan and answers record the same session', () => {
    for (const who of ['reader', 'prereader'] as const) expect(play(planWith(who, 'bt2', 'meadow', false).runner)).toEqual(play(planWith(who, 'bt2', 'meadow', false).runner));
    const src = noComments(readFileSync(new URL('./pets.ts', import.meta.url), 'utf8'));
    expect(src).not.toMatch(/from '\.\.\/\.\.\/engine\/(session|grading|scheduler)'/);
  });
});

describe('Owl: the lair ring', () => {
  it('is 0 with no facts seen, 1 once bossReady is true, and never reads anything but the region progress', () => {
    for (const region of REGION_IDS) {
      expect(lairRingFill(region, {}, SETTINGS)).toBe(0);
      expect(lairRingFill(region, ALL_SEEN, SETTINGS)).toBeGreaterThan(0);
    }
    expect(lairRingFill('meadow', ALL_SEEN, SETTINGS) >= 1).toBe(bossReady('meadow', ALL_SEEN, SETTINGS));
    for (const region of REGION_IDS) for (const cards of [{}, ALL_SEEN]) expect(lairRingFill(region, cards, SETTINGS) >= 1).toBe(bossReady(region, cards, SETTINGS));
  });
  it('fills in steps toward the rule', () => {
    const ids = Object.keys(ALL_SEEN);
    const half: CardMap = Object.fromEntries(ids.slice(0, Math.floor(ids.length / 4)).map((id) => [id, ALL_SEEN[id]!]));
    const a = lairRingFill('meadow', half, SETTINGS);
    const b = lairRingFill('meadow', ALL_SEEN, SETTINGS);
    expect(a).toBeLessThanOrEqual(b);
  });
  it('grading equality: the ring is read-only, the plan and the session of an Owl run equal a no-item run', () => {
    for (const who of ['reader', 'prereader'] as const) {
      const before = play(planWith(who, 'owl1', 'meadow', false).runner);
      lairRingFill('meadow', runnerFor(who).cards, runnerFor(who).settings);
      expect(play(planWith(who, 'owl1', 'meadow', false).runner)).toEqual(before);
    }
    const src = noComments(readFileSync(new URL('./pets.ts', import.meta.url), 'utf8'));
    expect(src).not.toMatch(/setItem\(|\.applyGameDelta|repo\./);
  });
});

describe('Dragon Pup: animation and cheers only', () => {
  it('cheers at combos of exactly 5, 10 and 20', () => {
    expect([1, 4, 5, 6, 9, 10, 11, 19, 20, 21].map(pupCheer)).toEqual([null, null, 5, null, null, 10, null, null, 20, null]);
  });
  it('grading equality: the Pup branch of the boss answer handler reads the verdict and writes no run state', () => {
    const src = readFileSync(new URL('./Overworld.tsx', import.meta.url), 'utf8');
    const at = src.indexOf("petRef.current === 'pup'");
    expect(at).toBeGreaterThan(0);
    const block = noComments(src.slice(at, src.indexOf('\n      }\n', at)));
    expect(block).toMatch(/pupFx\.current = /);
    expect(block).not.toMatch(/run\.(correct|answered|result|ms)|clock|markDone|grade|applyGameDelta|touchWorld/);
    for (const f of ['../../engine/session.ts', '../../engine/grading.ts', './boss.ts']) expect(readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/pupCheer|pupFx|p-pup/);
  });
  it('the session of a Pup run equals a no-item run', () => {
    for (const who of ['reader', 'prereader'] as const) expect(play(planWith(who, 'pup1', 'meadow', false).runner)).toEqual(play(planWith(who, 'pup1', 'meadow', false).runner));
  });
});

describe('no pet writes world/main or adds a field to it', () => {
  it('pets.ts and the pet code in Overworld never call touchWorld or flush for a pet', () => {
    expect(noComments(readFileSync(new URL('./pets.ts', import.meta.url), 'utf8'))).not.toMatch(/worldState|touchWorld|world\//);
    const src = readFileSync(new URL('./worldState.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/beetle|dog|pet/i);
  });
});

describe('tap target: 120 CSS px on the screen at any canvas width and pixel ratio', () => {
  // Tile size in CSS px as Overworld sets it: 12 * min(want, fit), want = round(width / 168) clamped to 2..6.
  const cases = [393, 820, 1024].flatMap((w) => [1, 2].map((dpr) => ({ w, dpr, css: 12 * Math.max(2, Math.min(6, Math.round(w / 168))) })));
  it.each(cases)('width $w, ratio $dpr: a tap within 60 px of the center hits, 61 px does not', ({ w, dpr, css }) => {
    const rect = { left: 7, top: 11, width: w };
    const view = { t: css * dpr, left: 5 * css * dpr, top: 3 * css * dpr };
    const spot = { x: 9, y: 6 };
    const cx = rect.left + ((spot.x + 0.5) * view.t - view.left) / dpr;
    const cy = rect.top + ((spot.y + 0.5) * view.t - view.top) / dpr;
    for (const [dx, dy] of [[59, 0], [-59, 0], [0, 59], [0, -59], [41, 41]]) expect(snapPetTap({ x: cx + dx!, y: cy + dy! }, rect, w * dpr, view, [spot])).toEqual(spot);
    for (const [dx, dy] of [[61, 0], [-61, 0], [0, 61], [0, -61]]) expect(snapPetTap({ x: cx + dx!, y: cy + dy! }, rect, w * dpr, view, [spot])).toBeNull();
  });
  it('picks the nearer of two spots', () => {
    const rect = { left: 0, top: 0, width: 393 };
    const view = { t: 24, left: 0, top: 0 };
    expect(snapPetTap({ x: 12 + 24 * 4 + 5, y: 12 }, rect, 393, view, [{ x: 4, y: 0 }, { x: 5, y: 0 }])).toEqual({ x: 4, y: 0 });
  });
});
