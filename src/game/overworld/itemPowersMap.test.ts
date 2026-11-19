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
import { chestSpots, powerSpots, reachableWith, reachableWithoutItems, tripChestSpots, type MapGear } from './chests';
import { MAPS, REGION_IDS, findTiles, heroStart, isWalkable, tileAt, type RegionId, type WalkCtx } from './maps';
import { BOOT_SPEED, SPEED, walkSpeed } from './speed';
import { claimChest, openedSpots, resolveTrip } from './trip';
import { planRegion } from './tripPlan';

// Item powers, map PR: the Key opens side rooms, the Bridge Kit reaches an island, Fast Boots walk 1.5 times as fast.
// PDR rule 1: no power touches questions, answers, timing or grading. A power moves a chest or the hero; it never adds a question.

const NOW = new Date('2026-11-19T16:00:00').getTime();
const DAY = 86_400_000;
const KID = 'kidpower00000000001';
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
function planWith(who: Who, tripId: string, region: RegionId, gear?: MapGear, opened: string[] = []) {
  const { cards, settings, runner } = runnerFor(who);
  const out = planRegion({ runner, cards, settings, learner: who, tripId, opened, region, hero: heroStart(MAPS[region]), bossIds: new Set(), rng: mulberry32(9), ctx, now: NOW, ...(gear ? { gear } : {}) });
  return { ...out, runner };
}
/** Answers every pending entry the same way at the same think time, as a trip would, and returns what the session recorded. */
function play(runner: SessionRunner) {
  for (const e of [...runner.queue]) runner.answerEntry(e.id, { kind: 'int', value: -1 }, 2500);
  return runner.summary();
}

describe('map powers: where the powered chests stand', () => {
  it.each(REGION_IDS)('%s: at least 1 key door, 1 span, 1 key chest spot and 1 island chest spot', (region) => {
    const m = MAPS[region];
    expect(findTiles(m, 'door').length).toBeGreaterThanOrEqual(1);
    expect(findTiles(m, 'span').length).toBeGreaterThanOrEqual(2);
    const spots = powerSpots(region);
    expect(spots.filter((s) => s.power === 'key').length).toBeGreaterThanOrEqual(1);
    expect(spots.filter((s) => s.power === 'bridge').length).toBeGreaterThanOrEqual(1);
  });
  it.each(REGION_IDS)('%s: a power chest needs its item and no other: the key room opens with the key only, the island with the kit only', (region) => {
    const m = MAPS[region];
    const none = reachableWith(m, { hasKey: false, hasBridgeKit: false });
    const key = reachableWith(m, { hasKey: true, hasBridgeKit: false });
    const kit = reachableWith(m, { hasKey: false, hasBridgeKit: true });
    const all = findTiles(m, 'vault');
    expect(all.length).toBe(powerSpots(region).length); // every P tile belongs to a power
    for (const s of powerSpots(region)) {
      const k = `${s.x},${s.y}`;
      expect(none.has(k), `${s.id} without items`).toBe(false);
      expect(key.has(k), `${s.id} with the key`).toBe(s.power === 'key');
      expect(kit.has(k), `${s.id} with the kit`).toBe(s.power === 'bridge');
    }
  });
  it.each(REGION_IDS)('%s: the old chest spots are unchanged and still reachable with no item', (region) => {
    const reach = reachableWithoutItems(MAPS[region]);
    for (const s of chestSpots(region)) expect(reach.has(`${s.x},${s.y}`), s.id).toBe(true);
    for (const s of chestSpots(region)) expect(tileAt(MAPS[region], s.x, s.y)).toBe('chest');
  });
  it.each(REGION_IDS)('%s: a span is open water on both sides of its line, so the island is cut off without the kit', (region) => {
    const m = MAPS[region];
    const open = { ...ctx, hasBridgeKit: true };
    for (const d of findTiles(m, 'span')) {
      expect(isWalkable(m, d.x, d.y, ctx)).toBe(false);
      expect(isWalkable(m, d.x, d.y, open)).toBe(true);
    }
  });
});

