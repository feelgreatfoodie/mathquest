// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PRESETS, type CardMap, type CardState, type KidSettings } from '../../engine/models';
import { factBaseline } from '../../engine/grading';
import { getCardDef } from '../../engine/modules';
import { checkAnswer, mulberry32 } from '../../engine/problems';
import { SessionRunner } from '../../engine/session';
import { BOSS_GEMS } from './boss';
import {
  BOSS_BUDGET_MAX_MS, BOSS_BUDGET_MIN_MS, BossClock, LAIR_BOSS_QUESTIONS, LAIR_FACT_CAP, REPLAY_GEMS, bossBudgetMs, bossOutcome, bossTimerOn,
  buildLairPlan, canResumeLair, enterLair, formProblem, instantiateLair, lairProgress, lairReward, lairSizeFor, lairSpotId, lairStats, loadLair,
  planLairEntities, roomsClearedOf, saveLair, showRooms, watchVisibility, type LairPlan, type VisibilitySource,
} from './lair';
import { LAIRS } from './maps';
import { ladderCards, regionCards } from './regions';
import { REGION_IDS } from './maps';

const NOW = new Date('2026-11-16T16:00:00').getTime();
const DAY = 86_400_000;

function card(id: string, o: Partial<CardState> & { stability?: number; ms?: number[]; missToday?: boolean } = {}): CardState {
  return {
    id, attempts: 6, correct: 5, recentMs: o.ms ?? [2000, 2200], lastRating: 3, updatedAt: NOW - DAY, lastResults: [true, true],
    ...(o.missToday ? { missDay: '2026-11-16' } : {}),
    fsrs: { due: NOW + 5 * DAY, stability: o.stability ?? 5, difficulty: 5, elapsed_days: 1, scheduled_days: 5, learning_steps: 0, reps: 3, lapses: 0, state: 2, last_review: NOW - DAY },
  };
}

/** Every card of the kid's ladder seen. `weak` sets stability per card id so the ranking is known. */
function seenAll(settings: KidSettings, weak: Record<string, Parameters<typeof card>[1]> = {}): CardMap {
  const cards: CardMap = {};
  ladderCards(settings).forEach((id, i) => (cards[id] = card(id, weak[id] ?? { stability: 3 + (i % 7) })));
  return cards;
}

const READER: KidSettings = { ...DEFAULT_SETTINGS, modules: { facts: true }, factGroupsUnlocked: 5 };
/** The younger kid: pictures only, times tables off. */
const PRE: KidSettings = { ...PRESETS.prereader, modules: { add10: true, sub10: true, bonds10: true, missing10: true }, tracks: { facts: false, multidigit: false, fractions: false } };

const plan = (region: (typeof REGION_IDS)[number], settings: KidSettings, cards: CardMap, seed = 1, rooms?: 24 | 18 | 12) =>
  buildLairPlan({ region, cards, settings, learner: settings.learner === 'prereader' ? 'prereader' : 'reader', now: NOW, rng: mulberry32(seed), ...(rooms ? { rooms } : {}) });

const roomIds = (p: LairPlan) => p.rooms.flatMap((r) => r.items.map((x) => x.cardId));

describe('lair plan sizes', () => {
  it.each(REGION_IDS)('%s: a reader gets 24 room questions and 6 boss questions', (region) => {
    const p = plan(region, READER, seenAll(READER));
    expect(p.size).toBe(24);
    expect(roomIds(p)).toHaveLength(24);
    expect(p.boss).toHaveLength(6);
  });
  it.each(REGION_IDS)('%s: a pre-reader gets 18 and 6, and a retry 12 and 6, for both kids', (region) => {
    const pre = plan(region, PRE, seenAll(PRE));
    expect(roomIds(pre)).toHaveLength(18);
    expect(pre.boss).toHaveLength(6);
    for (const s of [READER, PRE]) {
      const retry = plan(region, s, seenAll(s), 3, 12);
      expect(roomIds(retry)).toHaveLength(12);
      expect(retry.boss).toHaveLength(6);
    }
  });
  it('lairSizeFor: a retry is always 12', () => {
    expect([lairSizeFor('reader'), lairSizeFor('prereader'), lairSizeFor('reader', true), lairSizeFor('prereader', true)]).toEqual([24, 18, 12, 12]);
  });
  it('rooms are split in order over the rooms before the boss room, and each room ends in a guard', () => {
    for (const region of REGION_IDS) {
      const p = plan(region, READER, seenAll(READER));
      expect(p.rooms).toHaveLength(LAIRS[region].rooms.length - 1);
      for (const r of p.rooms) expect(r.items.at(-1)!.role).toBe('guard');
      expect(Math.max(...p.rooms.map((r) => r.items.length)) - Math.min(...p.rooms.map((r) => r.items.length))).toBeLessThanOrEqual(1);
    }
  });
  it('2 to 3 chests on chest tiles and 1 to 2 riddle traps among the room questions', () => {
    for (const region of REGION_IDS) {
      const p = plan(region, READER, seenAll(READER));
      const items = p.rooms.flatMap((r) => r.items);
      const chests = items.filter((x) => x.role === 'chest');
      expect(chests.length).toBeGreaterThanOrEqual(2);
      expect(chests.length).toBeLessThanOrEqual(3);
      expect(new Set(chests.map((c) => `${c.at!.x},${c.at!.y}`)).size).toBe(chests.length);
      expect(items.filter((x) => x.role === 'trap').length).toBeGreaterThanOrEqual(1);
      expect(items.filter((x) => x.role === 'trap').length).toBeLessThanOrEqual(2);
    }
  });
});

