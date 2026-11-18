import { describe, expect, it } from 'vitest';
import { FACTS } from '../../engine/modules/facts';
import { GROUP_UNLOCK_SHARE, groupSteady, steadyShare, unlockedFactGroups } from '../../engine/mastery';
import type { CardMap, CardState } from '../../engine/models';
import { DEFAULT_SETTINGS } from '../../engine/models';
import { mulberry32 } from '../../engine/problems';
import { SessionRunner, type PlanItem } from '../../engine/session';
import { BOSS_GEMS, bossPlan, bossReady, bossReward } from './boss';
import { planEntities, retryEntity, MAX_VISIBLE } from './encounters';
import { MAPS, REGION_IDS, findTiles, heroStart, isWalkable, tileAt, type WalkCtx } from './maps';
import { findPath } from './pathfind';
import { gateInfo, lairMessage, regionCardIds, regionFactsText, regionProgress, NEXT_REGION, REGION_GROUPS } from './regions';
import { MAX_OPENED, fromDoc, newWorld, settleHero, toDoc, worldReducer } from './worldState';

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
/** Seen and answered, but FSRS stability is still under 2 days, so cardLevel is 1. */
function young(id: string, results: boolean[]): CardState {
  return {
    id, attempts: results.length, correct: results.filter(Boolean).length, recentMs: [2500], lastRating: 3, updatedAt: NOW - DAY, lastResults: results,
    fsrs: { due: NOW + DAY, stability: 0.6, difficulty: 5, elapsed_days: 1, scheduled_days: 1, learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: NOW - DAY },
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
  it('the last region ends in a closed door, and the first has no gate back', () => {
    expect(findTiles(MAPS.meadow, 'back')).toHaveLength(0);
    expect(NEXT_REGION.castle).toBeNull();
    // The door is drawn as a closed gate and never opens: no walk reaches it, with every gate open or shut.
    for (const t of findTiles(MAPS.castle, 'gate')) expect(isWalkable(MAPS.castle, t.x, t.y, shut)).toBe(false);
    expect(findTiles(MAPS.castle, 'gate').length).toBeGreaterThanOrEqual(1);
    expect(findTiles(MAPS.meadow, 'gate').length).toBeGreaterThanOrEqual(1);
  });
  it.each(REGION_IDS)('%s: no walkable tile on the border except the gates G and g', (id) => {
    const m = MAPS[id];
    const bad: string[] = [];
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        if (x !== 0 && y !== 0 && x !== m.w - 1 && y !== m.h - 1) continue;
        const ch = m.rows[y]![x]!;
        const walk = isWalkable(m, x, y, { gateOpen: true, hasKey: true, hasBridgeKit: true });
        if (walk && ch !== 'G' && ch !== 'g') bad.push(`${x},${y}=${ch}`);
      }
    expect(bad).toEqual([]);
  });
  it('a gate on the border of the last region is closed even when every other gate is open', () => {
    // NEXT_REGION.castle is null, so the app's walk context has gateOpen false there.
    const g = findTiles(MAPS.castle, 'gate')[0]!;
    expect(isWalkable(MAPS.castle, g.x, g.y, shut)).toBe(false);
    expect(findPath(MAPS.castle, heroStart(MAPS.castle), g, shut)).toBeNull();
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
  it('the lair also opens at the steady share: seen, and the last 2 answers right (1 of 10 reviewing, 8 of 10 steady)', () => {
    const ids = regionCardIds('castle');
    expect(ids).toHaveLength(10);
    const cards: CardMap = {};
    // 1 card Reviewing; 8 cards young (stability under 2 days) but with 2 right answers; 1 card never seen.
    cards[ids[0]!] = { ...solid(ids[0]!), lastResults: [true, false] };
    ids.slice(1, 9).forEach((id) => (cards[id] = young(id, [true, true])));
    const p = regionProgress('castle', cards);
    expect(p.reviewing).toBe(1);
    expect(p.steady).toBe(8);
    expect(p.done).toBe(8);
    expect(bossReady('castle', cards)).toBe(true);
    // One answer short of the share on both rules keeps it shut.
    cards[ids[8]!] = young(ids[8]!, [true, false]);
    expect(regionProgress('castle', cards)).toMatchObject({ reviewing: 1, steady: 7, done: 7 });
    expect(bossReady('castle', cards)).toBe(false);
  });
  it('the count and the bar use the larger of the 2 counts', () => {
    const ids = regionCardIds('castle');
    const reviewingHigher: CardMap = {};
    ids.slice(0, 6).forEach((id) => (reviewingHigher[id] = { ...solid(id), lastResults: [true, false] }));
    expect(regionProgress('castle', reviewingHigher)).toMatchObject({ reviewing: 6, steady: 0, done: 6, share: 0.6 });
    const steadyHigher: CardMap = {};
    ids.slice(0, 5).forEach((id) => (steadyHigher[id] = young(id, [true, true])));
    steadyHigher[ids[5]!] = solid(ids[5]!);
    expect(regionProgress('castle', steadyHigher)).toMatchObject({ reviewing: 1, steady: 5 + 1, done: 6 });
    const none = regionProgress('castle', {});
    expect(none).toMatchObject({ done: 0, total: 10, share: 0 });
  });
  it('shares the steady logic with the module groups: steadyShare is what groupSteady calls', () => {
    const cards = cardsFor([3]);
    const half: CardMap = {};
    group(3).forEach((id, i) => (half[id] = i % 2 ? solid(id) : young(id, [true, false])));
    expect(groupSteady(FACTS, 3, half)).toBe(steadyShare(group(3), half));
    expect(steadyShare([], cards)).toBe(1);
    expect(GROUP_UNLOCK_SHARE).toBe(0.8);
  });
  it('the locked lair message names the region and its facts', () => {
    expect(regionFactsText('castle')).toBe('6s, 7s, 8s and 12x12');
    expect(lairMessage('castle', 1, 10)).toBe('Answer the Castle facts to wake the dragon: 6s, 7s, 8s and 12x12. 1 of 10 ready.');
    expect(lairMessage('forest', 3, 20)).toBe(`Answer the Forest facts to wake the dragon: ${regionFactsText('forest')}. 3 of 20 ready.`);
    expect(regionFactsText('meadow')).toBe('0s, 1s, 2s, 5s, 10s, 3s and 4s');
  });
  it('a lair pays once per region: the first win pays gems and a key, a second win (also after a reload) pays 0', () => {
    let w = newWorld(NOW);
    const first = bossReward(w, 'meadow');
    expect(first).toEqual({ gems: BOSS_GEMS, first: true });
    w = worldReducer(w, { t: 'boss', region: 'meadow' }, NOW);
    expect(w.keys).toBe(1);
    // Same session.
    expect(bossReward(w, 'meadow')).toEqual({ gems: 0, first: false });
    expect(worldReducer(w, { t: 'boss', region: 'meadow' }, NOW + 1).keys).toBe(1);
    // After a reload: the stored doc, read back.
    const reloaded = fromDoc(JSON.parse(JSON.stringify(toDoc(w))), NOW + 2);
    expect(reloaded.bossesDefeated).toEqual(['meadow']);
    expect(bossReward(reloaded, 'meadow')).toEqual({ gems: 0, first: false });
    expect(worldReducer(reloaded, { t: 'boss', region: 'meadow' }, NOW + 3).keys).toBe(1);
    // Another region still pays.
    expect(bossReward(reloaded, 'forest').gems).toBe(BOSS_GEMS);
  });
  it('golden profile (1 of 10 reviewing, 8 of 10 steady): opens the Castle lair on the steady rule and reads N of 10 from the larger count', () => {
    const ids = regionCardIds('castle');
    const cards: CardMap = { [ids[0]!]: { ...solid(ids[0]!), lastResults: [true, false] } };
    ids.slice(1, 9).forEach((id) => (cards[id] = young(id, [true, true])));
    expect(bossReady('castle', cards)).toBe(true);
    const p = regionProgress('castle', cards);
    expect(lairMessage('castle', p.done, p.total)).toBe('Answer the Castle facts to wake the dragon: 6s, 7s, 8s and 12x12. 8 of 10 ready.');
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

describe('worldState: lastMode', () => {
  it('is kept by fromDoc when valid and dropped when junk or missing', () => {
    const base = toDoc(newWorld(1));
    expect(fromDoc({ ...base, lastMode: 'overworld' }, 2).lastMode).toBe('overworld');
    expect(fromDoc({ ...base, lastMode: 'moon' }, 2).lastMode).toBeUndefined();
    expect(fromDoc(base, 2).lastMode).toBeUndefined();
    expect(toDoc(fromDoc({ ...base, lastMode: 'dungeon' }, 2)).lastMode).toBe('dungeon');
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

describe('adventure regions: distinct Forest and Castle', () => {
  const tiles = (id: (typeof REGION_IDS)[number], t: Parameters<typeof findTiles>[1]) => findTiles(MAPS[id], t);
  const same = (a: string[], b: string[]) => {
    let n = 0;
    let all = 0;
    for (let y = 0; y < a.length; y++) for (let x = 0; x < a[y]!.length; x++) (all++, a[y]![x] === b[y]![x] && n++);
    return n / all;
  };
  const waterColumns = (id: (typeof REGION_IDS)[number]) => new Set(tiles(id, 'water').map((t) => t.x));

  it('no two regions share more than half of their tiles', () => {
    for (const [a, b] of [['meadow', 'forest'], ['meadow', 'castle'], ['forest', 'castle']] as const) expect(same(MAPS[a].rows, MAPS[b].rows), `${a} vs ${b}`).toBeLessThan(0.5);
  });
  it('the Meadow keeps its river at columns 28 and 29; the Forest stream and the Castle moat run elsewhere', () => {
    expect([...waterColumns('meadow')].filter((x) => x === 28 || x === 29)).toHaveLength(2);
    for (const id of ['forest', 'castle'] as const) {
      const inRiver = tiles(id, 'water').filter((t) => t.x === 28 || t.x === 29).length;
      expect(inRiver, `${id} water in river columns`).toBeLessThan(4);
    }
  });
  it('the Forest is dense with trees, and its stream is narrow and winds', () => {
    const interior = (MAPS.forest.w - 2) * (MAPS.forest.h - 2);
    expect(tiles('forest', 'tree').length / interior).toBeGreaterThan(0.3);
    expect(tiles('meadow', 'tree').length / interior).toBeLessThan(0.2);
    // The stream is one or two tiles wide on every row, and its column moves by at least 4 between its far points.
    const water = tiles('forest', 'water').filter((t) => !(t.x >= 7 && t.x <= 12 && t.y >= 21 && t.y <= 24));
    const cols = new Set(water.map((t) => t.x));
    expect(cols.size).toBeGreaterThanOrEqual(4);
    for (let y = 1; y < MAPS.forest.h - 1; y++) expect(water.filter((t) => t.y === y).length, `row ${y}`).toBeLessThanOrEqual(5);
  });
  it('the Forest path winds: its rows move away from the straight line', () => {
    const rows = new Set(tiles('forest', 'path').filter((t) => t.x >= 8 && t.x <= 32).map((t) => t.y));
    expect(Math.max(...rows) - Math.min(...rows)).toBeGreaterThanOrEqual(6);
  });
  it('the Castle has courtyard walls, torches, a moat crossed by a drawbridge, and keeps the closed door', () => {
    expect(tiles('castle', 'wall').length).toBeGreaterThanOrEqual(100);
    expect(tiles('castle', 'torch').length).toBeGreaterThanOrEqual(8);
    expect(tiles('castle', 'water').length).toBeGreaterThanOrEqual(40);
    const bridge = tiles('castle', 'bridge');
    expect(bridge.length).toBeGreaterThanOrEqual(2);
    // The drawbridge sits between moat tiles in its own column, so the moat is crossed there and nowhere else on the road.
    for (const b of bridge) expect(tileAt(MAPS.castle, b.x, b.y - 1) === 'water' || tileAt(MAPS.castle, b.x, b.y + 1) === 'water' || tileAt(MAPS.castle, b.x - 1, b.y) === 'bridge' || tileAt(MAPS.castle, b.x + 1, b.y) === 'bridge').toBe(true);
    for (const w of [...tiles('castle', 'wall'), ...tiles('castle', 'torch')]) expect(isWalkable(MAPS.castle, w.x, w.y, { gateOpen: true, hasKey: true, hasBridgeKit: true })).toBe(false);
    expect(findTiles(MAPS.castle, 'gate').length).toBeGreaterThanOrEqual(1);
  });
  it('with every gate open, every chest, the camp, the lair door and every spawn tile are reachable on the new maps', () => {
    for (const id of REGION_IDS) {
      const m = MAPS[id];
      const s = heroStart(m);
      for (const t of [...findTiles(m, 'camp'), ...findTiles(m, 'chest'), ...findTiles(m, 'spawn')]) expect(findPath(m, s, t, open), `${id} ${t.x},${t.y}`).not.toBeNull();
      const b = findTiles(m, 'boss')[0]!;
      expect(findPath(m, s, { x: b.x, y: b.y + 1 }, open), `${id} lair`).not.toBeNull();
    }
  });
  it('the forest gate onward and the way back into each region from the next one are walkable', () => {
    const g = findTiles(MAPS.forest, 'gate')[0]!;
    expect(findPath(MAPS.forest, heroStart(MAPS.forest), g, open)).not.toBeNull();
    // Coming back through a forward gate, the hero stands one tile left of it.
    for (const id of ['meadow', 'forest'] as const) {
      const gate = findTiles(MAPS[id], 'gate')[0]!;
      expect(isWalkable(MAPS[id], gate.x - 1, gate.y, open), id).toBe(true);
    }
  });
});

describe('adventure regions: saved state survives the new layouts', () => {
  const doc = (over: Record<string, unknown>) => ({ region: 'castle', x: 6, y: 8, facing: 'left', openedChests: ['mul:6x7', 'mul:7x8'], bossesDefeated: ['meadow'], keys: 1, version: 1, updatedAt: NOW, ...over });

  it('a hero saved at the old castle tile (6,8) is not on a walkable tile now, and loads at the castle start', () => {
    expect(isWalkable(MAPS.castle, 6, 8, open)).toBe(false);
    const w = settleHero(fromDoc(doc({}), NOW));
    expect({ x: w.x, y: w.y }).toEqual(heroStart(MAPS.castle));
    expect(isWalkable(MAPS.castle, w.x, w.y, open)).toBe(true);
    // Everything else in the save is untouched.
    expect(w).toMatchObject({ region: 'castle', facing: 'left', keys: 1, bossesDefeated: ['meadow'], openedChests: ['mul:6x7', 'mul:7x8'] });
  });
  it('a hero on a walkable tile stays where the save put it', () => {
    const w = settleHero(fromDoc(doc({ x: 20, y: 14 }), NOW));
    expect({ x: w.x, y: w.y }).toEqual({ x: 20, y: 14 });
  });
  it('every region start and every old saved tile that is now blocked settles onto a walkable tile', () => {
    for (const id of REGION_IDS) for (let y = 0; y < MAPS[id].h; y++) for (let x = 0; x < MAPS[id].w; x++) {
      const w = settleHero(fromDoc(doc({ region: id, x, y }), NOW));
      expect(isWalkable(MAPS[id], w.x, w.y, { gateOpen: true, hasKey: false, hasBridgeKit: false })).toBe(true);
    }
  });
  it('opened chests are stored as card ids, never as positions, so a redrawn map cannot lose them', () => {
    const r = new SessionRunner([{ cardId: 'mul:6x7', isNew: true }, { cardId: 'mul:7x8', isNew: true }, { cardId: 'mul:6x8', isNew: true }], {}, mulberry32(3), () => NOW, DEFAULT_SETTINGS);
    for (const id of ['forest', 'castle'] as const) {
      const m = MAPS[id];
      const ents = planEntities({ entries: r.queue, map: m, hero: heroStart(m), openedChests: [], rng: mulberry32(9), ctx: open });
      const chests = ents.filter((e) => e.kind === 'chest');
      expect(chests.length, id).toBe(3);
      let w = newWorld(NOW);
      for (const c of chests) w = worldReducer(w, { t: 'chest', cardId: c.cardId });
      expect(w.openedChests.sort()).toEqual(['mul:6x7', 'mul:6x8', 'mul:7x8']);
      for (const stored of w.openedChests) expect(stored).toMatch(/^[a-z]+:/);
    }
  });
  it('a chest opened before the redraw stays opened on the new maps: the same card is a monster, never a chest again', () => {
    const w = fromDoc(doc({}), NOW);
    expect(w.openedChests).toEqual(['mul:6x7', 'mul:7x8']);
    const r = new SessionRunner([{ cardId: 'mul:6x7', isNew: true }, { cardId: 'mul:6x8', isNew: true }], {}, mulberry32(3), () => NOW, DEFAULT_SETTINGS);
    for (const id of REGION_IDS) {
      const m = MAPS[id];
      const ents = planEntities({ entries: r.queue, map: m, hero: heroStart(m), openedChests: w.openedChests, rng: mulberry32(9), ctx: open });
      expect(ents.find((e) => e.cardId === 'mul:6x7')!.kind, id).toBe('monster');
      expect(ents.find((e) => e.cardId === 'mul:6x8')!.kind, id).toBe('chest');
    }
  });
  it('the stored world doc keeps its 10 fields', () => {
    expect(Object.keys(toDoc({ ...newWorld(NOW), lastMode: 'overworld' })).length).toBeLessThanOrEqual(10);
  });
});
