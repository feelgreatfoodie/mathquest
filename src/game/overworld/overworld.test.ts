import { describe, expect, it } from 'vitest';
import { FACTS } from '../../engine/modules/facts';
import { unlockedFactGroups } from '../../engine/mastery';
import type { CardMap, CardState } from '../../engine/models';
import { DEFAULT_SETTINGS } from '../../engine/models';
import { mulberry32 } from '../../engine/problems';
import { SessionRunner, type PlanItem } from '../../engine/session';
import { bossPlan, bossReady } from './boss';
import { planEntities, retryEntity, MAX_VISIBLE } from './encounters';
import { MAPS, REGION_IDS, findTiles, heroStart, isWalkable, tileAt, type WalkCtx } from './maps';
import { findPath } from './pathfind';
import { gateInfo, REGION_GROUPS } from './regions';
import { MAX_OPENED, fromDoc, newWorld, toDoc, worldReducer } from './worldState';

const NOW = new Date('2026-11-16T16:00:00').getTime();
const DAY = 86_400_000;
const open: WalkCtx = { gateOpen: true, hasKey: false, hasBridgeKit: false };
const shut: WalkCtx = { gateOpen: false, hasKey: false, hasBridgeKit: false };

/** A card at Reviewing level: seen, in the Review state, stable over 2 days, 3 reps. */
function solid(id: string, dueIn = 5 * DAY): CardState {
  return {
    id, attempts: 5, correct: 5, recentMs: [2000, 2100], lastRating: 3, updatedAt: NOW - DAY, lastResults: [true, true],
    fsrs: { due: NOW + dueIn, stability: 5, difficulty: 5, elapsed_days: 1, scheduled_days: 5, learning_steps: 0, reps: 3, lapses: 0, state: 2, last_review: NOW - DAY },
  };
}
const group = (i: number) => FACTS.groups![i]!.cardIds;
function cardsFor(groups: number[], share = 1): CardMap {
  const out: CardMap = {};
  for (const g of groups) {
    const ids = group(g);
    ids.slice(0, Math.ceil(ids.length * share)).forEach((id) => (out[id] = solid(id)));
  }
  return out;
}

describe('maps', () => {
  it.each(REGION_IDS)('%s is a rectangle with a start, a camp, a boss lair, chest spots and spawn zones', (id) => {
    const m = MAPS[id];
    expect(m.rows.length).toBe(m.h);
    expect(m.rows.every((r) => r.length === m.w)).toBe(true);
    expect(m.w).toBeGreaterThanOrEqual(36);
    expect(m.h).toBeGreaterThanOrEqual(26);
    expect(findTiles(m, 'camp').length).toBeGreaterThanOrEqual(1);
    expect(findTiles(m, 'boss')).toHaveLength(1);
    expect(findTiles(m, 'chest').length).toBeGreaterThanOrEqual(10);
    expect(findTiles(m, 'spawn').length).toBeGreaterThanOrEqual(40);
  });
  it('the hero start, the camp and the boss lair are reachable from each other with every gate open', () => {
    for (const id of REGION_IDS) {
      const m = MAPS[id];
      const s = heroStart(m);
      for (const t of [...findTiles(m, 'camp'), ...findTiles(m, 'chest')]) expect(findPath(m, s, t, open), `${id} ${t.x},${t.y}`).not.toBeNull();
      const b = findTiles(m, 'boss')[0]!;
      expect(findPath(m, s, { x: b.x, y: b.y + 1 }, open) ?? findPath(m, s, { x: b.x, y: b.y - 1 }, open)).not.toBeNull();
    }
  });
  it('the last region has no gate forward, and the first has no gate back', () => {
    expect(findTiles(MAPS.meadow, 'back')).toHaveLength(0);
    expect(findTiles(MAPS.castle, 'gate')).toHaveLength(0);
    expect(findTiles(MAPS.meadow, 'gate').length).toBeGreaterThanOrEqual(1);
  });
});