describe('lair question pool', () => {
  it.each([['facts kid', READER], ['pre-reader, facts off', PRE]] as const)('%s: rooms and boss come only from regionCards, each fact at most 3 times', (_n, settings) => {
    for (const region of REGION_IDS) {
      const pool = new Set(regionCards(region, settings));
      for (const seed of [1, 2, 3]) {
        const p = plan(region, settings, seenAll(settings), seed);
        const all = [...roomIds(p), ...p.boss.map((b) => b.cardId)];
        expect(all.filter((id) => !pool.has(id)), `${region} seed ${seed}`).toEqual([]);
        const counts = new Map<string, number>();
        for (const id of all) counts.set(id, (counts.get(id) ?? 0) + 1);
        expect(Math.max(...counts.values()), `${region} seed ${seed}`).toBeLessThanOrEqual(LAIR_FACT_CAP);
      }
    }
  });
  it('the pre-reader fixture has facts off and a ladder of picture modules only', () => {
    expect(ladderCards(PRE).some((id) => id.startsWith('mul:'))).toBe(false);
    expect(regionCards('meadow', PRE).length).toBeGreaterThan(0);
  });
  it('weakest first: the misses of today lead, then lowest stability, then slowest', () => {
    const ids = regionCards('forest', READER);
    const cards = seenAll(READER);
    // Three known weak cards, then the slowest of the rest.
    cards[ids[0]!] = card(ids[0]!, { stability: 9, missToday: true });
    cards[ids[1]!] = card(ids[1]!, { stability: 0.5 });
    cards[ids[2]!] = card(ids[2]!, { stability: 0.9 });
    for (const id of ids.slice(3)) cards[id] = card(id, { stability: 4, ms: [1500] });
    cards[ids[3]!] = card(ids[3]!, { stability: 4, ms: [9000] });
    const p = plan('forest', READER, cards);
    expect(roomIds(p).slice(0, 4)).toEqual([ids[0], ids[1], ids[2], ids[3]]);
  });
  it('a second build gives a fresh plan (a different order for equally weak cards)', () => {
    const cards = seenAll(READER, Object.fromEntries(regionCards('castle', READER).map((id) => [id, { stability: 4 }])));
    const a = plan('castle', READER, cards, 1);
    const b = plan('castle', READER, cards, 2);
    expect(roomIds(a)).not.toEqual(roomIds(b));
  });
  it('the boss is the hardest seen cards: slowest median first, and an unseen fact never comes up', () => {
    const ids = regionCards('meadow', READER);
    const cards: CardMap = {};
    ids.slice(0, 12).forEach((id, i) => (cards[id] = card(id, { ms: [1000 + i * 500] })));
    const p = plan('meadow', READER, cards);
    const boss = p.boss.map((b) => b.cardId);
    expect(boss.every((id) => cards[id])).toBe(true);
    // The hardest card (slowest) is in the boss; forms never replace it.
    expect(boss).toContain(ids[11]);
    expect(p.boss.find((b) => b.cardId === ids[11])!.form).toBeUndefined();
  });
  it('a reader boss has 1 to 2 forms and a pre-reader boss has none', () => {
    const p = plan('castle', READER, seenAll(READER));
    const forms = p.boss.filter((b) => b.form);
    expect(forms.length).toBeGreaterThanOrEqual(1);
    expect(forms.length).toBeLessThanOrEqual(2);
    if (forms.length === 2) expect(new Set(forms.map((f) => f.form)).size).toBe(2);
    expect(plan('castle', PRE, seenAll(PRE)).boss.some((b) => b.form)).toBe(false);
  });
});

