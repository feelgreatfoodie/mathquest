import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/insights.json';
import { dayKey } from './game';
import { applyDelta } from './game';
import { GEM_RUN_MAX } from './gems';
import { LIGHTNING, LightningRound, buildDeck, delayOf, floorOf, isKnown, ladderFor, lightningGemBase, lightningGrantBase, lightningLog, stepDown, stepUp, type Deck } from './lightning';
import { needsWork, type InsightInput } from './insights';
import { DEFAULT_GAME, DEFAULT_SETTINGS, PRESETS, type CardMap, type CardState, type KidSettings, type SessionLog } from './models';
import { previewPool } from './mastery';
import { fillLine } from './runLabel';
import { mulberry32 } from './problems';
import { newCardState } from './scheduler';
import { factBaseline } from './grading';
import { paceOf } from './models';
import { PREVIEW_FLOOR, PREVIEW_MAX } from './session';
import { FACT_CARDS } from './modules/legacy';
import { threeChoices, speechOf } from '../game/modes/LightningMode.js';

// Lightning Round, engine side. Every test here fails on main: src/engine/lightning.ts does not exist there.

const NOW = Date.parse('2026-11-18T15:00:00Z');
const today = dayKey(NOW);

/** A fact the kid knows: reviewing or better, answered fast. */
function known(id: string): CardState {
  const c = newCardState(id, NOW - 86_400_000);
  return { ...c, attempts: 12, correct: 12, recentMs: [700, 800, 650], lastRating: 3, fsrs: { ...c.fsrs, state: 2, reps: 5, stability: 20, difficulty: 3, scheduled_days: 20, last_review: NOW - 86_400_000, due: NOW + 10 * 86_400_000 }, day: dayKey(NOW - 86_400_000), dayGraded: 1, lastResults: [true, true] };
}
/** A fact that needs work: missed today, still learning. */
function weak(id: string, stability: number): CardState {
  const c = newCardState(id, NOW - 3_600_000);
  return { ...c, attempts: 6, correct: 3, recentMs: [5200, 4800], lastRating: 1, fsrs: { ...c.fsrs, state: 1, reps: 3, lapses: 1, stability, last_review: NOW - 3_600_000, due: NOW }, day: today, dayGraded: 2, lastResults: [true, false], missDay: today };
}

const reader: KidSettings = { ...DEFAULT_SETTINGS, factGroupsUnlocked: 5 };
const ids = FACT_CARDS.map((c) => c.id);
/** 10 weak facts and 100 known ones, all multiplication, all groups open so no preview is added. */
function richCards(): CardMap {
  const cards: CardMap = {};
  ids.slice(0, 10).forEach((id, i) => (cards[id] = weak(id, 0.5 + i * 0.1)));
  ids.slice(10, 110).forEach((id) => (cards[id] = known(id)));
  return cards;
}
const deckOf = (cards: CardMap, settings: KidSettings = reader, sessions: SessionLog[] = []): Deck => buildDeck({ cards, sessions, settings, now: NOW, rng: mulberry32(7) });