describe('A* movement', () => {
  const m = MAPS.meadow;
  it('finds a path of adjacent steps that never crosses a blocked tile', () => {
    const from = heroStart(m);
    const to = findTiles(m, 'chest')[0]!;
    const p = findPath(m, from, to, open)!;
    expect(p.at(-1)).toEqual(to);
    let prev = from;
    for (const s of p) {
      expect(Math.abs(s.x - prev.x) + Math.abs(s.y - prev.y)).toBe(1);
      expect(isWalkable(m, s.x, s.y, open)).toBe(true);
      prev = s;
    }
  });
  it('is shortest: on open grass it equals the Manhattan distance', () => {
    const from = heroStart(m);
    // Find any two grass tiles in a clear row and check the straight run.
    const row = m.rows.findIndex((r) => /\.{8}/.test(r));
    const x0 = m.rows[row]!.indexOf('........');
    const p = findPath(m, { x: x0, y: row }, { x: x0 + 7, y: row }, open)!;
    expect(p).toHaveLength(7);
    expect(from).toBeDefined();
  });
  it('returns null for a water tile, a tree and a tile past the map edge', () => {
    const from = heroStart(m);
    const w = findTiles(m, 'water')[0]!;
    const t = findTiles(m, 'tree')[0]!;
    expect(findPath(m, from, w, open)).toBeNull();
    expect(findPath(m, from, t, open)).toBeNull();
    expect(findPath(m, from, { x: -1, y: 4 }, open)).toBeNull();
    expect(tileAt(m, -1, 4)).toBe('rock');
  });
  it('never crosses a closed gate, and crosses it once it is open', () => {
    const g = findTiles(m, 'gate')[0]!;
    const beyond = findTiles(MAPS.forest, 'back')[0]!;
    expect(isWalkable(m, g.x, g.y, shut)).toBe(false);
    expect(isWalkable(m, g.x, g.y, open)).toBe(true);
    expect(beyond).toBeDefined();
    const from = heroStart(m);
    expect(findPath(m, from, g, shut)).toBeNull();
    expect(findPath(m, from, g, open)).not.toBeNull();
  });
  it('a door needs the key and a span needs the bridge kit', () => {
    for (const id of REGION_IDS) {
      const mm = MAPS[id];
      for (const d of findTiles(mm, 'door')) {
        expect(isWalkable(mm, d.x, d.y, open)).toBe(false);
        expect(isWalkable(mm, d.x, d.y, { ...open, hasKey: true })).toBe(true);
      }
      for (const d of findTiles(mm, 'span')) {
        expect(isWalkable(mm, d.x, d.y, open)).toBe(false);
        expect(isWalkable(mm, d.x, d.y, { ...open, hasBridgeKit: true })).toBe(true);
      }
    }
  });
});

describe('gates open exactly at the unlock threshold', () => {
  const settings = { ...DEFAULT_SETTINGS };
  it('the regions follow the groups: meadow g1-2, forest g3, castle g4-5', () => {
    expect(REGION_GROUPS).toEqual({ meadow: [1, 2], forest: [3, 3], castle: [4, 5] });
  });
  it('forest opens when unlockedFactGroups reaches 3, and not one answer sooner', () => {
    // Group 1 at 100%, group 2 just under 80% in review: only 2 groups are open, so the forest gate is shut.
    const g2 = group(1);
    const need = Math.ceil(g2.length * 0.8);
    const below: CardMap = { ...cardsFor([0]) };
    g2.slice(0, need - 1).forEach((id) => (below[id] = solid(id)));
    expect(unlockedFactGroups(below, settings)).toBe(2);
    expect(gateInfo('forest', below, settings).open).toBe(false);
    const atBar: CardMap = { ...below, [g2[need - 1]!]: solid(g2[need - 1]!) };
    expect(unlockedFactGroups(atBar, settings)).toBe(3);
    expect(gateInfo('forest', atBar, settings).open).toBe(true);
  });
  it('meadow is always open, and a closed gate says how many are learned', () => {
    expect(gateInfo('meadow', {}, settings).open).toBe(true);
    const info = gateInfo('forest', cardsFor([0]), settings);
    expect(info.open).toBe(false);
    expect(info.total).toBe(group(0).length + group(1).length);
    expect(info.learned).toBe(group(0).length);
    expect(info.label).toBe(`${info.learned} of ${info.total} learned`);
  });
  it('with times tables off there is no ladder, so every gate is open', () => {
    const noFacts = { ...DEFAULT_SETTINGS, tracks: { facts: false, multidigit: true, fractions: false } };
    expect(gateInfo('castle', {}, noFacts).open).toBe(true);
  });
});