describe('boss forms', () => {
  it('missing factor: "? x b = product" with the factor as the answer', () => {
    const p = formProblem('mul:7x8', 'missing', mulberry32(1))!;
    expect(p.tokens.map((t) => t.t)).toEqual(['blank', 'op', 'num', 'op', 'num']);
    expect(p.answer).toEqual({ kind: 'int', value: (p.tokens[2] as { v: number }).v === 8 ? 7 : 8 });
    expect(checkAnswer(p, { kind: 'int', value: p.answer.kind === 'int' ? p.answer.value : -1 })).toBe('correct');
    expect((p.tokens[4] as { v: number }).v).toBe(56);
  });
  it('two-step: "a x b - c" with the difference as the answer', () => {
    const p = formProblem('mul:7x8', 'twostep', mulberry32(2))!;
    const [a, , b, , c] = p.tokens as Array<{ v: number }>;
    expect(p.answer).toEqual({ kind: 'int', value: a!.v * b!.v - c!.v });
    expect(a!.v * b!.v).toBe(56);
    expect(c!.v).toBeGreaterThanOrEqual(1);
  });
  it('a card that is not a times fact has no form', () => {
    expect(formProblem('add:3+4', 'missing', mulberry32(1))).toBeNull();
  });
  it('a form is practice: no review, no retry, FSRS untouched', () => {
    const cards = seenAll(READER);
    const id = 'mul:7x8';
    const before = JSON.stringify(cards[id]!.fsrs);
    const runner = new SessionRunner([], cards, mulberry32(1), () => NOW, READER);
    const entry = runner.appendForm(id, formProblem(id, 'missing', mulberry32(3))!);
    expect(entry).toMatchObject({ kind: 'practice', form: true, cardId: id });
    const wrong = runner.answerEntry(entry.id, { kind: 'int', value: 999 }, 4000);
    expect(wrong.verdict).toBe('wrong');
    expect(wrong.rating).toBeNull();
    expect(runner.queue).toHaveLength(1);
    expect(JSON.stringify(runner.getCard(id)!.fsrs)).toBe(before);
    expect(runner.summary().answered).toBe(1);
  });
});

describe('boss budget', () => {
  const six = ['mul:7x8', 'mul:6x7', 'mul:8x8', 'mul:6x9', 'mul:7x9', 'mul:8x9'];
  const budget = (settings: Partial<KidSettings>, cards: CardMap = {}, ids = six) => bossBudgetMs(ids, cards, { ...READER, ...settings });

  it('example 1: default pace 3, no baseline history: 6 x 9 s x 1.5 = 81 s, normal', () => {
    expect(factBaseline({})).toBe(3500);
    expect(budget({})).toBe(81_000);
  });
  it('example 2: the parent factor multiplies after the clamp: harder 60.75 s, easier 121.5 s', () => {
    expect(budget({ bossTimer: 'harder' })).toBe(60_750);
    expect(budget({ bossTimer: 'easier' })).toBe(121_500);
  });
  it('example 3: below the floor the base is lifted to 30 s first, so easier is 45 s (not 1.5 x 27 s)', () => {
    expect(budget({ paceMultiplier: 1 })).toBe(BOSS_BUDGET_MIN_MS);
    expect(budget({ paceMultiplier: 1, bossTimer: 'easier' })).toBe(45_000);
    expect(budget({ paceMultiplier: 1, bossTimer: 'harder' })).toBe(22_500);
  });
  it('the cap: a pace of 5 clamps 135 s to 90 s before the factor', () => {
    expect(budget({ paceMultiplier: 5 })).toBe(BOSS_BUDGET_MAX_MS);
    expect(budget({ paceMultiplier: 5, bossTimer: 'easier' })).toBe(135_000);
  });
  it('a pre-reader gets x2 after the clamp, and the timer is on only when a parent chose it', () => {
    const ids = regionCards('meadow', PRE).slice(0, 6);
    const base = bossBudgetMs(ids, {}, { ...PRE, bossTimerPre: true });
    expect(base).toBe(bossBudgetMs(ids, {}, { ...PRE }));
    const reader = bossBudgetMs(ids, {}, { ...PRE, learner: 'reader' });
    expect(base).toBe(reader * 2);
    expect(bossTimerOn(PRE)).toBe(false);
    expect(bossTimerOn({ ...PRE, bossTimerPre: true })).toBe(true);
    expect(bossTimerOn(READER)).toBe(true);
  });
  it('the fast bar follows the kid: a faster baseline shortens the budget down to the floor', () => {
    const fast: CardMap = {};
    for (const id of six) fast[id] = card(id, { ms: [900, 900, 900] });
    const b = budget({ paceMultiplier: 3 }, fast);
    expect(b).toBe(40_500);
    expect(getCardDef('mul:7x8')).toBeTruthy();
  });
});