describe('map powers: the trip keeps its count and its questions', () => {
  const GEARS: Array<[string, MapGear]> = [['key', { key: true }], ['bridge kit', { bridge: true }], ['key and bridge kit', { key: true, bridge: true }]];

  it.each(GEARS)('%s: an owned power puts a chest in its room or on its island and keeps the key chest', (_name, gear) => {
    for (const region of REGION_IDS) for (let n = 0; n < 40; n++) {
      const spots = tripChestSpots(`pw${n}`, region, n % 2 === 0, 0, gear);
      const base = tripChestSpots(`pw${n}`, region, n % 2 === 0);
      expect(spots).toHaveLength(base.length);
      expect(spots[0]).toEqual(base[0]);
      const powered = spots.filter((s) => s.power);
      expect(powered.length, `${region} pw${n}`).toBe(Object.values(gear).filter(Boolean).length);
      expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length);
    }
  });
  it('with no power the spots are exactly the ones of main', () => {
    for (const region of REGION_IDS) for (let n = 0; n < 20; n++) {
      const spots = tripChestSpots(`pw${n}`, region, false);
      expect(spots.some((s) => s.power)).toBe(false);
      for (const s of spots) expect(tileAt(MAPS[region], s.x, s.y)).toBe('chest');
    }
  });
  it('the same trip finds the same power chest on every render, and an opened one stays on the list', () => {
    for (const region of REGION_IDS) {
      const a = tripChestSpots('stable', region, false, 0, { key: true, bridge: true });
      expect(tripChestSpots('stable', region, false, 0, { key: true, bridge: true })).toEqual(a);
      const opened = [a.find((s) => s.power === 'key')!.id, a.find((s) => s.power === 'bridge')!.id];
      const b = tripChestSpots('stable', region, false, 0, { key: true, bridge: true }, opened);
      expect(b.map((s) => s.id)).toEqual(a.map((s) => s.id));
    }
  });
  it('a power bought mid-trip never swaps out a chest already opened', () => {
    for (const region of REGION_IDS) for (let n = 0; n < 30; n++) {
      const base = tripChestSpots(`mid${n}`, region, false);
      const opened = base.filter((s) => !s.key).slice(0, 1).map((s) => s.id);
      const after = tripChestSpots(`mid${n}`, region, false, 0, { key: true, bridge: true }, opened);
      expect(after).toHaveLength(base.length);
      for (const id of opened) expect(after.map((s) => s.id)).toContain(id);
    }
  });

  // The graded set and its timings must equal a run with no item (PDR rule 1).
  const grading = (name: string, gear: MapGear) =>
    it(`${name}: the session's graded set and timings equal a no-item run`, () => {
      for (const who of ['reader', 'prereader'] as const) for (const region of REGION_IDS) for (let n = 0; n < 25; n++) {
        const none = planWith(who, `gs${n}`, region);
        const withGear = planWith(who, `gs${n}`, region, gear);
        expect(withGear.spots.length, `${who} ${region} gs${n}`).toBe(none.spots.length);
        expect(JSON.stringify(withGear.runner.queue), 'queue').toBe(JSON.stringify(none.runner.queue));
        expect(withGear.entities.map((e) => `${e.kind}:${e.id}:${e.cardId}`).sort()).toEqual(none.entities.map((e) => `${e.kind}:${e.id}:${e.cardId}`).sort());
        const a = play(none.runner);
        const b = play(withGear.runner);
        expect(b).toEqual(a);
        expect(b.graded).toBe(a.graded);
        expect(b.medianMs).toBe(a.medianMs);
      }
    });
  grading('key', { key: true });
  grading('bridge kit', { bridge: true });
  grading('key and bridge kit together', { key: true, bridge: true });

  it('fast boots: the graded set and timings equal a no-item run, and only the walk is faster', () => {
    expect(walkSpeed(false)).toBe(SPEED);
    expect(walkSpeed(true)).toBe(BOOT_SPEED);
    expect(BOOT_SPEED / SPEED).toBe(1.5);
    for (const who of ['reader', 'prereader'] as const) {
      // Boots add no input to the plan: the same plan, and the same answers at the same think time, record the same session.
      const a = play(planWith(who, 'boots', 'meadow').runner);
      const b = play(planWith(who, 'boots', 'meadow').runner);
      expect(b).toEqual(a);
    }
    // The speed is read in the movement loop only, and the loop stands still while a question shows.
    const src = readFileSync(new URL('./Overworld.tsx', import.meta.url), 'utf8');
    expect(src.match(/walkSpeed\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/BOOT_SPEED|\bSPEED\b/);
    for (const f of ['../../engine/session.ts', '../../engine/grading.ts', '../../engine/pause.ts', './boss.ts']) expect(readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/walkSpeed|BOOT_SPEED|a-boots|a-key|a-bridge/);
  });

  it('an older bundle that knows no power reads a trip with a power chest opened: its own chests stay, nothing extra opens', () => {
    for (const region of REGION_IDS) {
      const p = powerSpots(region)[0]!;
      const a = planWith('reader', 'old1', region, undefined, [p.id]);
      const none = planWith('reader', 'old1', region);
      expect(a.entities.filter((e) => e.kind === 'chest')).toHaveLength(none.entities.filter((e) => e.kind === 'chest').length);
    }
  });
});