describe('boss', () => {
  const settings = { ...DEFAULT_SETTINGS, factGroupsUnlocked: 5 };
  it('the lair opens at 80% Reviewing in the region groups', () => {
    const [from, to] = REGION_GROUPS.meadow;
    const idx = [from - 1, to - 1];
    const all = idx.flatMap((i) => group(i));
    const need = Math.ceil(all.length * 0.8);
    const some: CardMap = {};
    all.slice(0, need - 1).forEach((id) => (some[id] = solid(id)));
    expect(bossReady('meadow', some)).toBe(false);
    some[all[need - 1]!] = solid(all[need - 1]!);
    expect(bossReady('meadow', some)).toBe(true);
  });
  it('a fight is 5 questions from seen cards in the region, weakest first', () => {
    const cards = cardsFor([0, 1]);
    const ids = Object.keys(cards);
    // Make one card clearly the weakest: due long ago, low stability.
    const weak = ids[3]!;
    cards[weak] = { ...cards[weak]!, fsrs: { ...cards[weak]!.fsrs, stability: 0.5, due: NOW - 4 * DAY, last_review: NOW - 5 * DAY } };
    const plan = bossPlan({ region: 'meadow', cards, now: NOW, rng: mulberry32(3) });
    expect(plan).toHaveLength(5);
    expect(plan[0]!.cardId).toBe(weak);
    for (const p of plan) expect(ids).toContain(p.cardId);
  });
  it('a question grades only when its card is due; otherwise it is practice (fill) and FSRS stays put', () => {
    const cards = cardsFor([0, 1]);
    const dueId = group(0)[0]!;
    cards[dueId] = { ...cards[dueId]!, fsrs: { ...cards[dueId]!.fsrs, due: NOW - DAY } };
    const plan = bossPlan({ region: 'meadow', cards, now: NOW, rng: mulberry32(3) });
    for (const p of plan) {
      const isDue = cards[p.cardId]!.fsrs.due <= NOW;
      expect(!!p.fill).toBe(!isDue);
    }
    const runner = new SessionRunner([], cards, mulberry32(4), () => NOW, DEFAULT_SETTINGS);
    runner.append(plan);
    const before = JSON.stringify(Object.fromEntries(plan.filter((p) => p.fill).map((p) => [p.cardId, cards[p.cardId]!.fsrs])));
    for (const e of runner.pending().filter((x) => x.fill)) {
      const a = e.problem.answer;
      runner.answerEntry(e.id, { kind: 'int', value: a.kind === 'int' ? a.value : 0 }, 1500);
    }
    const after = JSON.stringify(Object.fromEntries(plan.filter((p) => p.fill).map((p) => [p.cardId, runner.getCard(p.cardId)!.fsrs])));
    expect(after).toBe(before);
    expect(settings.sessionSize).toBeGreaterThan(0);
  });
  it('a region with no seen card has no fight', () => {
    expect(bossPlan({ region: 'castle', cards: {}, now: NOW, rng: mulberry32(1) })).toEqual([]);
    expect(bossReady('castle', {})).toBe(false);
  });
});

describe('runner.append: answer entries added after the plan', () => {
  it('appended entries get fresh ids and answerEntry grades them like any other', () => {
    const cards = cardsFor([0]);
    const plan: PlanItem[] = [{ cardId: group(0)[0]!, isNew: false }];
    const r = new SessionRunner(plan, cards, mulberry32(1), () => NOW, DEFAULT_SETTINGS);
    const first = r.queue.map((e) => e.id);
    r.append([{ cardId: group(0)[1]!, isNew: false }]);
    expect(r.queue).toHaveLength(2);
    expect(first).not.toContain(r.queue[1]!.id);
    const e = r.queue[1]!;
    const fb = r.answerEntry(e.id, { kind: 'int', value: e.problem.answer.kind === 'int' ? e.problem.answer.value : 0 }, 1200);
    expect(fb.verdict).toBe('correct');
  });
});