describe('boss clock', () => {
  it('runs from start and pauses only while hidden', () => {
    let t = 1000;
    const clock = new BossClock(60_000, () => t);
    clock.start();
    t += 10_000;
    expect(clock.remainingMs()).toBe(50_000);

    const handlers: Array<() => void> = [];
    const doc: VisibilitySource = {
      visibilityState: 'visible',
      addEventListener: (_t, fn) => void handlers.push(fn),
      removeEventListener: (_t, fn) => void handlers.splice(handlers.indexOf(fn), 1),
    };
    const stop = watchVisibility(clock, doc);
    doc.visibilityState = 'hidden';
    handlers.forEach((h) => h());
    t += 30_000; // hidden: does not count
    expect(clock.remainingMs()).toBe(50_000);
    expect(clock.running).toBe(false);
    doc.visibilityState = 'visible';
    handlers.forEach((h) => h());
    t += 5_000;
    expect(clock.remainingMs()).toBe(45_000);
    expect(clock.elapsedMs()).toBe(15_000);
    stop();
    expect(handlers).toHaveLength(0);
    doc.visibilityState = 'hidden';
    handlers.forEach((h) => h());
    t += 100_000;
    expect(clock.expired()).toBe(true);
  });
  it('starting hidden pauses at once, and expiry needs a start', () => {
    let t = 0;
    const clock = new BossClock(1000, () => t);
    expect(clock.expired()).toBe(false);
    clock.start();
    const doc = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} } as unknown as VisibilitySource;
    watchVisibility(clock, doc);
    t += 5000;
    expect(clock.expired()).toBe(false);
    clock.resume();
    t += 1000;
    expect(clock.expired()).toBe(true);
    expect(clock.remainingMs()).toBe(0);
  });
});

describe('boss outcome', () => {
  const o = (correct: number, answered: number, remainingMs: number | null, prereader = false, timerOn = true) => bossOutcome({ correct, answered, remainingMs, prereader, timerOn });
  it('5 of 6 right wins; 4 of 6 right is driven out', () => {
    expect(o(5, 5, 20_000)).toBe('win');
    expect(o(5, 6, 20_000)).toBe('win');
    expect(o(4, 6, 20_000)).toBe('lose');
    expect(o(3, 5, 20_000)).toBe('lose');
  });
  it('the fight goes on while 5 is still reachable', () => {
    expect(o(2, 3, 20_000)).toBe('pending');
    expect(o(4, 5, 20_000)).toBe('pending');
    expect(o(0, 0, 90_000)).toBe('pending');
  });
  it('the clock running out ends the fight, unless the win is already in', () => {
    expect(o(3, 4, 0)).toBe('timeout');
    expect(o(5, 5, 0)).toBe('win');
  });
  it('a pre-reader with the timer off always wins after 6 answers, and never before', () => {
    expect(o(0, 6, null, true, false)).toBe('win');
    expect(o(2, 5, null, true, false)).toBe('pending');
    expect(o(0, 3, 0, true, false)).toBe('pending');
  });
  it('a pre-reader with the timer on needs 4 of 6 and can time out', () => {
    expect(o(4, 4, 30_000, true, true)).toBe('win');
    expect(o(3, 6, 30_000, true, true)).toBe('lose');
    expect(o(2, 3, 0, true, true)).toBe('timeout');
  });
});

describe('lair reward', () => {
  it('the first win pays 10 gems once, then every win pays 3', () => {
    let world = { bossesDefeated: [] as ('meadow' | 'forest' | 'castle')[] };
    expect(lairReward(world, 'meadow', true)).toEqual({ gems: BOSS_GEMS, first: true });
    world = { bossesDefeated: ['meadow'] };
    expect(lairReward(world, 'meadow', true)).toEqual({ gems: REPLAY_GEMS, first: false });
    expect(REPLAY_GEMS).toBe(3);
    expect(lairReward(world, 'forest', true)).toEqual({ gems: BOSS_GEMS, first: true });
  });
  it('a loss pays nothing, first or not', () => {
    expect(lairReward({ bossesDefeated: [] }, 'meadow', false)).toEqual({ gems: 0, first: false });
    expect(lairReward({ bossesDefeated: ['meadow'] }, 'meadow', false)).toEqual({ gems: 0, first: false });
  });
});