describe('map powers: gems of a powered chest', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  const kid = { gemSpeed: 1, gemFullRate: undefined };
  const game = { gems: 40, xp: 0, bestCombo: 0, heroes: ['knight'], hero: 'knight', streakDays: 1, lastPlayedDay: '2026-11-19' } as Parameters<typeof applyDelta>[0];

  it('the same chest id granted twice pays once: a repeated tap or a re-render opens nothing again', () => {
    for (const region of REGION_IDS) for (const s of powerSpots(region)) {
      const { trip } = resolveTrip(null, NOW, () => `pay-${s.id}`);
      const first = claimChest(KID, trip, s.id, true);
      expect(first.opened).toBe(true);
      expect([1, 2]).toContain(first.gems);
      const again = claimChest(KID, trip, s.id, true);
      expect(again).toEqual({ opened: false, gems: 0 });
      expect(openedSpots(trip)).toEqual([s.id]);
    }
  });
  it('a wrong answer opens the chest and pays nothing, and the retry opens nothing', () => {
    const s = powerSpots('meadow')[0]!;
    const { trip } = resolveTrip(null, NOW, () => 'miss-trip');
    expect(claimChest(KID, trip, s.id, false)).toEqual({ opened: true, gems: 0 });
    expect(claimChest(KID, trip, s.id, true)).toEqual({ opened: false, gems: 0 });
  });
  it('a power chest pays through gemGrant and the soft throttle: full, half, then quarter rate, never above the cap of 10', () => {
    const base = claimChest(KID, resolveTrip(null, NOW, () => 'g1').trip, powerSpots('castle')[0]!.id, true).gems;
    expect(throttledGems(base, 'reader', kid, 0)).toBe(base);
    expect(throttledGems(2, 'reader', kid, 5000)).toBe(1);
    const next = applyDelta(game, { gemGrant: { base, learner: 'reader', settings: kid }, playedAt: NOW });
    expect(next.gems - game.gems).toBe(base);
    const big = applyDelta(game, { gemGrant: { base: 999, learner: 'reader', settings: kid }, playedAt: NOW });
    expect(big.gems - game.gems).toBeLessThanOrEqual(GEM_RUN_MAX);
  });
  it('powered chests count toward the daily throttle: 5 of them in a day pay less than 5 full chests', () => {
    let g = game;
    let paid = 0;
    for (let i = 0; i < 40; i++) {
      const before = g.gems;
      g = applyDelta(g, { gemGrant: { base: 2, learner: 'reader', settings: kid }, playedAt: NOW });
      paid += g.gems - before;
    }
    expect(paid).toBeLessThan(80);
    expect(g.gems - game.gems).toBe(paid);
  });
});