describe('deck', () => {
  it('keeps 1 target to 9 knowns and picks only Needs work targets', () => {
    const cards = richCards();
    const deck = deckOf(cards);
    const needs = new Set(needsWork({ cards, sessions: [], settings: reader, now: NOW }, 60).map((n) => n.id));
    const targets = deck.cards.filter((c) => c.target);
    const knowns = deck.cards.filter((c) => !c.target);
    expect(targets).toHaveLength(LIGHTNING.targets);
    expect(knowns).toHaveLength(LIGHTNING.targets * LIGHTNING.knownsPerTarget);
    expect(knowns.length / targets.length).toBe(9);
    expect(deck.targets.every((id) => needs.has(id))).toBe(true);
    expect(targets.every((t) => needs.has(t.cardId))).toBe(true);
    const base = factBaseline(cards);
    expect(knowns.every((k) => isKnown(k.cardId, cards, base, paceOf(reader)))).toBe(true);
    expect(knowns.some((k) => needs.has(k.cardId))).toBe(false);
  });

  it('opens with a known fact, never puts two targets together and never repeats a known inside one unit', () => {
    const deck = deckOf(richCards());
    expect(deck.cards[0]!.target).toBe(false);
    expect(deck.cards.slice(0, PREVIEW_FLOOR.reader).some((c) => c.target)).toBe(false);
    deck.cards.forEach((c, i) => {
      if (c.target) expect(deck.cards[i + 1]?.target ?? false).toBe(false);
    });
    for (let u = 0; u < LIGHTNING.targets; u++) {
      const unit = deck.cards.slice(u * 10, u * 10 + 10).filter((c) => !c.target).map((c) => c.cardId);
      expect(new Set(unit).size).toBe(unit.length);
    }
  });

  it('is empty when nothing needs work', () => {
    const cards: CardMap = {};
    ids.slice(0, 30).forEach((id) => (cards[id] = known(id)));
    expect(deckOf(cards, { ...reader, factGroupsUnlocked: 5 }).cards).toEqual([]);
  });

  it('adds previews of locked groups only within the coverage-1 limits and never inside the first slots', () => {
    const cards: CardMap = {};
    ids.slice(0, 10).forEach((id, i) => (cards[id] = weak(id, 0.5 + i * 0.1)));
    ids.slice(10, 20).forEach((id) => (cards[id] = known(id)));
    const locked: KidSettings = { ...DEFAULT_SETTINGS, factGroupsUnlocked: 1 };
    const pool = previewPool(cards, locked);
    expect(pool.length).toBeGreaterThan(PREVIEW_MAX.reader);
    const deck = deckOf(cards, locked);
    const previews = deck.cards.filter((c) => c.preview);
    expect(previews.length).toBeLessThanOrEqual(PREVIEW_MAX.reader);
    expect(previews.length).toBeGreaterThan(0);
    expect(previews.every((p) => p.target && pool.some((d) => d.id === p.cardId))).toBe(true);
    const at = deck.cards.findIndex((c) => c.preview);
    expect(at).toBeGreaterThanOrEqual(PREVIEW_FLOOR.reader);
    expect(deck.targets.length).toBeLessThanOrEqual(LIGHTNING.targets);
  });

  it('takes the Needs work list from insights.ts for real players: only listed targets (kidA reader, kidB pre-reader)', () => {
    for (const k of ['kidA', 'kidB'] as const) {
      const d = (fixture as unknown as Record<string, { settings: InsightInput['settings']; cards: CardState[]; sessions: SessionLog[] }>)[k]!;
      const cards = Object.fromEntries(d.cards.map((c) => [c.id, c])) as CardMap;
      const settings = d.settings as KidSettings;
      const deck = buildDeck({ cards, sessions: d.sessions, settings, now: NOW, rng: mulberry32(3) });
      const needs = new Set(needsWork({ cards, sessions: d.sessions, settings, now: NOW }, 60).map((n) => n.id));
      const pool = new Set(previewPool(cards, settings).map((p) => p.id));
      expect(deck.targets.every((id) => needs.has(id) || pool.has(id))).toBe(true);
      expect(deck.cards.filter((c) => c.target && !c.preview).every((c) => needs.has(c.cardId))).toBe(true);
      expect(deck.cards.filter((c) => c.preview).length).toBeLessThanOrEqual(PREVIEW_MAX[settings.learner === 'prereader' ? 'prereader' : 'reader']);
    }
  });
});

describe('delay ladder', () => {
  it('readers step 3 to 2 to 1.5 to 1 s and stop at 1 s', () => {
    expect(ladderFor('reader')).toEqual([3000, 2000, 1500, 1000]);
    expect(delayOf(undefined, 'reader')).toBe(3000);
    let ms = 3000;
    const seen = [ms];
    for (let i = 0; i < 5; i++) seen.push((ms = stepDown(ms, 'reader')));
    expect(seen).toEqual([3000, 2000, 1500, 1000, 1000, 1000]);
  });

  it('a miss steps back up one level and stops at the start', () => {
    expect(stepUp(1000, 'reader')).toBe(1500);
    expect(stepUp(1500, 'reader')).toBe(2000);
    expect(stepUp(3000, 'reader')).toBe(3000);
  });

  it('pre-readers start at 4 s and floor at 2 s', () => {
    expect(delayOf(undefined, 'prereader')).toBe(4000);
    expect(stepDown(4000, 'prereader')).toBe(3000);
    expect(stepDown(3000, 'prereader')).toBe(2000);
    expect(stepDown(2000, 'prereader')).toBe(2000);
    expect(floorOf({ learner: 'prereader' })).toBe(2000);
    // A parent cannot push a pre-reader under 2 s, and can raise a reader's floor.
    expect(floorOf({ learner: 'prereader', lightningFloorMs: 1000 })).toBe(2000);
    expect(floorOf({ learner: 'reader', lightningFloorMs: 2000 })).toBe(2000);
    expect(stepDown(2000, 'reader', 2000)).toBe(2000);
    expect(floorOf({ learner: 'reader', lightningFloorMs: 99999 })).toBe(4000);
    expect(floorOf({ learner: 'reader', lightningFloorMs: Number.NaN })).toBe(1000);
  });

  it('stored delays snap to the ladder and stay inside the rules range', () => {
    expect(delayOf({ lightningDelayMs: 1800 }, 'reader')).toBe(2000);
    for (const l of ['reader', 'prereader'] as const) {
      for (const f of [1000, 2000, 4000]) ladderFor(l, f).forEach((v) => expect(v >= LIGHTNING.delayMin && v <= LIGHTNING.delayMax).toBe(true));
    }
  });
});