describe('lairStats', () => {
  const log = (region: string, bossWon: boolean, bossCorrect: number, bossMs: number, mode: 'lair' | 'overworld' = 'lair') => ({ mode, region, bossWon, bossCorrect, bossMs });
  it('counts wins of the region and reads the bests', () => {
    const logs = [log('castle', true, 5, 52_000), log('castle', true, 6, 41_000), log('castle', false, 4, 90_000), log('meadow', true, 6, 10_000), log('castle', true, 5, 60_000, 'overworld')];
    expect(lairStats(logs, 'castle')).toEqual({ beaten: 2, bestMs: 41_000, bestCorrect: 6 });
    expect(lairStats(logs, 'meadow')).toEqual({ beaten: 1, bestMs: 10_000, bestCorrect: 6 });
  });
  it('a region never fought reads as zero', () => {
    expect(lairStats([], 'forest')).toEqual({ beaten: 0, bestMs: null, bestCorrect: 0 });
    expect(lairStats([log('forest', false, 3, 30_000)], 'forest')).toEqual({ beaten: 0, bestMs: null, bestCorrect: 3 });
  });
});

describe('saved lair: resume and fresh', () => {
  beforeEach(() => localStorage.clear());
  const input = (stored: ReturnType<typeof loadLair>, now: number, retry = false) => ({
    region: 'forest' as const, cards: seenAll(READER), settings: READER, learner: 'reader' as const, now, rng: mulberry32(now % 997), stored, tripId: 'trip0000000000000001', retry,
  });

  it('save and load round-trip, and damaged or foreign data reads as none', () => {
    const { state } = enterLair(input(null, NOW));
    saveLair('kid1', state);
    expect(loadLair('kid1')).toEqual(state);
    expect(loadLair('kid2')).toBeNull();
    localStorage.setItem('mathquest:v1:lair:kid3', '{"region":"moon"}');
    expect(loadLair('kid3')).toBeNull();
    localStorage.setItem('mathquest:v1:lair:kid4', 'not json');
    expect(loadLair('kid4')).toBeNull();
  });
  it('a lair under 24 h old with its boss open resumes with the same plan and the answered slots', () => {
    const first = enterLair(input(null, NOW));
    expect(first.resumed).toBe(false);
    const saved = { ...first.state, done: ['r0i0', 'r0i1'] };
    saveLair('kid1', saved);
    const again = enterLair(input(loadLair('kid1'), NOW + 23 * 60 * 60 * 1000));
    expect(again.resumed).toBe(true);
    expect(again.state.plan).toEqual(first.state.plan);
    expect(again.state.done).toEqual(['r0i0', 'r0i1']);
    expect(again.state.seq).toBe(first.state.seq);
  });
  it('older than 24 h, another region or a resolved boss builds a fresh plan with the next seq', () => {
    const first = enterLair(input(null, NOW)).state;
    expect(canResumeLair(first, 'forest', NOW + 25 * 60 * 60 * 1000)).toBe(false);
    expect(canResumeLair(first, 'castle', NOW)).toBe(false);
    expect(canResumeLair({ ...first, bossDone: true }, 'forest', NOW)).toBe(false);
    const fresh = enterLair({ ...input(first, NOW + 25 * 60 * 60 * 1000) });
    expect(fresh.resumed).toBe(false);
    expect(fresh.state.seq).toBe(first.seq + 1);
    expect(fresh.state.done).toEqual([]);
  });
  it('a retry is a fresh 12-room plan even when the old one could resume', () => {
    const first = enterLair(input(null, NOW)).state;
    const retry = enterLair(input(first, NOW + 1000, true));
    expect(retry.resumed).toBe(false);
    expect(retry.state.plan.size).toBe(12);
    expect(roomIds(retry.state.plan)).toHaveLength(12);
    expect(retry.state.plan.boss).toHaveLength(LAIR_BOSS_QUESTIONS);
    expect(retry.state.seq).toBe(first.seq + 1);
  });
});