describe('encounters come from the plan', () => {
  const cards = cardsFor([0, 1]);
  function runnerWith(n: number, newCount: number): SessionRunner {
    const ids = Object.keys(cards);
    const plan: PlanItem[] = ids.slice(0, n).map((cardId) => ({ cardId, isNew: false }));
    const fresh = FACTS.cards.filter((c) => !cards[c.id]).slice(0, newCount).map((c) => ({ cardId: c.id, isNew: true }));
    return new SessionRunner([...plan, ...fresh], cards, mulberry32(7), () => NOW, DEFAULT_SETTINGS);
  }
  const m = MAPS.meadow;
  const hero = heroStart(m);
  const plan = (r: SessionRunner, opened: string[] = []) =>
    planEntities({ entries: r.queue, map: m, hero, openedChests: opened, rng: mulberry32(9), ctx: open });

  it('every graded or practice entry becomes exactly one entity; none on a blocked tile or stacked', () => {
    const r = runnerWith(20, 5);
    const ents = plan(r);
    const asked = r.queue.filter((e) => e.kind !== 'teach');
    expect(ents).toHaveLength(asked.length);
    expect(new Set(ents.map((e) => e.id))).toEqual(new Set(asked.map((e) => e.id)));
    const spots = new Set<string>();
    for (const e of ents) {
      expect(isWalkable(m, e.x, e.y, open)).toBe(true);
      expect(spots.has(`${e.x},${e.y}`)).toBe(false);
      spots.add(`${e.x},${e.y}`);
    }
  });
  it('a due review is a monster 6 to 15 tiles from the hero; a new card is a chest on a chest spot', () => {
    const r = runnerWith(12, 4);
    const ents = plan(r);
    const chestSpots = new Set(findTiles(m, 'chest').map((t) => `${t.x},${t.y}`));
    for (const e of ents) {
      const entry = r.queue.find((q) => q.id === e.id)!;
      if (entry.isNew) {
        expect(e.kind).toBe('chest');
        expect(chestSpots.has(`${e.x},${e.y}`)).toBe(true);
      } else {
        expect(e.kind).toBe('monster');
        const d = Math.abs(e.x - hero.x) + Math.abs(e.y - hero.y);
        expect(d).toBeGreaterThanOrEqual(6);
        expect(d).toBeLessThanOrEqual(15);
      }
    }
  });
  it('at most 6 monsters show at once; the rest wait', () => {
    const ents = plan(runnerWith(20, 0));
    expect(MAX_VISIBLE).toBe(6);
    expect(ents.filter((e) => e.kind === 'monster' && e.shown)).toHaveLength(6);
    expect(ents.filter((e) => e.kind === 'monster' && !e.shown)).toHaveLength(14);
  });
  it('a new skill chest carries its teach entry; a chest already opened is a monster instead', () => {
    const r = new SessionRunner([{ cardId: 'fr:add', isNew: true }], {}, mulberry32(2), () => NOW, DEFAULT_SETTINGS);
    const [teach, graded] = r.queue;
    const ents = plan(r);
    expect(ents).toHaveLength(1);
    expect(ents[0]).toMatchObject({ kind: 'chest', id: graded!.id, teachId: teach!.id });
    const again = plan(r, ['fr:add']);
    expect(again[0]!.kind).toBe('monster');
  });
  it('monsters look like their module: facts slimes or bats, fractions ghosts, multidigit skeletons', () => {
    const r = new SessionRunner([{ cardId: 'mul:7x8', isNew: false }, { cardId: 'fr:add', isNew: false }, { cardId: 'md:tens', isNew: false }], {}, mulberry32(2), () => NOW, DEFAULT_SETTINGS);
    const looks = Object.fromEntries(planEntities({ entries: r.queue, map: m, hero, openedChests: [], rng: mulberry32(1), ctx: open }).map((e) => [e.cardId, e.look]));
    expect(['slime', 'bat']).toContain(looks['mul:7x8']);
    expect(looks['fr:add']).toBe('ghost');
    expect(looks['md:tens']).toBe('skeleton');
  });
  it('a retry reappears within 3 tiles of where the monster was', () => {
    const r = runnerWith(6, 0);
    const ents = plan(r);
    const prev = ents.find((e) => e.kind === 'monster')!;
    const entry = r.queue.find((q) => q.id === prev.id)!;
    const retry = retryEntity({ prev, entry: { ...entry, id: 'e99', kind: 'practice' }, map: m, taken: ents.map((e) => ({ x: e.x, y: e.y })), rng: mulberry32(5), ctx: open });
    expect(retry.id).toBe('e99');
    expect(Math.max(Math.abs(retry.x - prev.x), Math.abs(retry.y - prev.y))).toBeLessThanOrEqual(3);
    expect(isWalkable(m, retry.x, retry.y, open)).toBe(true);
    expect(retry.look).toBe(prev.look);
  });
});