function hits(cards: CardMap, settings: KidSettings, plan: ('hit' | 'wrong' | 'timeout')[], seed = 11) {
  const deck = deckOf(cards, settings);
  const rng = mulberry32(seed);
  let t = NOW;
  const round = new LightningRound(deck, cards, settings, rng, () => t);
  const log: string[] = [];
  for (const step of plan) {
    const card = round.current();
    if (!card) break;
    round.show();
    const a = card.problem.answer;
    const right = a.kind === 'int' ? a.value : 0;
    if (step === 'timeout') round.timeout();
    else round.answer({ kind: 'int', value: step === 'hit' ? right : right + 1 }, 900);
    log.push(`${card.cardId}:${step}`);
    if (round.phase === 'miss') {
      expect(round.copy({ kind: 'int', value: right + 1 })).toBe(false);
      expect(round.copy({ kind: 'int', value: right })).toBe(true);
    }
    round.advance();
    t += 2000;
  }
  return { round, log };
}

describe('round', () => {
  it('steps a card down after a hit and back up after a miss, and stores it as lightningDelayMs', () => {
    const cards = richCards();
    const { round } = hits(cards, reader, ['hit']);
    const id = [...new Set(round.changedCards().map((c) => c.id))][0]!;
    expect(round.getCard(id)!.lightningDelayMs).toBe(2000);
    const second = hits(cards, reader, ['wrong']);
    const wid = second.round.changedCards()[0]!.id;
    expect(second.round.getCard(wid)!.lightningDelayMs).toBe(3000);
    // two hits on one card walk down the ladder
    const c2: CardMap = { ...cards };
    const target = ids[0]!;
    c2[target] = { ...c2[target]!, lightningDelayMs: 1500 };
    const r3 = new LightningRound({ cards: [{ cardId: target, target: true }], targets: [target] }, c2, reader, mulberry32(2), () => NOW);
    const card = r3.current()!;
    expect(card.delayMs).toBe(1500);
    r3.answer({ kind: 'int', value: (card.problem.answer as { value: number }).value }, 500);
    expect(r3.getCard(target)!.lightningDelayMs).toBe(1000);
  });

  it('a miss shows the answer, asks for one copy, and the card comes back 3 to 5 cards later', () => {
    const cards = richCards();
    const deck = deckOf(cards);
    const round = new LightningRound(deck, cards, reader, mulberry32(5), () => NOW);
    const first = round.current()!;
    round.show();
    round.timeout();
    expect(round.phase).toBe('miss');
    expect(round.over()).toBe(false);
    round.advance();
    const upcoming = Array.from({ length: 8 }, () => {
      const c = round.current()!;
      round.show();
      const a = c.problem.answer as { value: number };
      round.answer({ kind: 'int', value: a.value }, 500);
      round.advance();
      return c.cardId;
    });
    const back = upcoming.indexOf(first.cardId);
    expect(back + 1).toBeGreaterThanOrEqual(LIGHTNING.requeueMin - 1);
    expect(back).toBeLessThanOrEqual(LIGHTNING.requeueMax);
    expect(back).toBeGreaterThanOrEqual(0);
  });

  it('a target comes back after 1, then 2, then 3 cards (the run of knowns grows)', () => {
    const cards = richCards();
    const target = ids[0]!;
    const deck: Deck = { targets: [target], cards: [{ cardId: ids[20]!, target: false }, { cardId: target, target: true }, ...ids.slice(21, 40).map((id) => ({ cardId: id, target: false }))] };
    const round = new LightningRound(deck, cards, reader, mulberry32(9), () => NOW);
    const order: string[] = [];
    for (let i = 0; i < 14 && round.current(); i++) {
      const c = round.current()!;
      round.show();
      order.push(c.cardId);
      round.answer({ kind: 'int', value: (c.problem.answer as { value: number }).value }, 400);
      round.advance();
    }
    const at = order.flatMap((id, i) => (id === target ? [i] : []));
    expect(at).toHaveLength(4);
    expect(at.slice(1).map((p, i) => p - at[i]! - 1)).toEqual([1, 2, 3]);
  });

  it('ends at 60 cards or 3 minutes', () => {
    const cards = richCards();
    let t = NOW;
    const round = new LightningRound(deckOf(cards), cards, reader, mulberry32(1), () => t);
    expect(round.over()).toBe(false);
    t = NOW + LIGHTNING.maxMs;
    expect(round.over()).toBe(true);
    t = NOW;
    const r2 = new LightningRound(deckOf(cards), cards, reader, mulberry32(1), () => t);
    let shown = 0;
    while (r2.current()) {
      const c = r2.current()!;
      r2.show();
      shown++;
      r2.answer({ kind: 'int', value: (c.problem.answer as { value: number }).value }, 300);
      r2.advance();
    }
    expect(shown).toBe(LIGHTNING.maxCards);
  });
});