describe('entries, entities and clearing', () => {
  function built(region: (typeof REGION_IDS)[number], settings: KidSettings = READER) {
    const cards = seenAll(settings);
    const p = plan(region, settings, cards, 5);
    const runner = new SessionRunner([], cards, mulberry32(9), () => NOW, settings);
    const build = instantiateLair(runner, p, mulberry32(11));
    return { cards, p, runner, build };
  }

  it.each(REGION_IDS)('%s: every planned question becomes one entry and boss forms are practice entries', (region) => {
    const { p, runner, build } = built(region);
    expect(build.rooms).toHaveLength(24);
    expect(build.boss).toHaveLength(6);
    expect(new Set(Object.keys(build.slotOf)).size).toBe(30);
    for (const b of build.boss) {
      if (b.form) expect(b.entry).toMatchObject({ kind: 'practice', form: true });
      else expect(b.entry.kind).toBe('graded');
    }
    expect(p.boss.filter((b) => b.form)).toHaveLength(build.boss.filter((b) => b.form).length);
    expect(runner.queue.length).toBe(30);
    for (const e of build.rooms.filter((x) => x.role === 'trap')) expect(e.entry.riddle).toBe(true);
  });
  it.each(REGION_IDS)('%s: entities stand on free floor inside their own room, chests on chest tiles, one per tile', (region) => {
    const { build } = built(region);
    const def = LAIRS[region];
    const ents = planLairEntities({ def, build, seq: 4, rng: mulberry32(2) });
    expect(ents).toHaveLength(24);
    const seen = new Set<string>();
    for (const e of ents) {
      const k = `${e.x},${e.y}`;
      expect(seen.has(k), `${region} duplicate ${k}`).toBe(false);
      seen.add(k);
      const room = def.rooms[e.room!]!;
      expect(e.x >= room.x && e.x < room.x + room.w && e.y >= room.y && e.y < room.y + room.h, `${region} ${k} in room ${e.room}`).toBe(true);
      if (e.kind === 'chest') {
        expect(def.map.rows[e.y]![e.x]).toBe('C');
        expect(e.spotId).toBe(lairSpotId(region, 4, e));
      } else expect(def.map.rows[e.y]![e.x]).not.toBe('C');
    }
    expect(ents.filter((e) => e.guard)).toHaveLength(def.rooms.length - 1);
  });
  it('the guard stands nearest its room exit door and only the first room is shown at the start', () => {
    const { build } = built('castle');
    const ents = planLairEntities({ def: LAIRS.castle, build, seq: 1, rng: mulberry32(2) });
    expect(ents.filter((e) => e.shown).every((e) => e.room === 0)).toBe(true);
    expect(showRooms(ents, 1).filter((e) => e.shown).every((e) => e.room! <= 1)).toBe(true);
    const guard = ents.find((e) => e.guard && e.room === 0)!;
    const door = { x: 8, y: 13 };
    const dists = ents.filter((e) => e.room === 0 && e.kind === 'monster').map((e) => Math.abs(e.x - door.x) + Math.abs(e.y - door.y));
    expect(Math.abs(guard.x - door.x) + Math.abs(guard.y - door.y)).toBe(Math.min(...dists));
  });
  it('answered slots are left out of the entities on resume', () => {
    const { build } = built('meadow');
    const done = new Set(build.rooms.slice(0, 5).map((e) => e.slot));
    expect(planLairEntities({ def: LAIRS.meadow, build, seq: 1, rng: mulberry32(2), done })).toHaveLength(19);
  });
  it('a room is cleared when its monsters and guard are answered; chests and traps never hold a door', () => {
    const { p } = built('forest');
    const need = p.rooms.map((r) => r.items.flatMap((x, k) => (x.role === 'monster' || x.role === 'guard' ? [`r${r.room}i${k}`] : [])));
    const all = (rooms: number) => new Set(need.slice(0, rooms).flat());
    expect(roomsClearedOf(p, new Set())).toBe(0);
    expect(roomsClearedOf(p, all(1))).toBe(1);
    expect(roomsClearedOf(p, all(2))).toBe(2);
    expect(roomsClearedOf(p, all(3))).toBe(3);
    // A later room cleared while an earlier is not counts for nothing.
    expect(roomsClearedOf(p, new Set(need[1]))).toBe(0);
    const missingOne = all(1);
    missingOne.delete(need[0]![0]!);
    expect(roomsClearedOf(p, missingOne)).toBe(0);
    expect(lairProgress(p, new Set(['r0i0', 'r0i1']))).toEqual({ answered: 2, total: 30 });
  });
});