describe('worldState', () => {
  it('starts in the meadow at the map start with nothing opened', () => {
    const w = newWorld(5);
    expect(w).toMatchObject({ region: 'meadow', openedChests: [], bossesDefeated: [], keys: 0, version: 1 });
    expect(heroStart(MAPS.meadow)).toEqual({ x: w.x, y: w.y });
  });
  it('moves, opens chests (once), changes region, and wins a boss once for one key', () => {
    let w = newWorld(1);
    w = worldReducer(w, { t: 'move', x: 5, y: 6, facing: 'left' }, 2);
    expect(w).toMatchObject({ x: 5, y: 6, facing: 'left', updatedAt: 2 });
    w = worldReducer(worldReducer(w, { t: 'chest', cardId: 'mul:2x3' }), { t: 'chest', cardId: 'mul:2x3' });
    expect(w.openedChests).toEqual(['mul:2x3']);
    w = worldReducer(w, { t: 'region', region: 'forest', x: 3, y: 4 });
    expect(w).toMatchObject({ region: 'forest', x: 3, y: 4 });
    w = worldReducer(worldReducer(w, { t: 'boss', region: 'forest' }), { t: 'boss', region: 'forest' });
    expect(w.bossesDefeated).toEqual(['forest']);
    expect(w.keys).toBe(1);
  });
  it('keeps at most 500 opened chests, dropping the oldest', () => {
    let w = newWorld(1);
    for (let i = 0; i < MAX_OPENED + 25; i++) w = worldReducer(w, { t: 'chest', cardId: `c${i}` });
    expect(w.openedChests).toHaveLength(MAX_OPENED);
    expect(w.openedChests.at(-1)).toBe(`c${MAX_OPENED + 24}`);
    expect(w.openedChests[0]).toBe('c25');
  });
  it('persists in both directions: state to doc and back, and the doc stays under 20 fields', () => {
    let w = newWorld(1);
    w = worldReducer(worldReducer(w, { t: 'chest', cardId: 'mul:2x3' }), { t: 'boss', region: 'meadow' }, 77);
    const doc = toDoc(w);
    expect(Object.keys(doc).length).toBeLessThan(20);
    expect(fromDoc(JSON.parse(JSON.stringify(doc)), 1)).toEqual(w);
  });
  it('a damaged doc reads as a fresh world instead of throwing', () => {
    for (const junk of [null, 5, 'x', [], { region: 'moon', x: 'a', openedChests: 7, keys: -4, bossesDefeated: ['castle', 'moon'] }]) {
      const w = fromDoc(junk, 9);
      expect(['meadow', 'forest', 'castle']).toContain(w.region);
      expect(Array.isArray(w.openedChests)).toBe(true);
      expect(w.keys).toBeGreaterThanOrEqual(0);
      expect(w.bossesDefeated.every((b) => ['meadow', 'forest', 'castle'].includes(b))).toBe(true);
    }
  });
});