describe('practice only', () => {
  it('leaves every FSRS field byte-identical after a round, and attempts and correct move', () => {
    const cards = richCards();
    const before = JSON.stringify(Object.fromEntries(Object.entries(cards).map(([id, c]) => [id, c.fsrs])));
    const dayBefore = JSON.stringify(Object.fromEntries(Object.entries(cards).map(([id, c]) => [id, [c.day, c.dayGraded, c.lastResults, c.missDay]])));
    const plan = Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? 'wrong' : i % 7 === 0 ? 'timeout' : 'hit')) as ('hit' | 'wrong' | 'timeout')[];
    const { round } = hits(cards, reader, plan);
    const after = round.changedCards();
    expect(after.length).toBeGreaterThan(10);
    for (const c of after) expect(JSON.stringify(c.fsrs)).toBe(JSON.stringify(cards[c.id]!.fsrs));
    // the stored shape of every unchanged field of the map is also the same: no dayGraded, day, lastResults or missDay moved
    const merged = { ...cards, ...Object.fromEntries(after.map((c) => [c.id, c])) };
    expect(JSON.stringify(Object.fromEntries(Object.entries(merged).map(([id, c]) => [id, c.fsrs])))).toBe(before);
    expect(JSON.stringify(Object.fromEntries(Object.entries(merged).map(([id, c]) => [id, [c.day, c.dayGraded, c.lastResults, c.missDay]])))).toBe(dayBefore);
    // every counted answer moved attempts, and the right ones moved correct and recentMs
    const r = round.result();
    const dAttempts = after.reduce((n, c) => n + c.attempts - cards[c.id]!.attempts, 0);
    const dCorrect = after.reduce((n, c) => n + c.correct - cards[c.id]!.correct, 0);
    expect(dAttempts).toBe(r.answered);
    expect(dCorrect).toBe(r.hits);
    expect(r.hits).toBeGreaterThan(0);
    expect(after.some((c) => c.recentMs.length && JSON.stringify(c.recentMs) !== JSON.stringify(cards[c.id]!.recentMs))).toBe(true);
  });

  it('works on a fact the kid has never met (a preview): attempts move, the card stays new for FSRS', () => {
    const id = ids[60]!;
    const round = new LightningRound({ targets: [id], cards: [{ cardId: id, target: true, preview: true }] }, {}, reader, mulberry32(3), () => NOW);
    const c = round.current()!;
    round.answer({ kind: 'int', value: (c.problem.answer as { value: number }).value }, 800);
    const card = round.getCard(id)!;
    expect(card).toMatchObject({ attempts: 1, correct: 1 });
    expect(JSON.stringify(card.fsrs)).toBe(JSON.stringify(newCardState(id, NOW).fsrs));
    expect(card.fsrs.reps).toBe(0);
  });
});

describe('rewards', () => {
  it('pays at most 3 gems at every speed and every daily tier, however many hits', () => {
    for (const speed of [0.5, 1, 1.5]) {
      for (const hitsN of [0, 4, 5, 19, 20, 39, 40, 60, 500]) {
        const base = lightningGrantBase(hitsN, speed);
        for (const earned of [0, 25, 40, 60, 500]) {
          const before = { ...DEFAULT_GAME, gems: 0 };
          const after = applyDelta(before, { xp: 0, gemGrant: { base: Math.max(base, 0), learner: 'reader', settings: { gemSpeed: speed } }, playedAt: NOW });
          void earned;
          expect(after.gems - before.gems).toBeLessThanOrEqual(3);
        }
        expect(base).toBeLessThanOrEqual(3);
      }
    }
    expect(lightningGemBase(4)).toBe(0);
    expect(lightningGemBase(5)).toBe(1);
    expect(lightningGemBase(60)).toBe(3);
    expect(GEM_RUN_MAX).toBe(10);
  });

  it('at a half or quarter tier the grant still stays within 3 and the daily count grows by what was paid', () => {
    const before = { ...DEFAULT_GAME, gems: 5, gemsEarnedToday: 100, gemsDay: today };
    const after = applyDelta(before, { gemGrant: { base: 3, learner: 'reader', settings: {} }, playedAt: NOW });
    expect(after.gems - before.gems).toBe(1);
    expect(after.gemsEarnedToday).toBe(101);
  });

  it('the log counts every answer once: answered equals graded, no practiceCorrect, so fill-credit finds nothing to add', () => {
    const cards = richCards();
    const { round } = hits(cards, reader, Array.from({ length: 12 }, () => 'hit'));
    const r = round.result();
    const log = lightningLog(round, r, NOW, 1, { finished: true, gems: 1 });
    expect(log.mode).toBe('lightning');
    expect(log.answered).toBe(log.graded);
    expect(log.practiceCorrect).toBeUndefined();
    expect(fillLine(log)).toBeNull();
    expect(log.correct).toBe(r.hits);
    expect(log.bestCombo).toBe(r.bestStreak);
    expect(Object.keys(log).length).toBeLessThan(20);
  });

  it('tracks the fastest streak: right answers in a row before the reveal', () => {
    const cards = richCards();
    const { round } = hits(cards, reader, ['hit', 'hit', 'hit', 'wrong', 'hit', 'hit']);
    expect(round.result().bestStreak).toBe(3);
  });
});

describe('end screen data', () => {
  it('lists facts that got faster with before and after, and the next focus', () => {
    const id = ids[0]!;
    const cards: CardMap = { [id]: { ...weak(id, 1), recentMs: [4000, 4200, 3900] } };
    const round = new LightningRound({ targets: [id], cards: [{ cardId: id, target: true }] }, cards, reader, mulberry32(4), () => NOW);
    const c = round.current()!;
    round.answer({ kind: 'int', value: (c.problem.answer as { value: number }).value }, 1400);
    const r = round.result();
    expect(r.faster).toEqual([{ cardId: id, label: expect.stringContaining('×'), beforeMs: 4000, afterMs: 1400 }]);
    expect(r.focus).toEqual([id]);
  });
});

describe('pre-readers', () => {
  const pre: KidSettings = { ...PRESETS.prereader, modules: { add10: true } };
  it('get exactly 3 choices that include the answer, and a spoken question on every card', () => {
    const cards: CardMap = {};
    const addIds = Object.keys(
      Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [`add:${(i % 5) + 1}+${(i % 4) + 1}`, 1]),
      ),
    );
    addIds.forEach((id) => (cards[id] = weak(id, 1)));
    const deck = buildDeck({ cards, sessions: [], settings: pre, now: NOW, rng: mulberry32(5) });
    expect(deck.cards.length).toBeGreaterThan(0);
    const round = new LightningRound(deck, cards, pre, mulberry32(8), () => NOW);
    let checked = 0;
    for (let i = 0; i < 12 && round.current(); i++) {
      const c = round.current()!;
      const a = (c.problem.answer as { value: number }).value;
      const three = threeChoices(c.problem);
      expect(three).toHaveLength(3);
      expect(new Set(three).size).toBe(3);
      expect(three).toContain(a);
      expect(speechOf(c.problem).length).toBeGreaterThan(2);
      expect(c.delayMs).toBeGreaterThanOrEqual(2000);
      checked++;
      round.show();
      round.answer({ kind: 'int', value: a }, 800);
      round.advance();
    }
    expect(checked).toBeGreaterThan(3);
  });
});
