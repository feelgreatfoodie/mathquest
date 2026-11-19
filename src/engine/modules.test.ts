import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { thresholdsFor } from './grading';
import { availableCards, cardLevel, groupProgress, unlockedGroups } from './mastery';
import { DEFAULT_SETTINGS, PRESETS, learnerOf, learnerParams, modulesOf, withModule, type CardMap, type KidSettings } from './models';
import { MODULES, cardLabel, getCardDef, getModule, moduleOfCard } from './modules';
import { ADD10 } from './modules/add10';
import { SUB10 } from './modules/sub10';
import { ICON_IDS, choicesFor, generateProblem, mulberry32, type Problem, type Token } from './problems';
import { newCardState, review } from './scheduler';
import { SessionRunner, planSession } from './session';

const T0 = new Date('2026-11-16T16:00:00').getTime();
const PRE: KidSettings = { ...PRESETS.prereader };

function reviewAll(ids: string[], grade: Rating.Good | Rating.Easy = Rating.Easy): CardMap {
  const cards: CardMap = {};
  for (const id of ids) cards[id] = review(newCardState(id, T0), grade, 2000, true, T0);
  return cards;
}

const numOf = (t: Token) => (t.t === 'num' ? t.v : NaN);
const g1 = () => ADD10.groups![0]!.cardIds;
const g2 = () => ADD10.groups![1]!.cardIds;

describe('registry', () => {
  it('looks every card up by id prefix', () => {
    expect(MODULES.map((m) => m.id)).toEqual(['add10', 'sub10', 'bonds10', 'missing10', 'doubles', 'add20', 'facts', 'multidigit', 'fractions']);
    expect(moduleOfCard('mul:7x8')?.id).toBe('facts');
    expect(moduleOfCard('md:2x1')?.id).toBe('multidigit');
    expect(moduleOfCard('fr:add')?.id).toBe('fractions');
    expect(moduleOfCard('add:2+3')?.id).toBe('add10');
    expect(moduleOfCard('sub:5-2')?.id).toBe('sub10');
    expect(moduleOfCard('nope:1')).toBeUndefined();
    expect(getModule('facts')?.cards).toHaveLength(91);
    expect(cardLabel('add:2+3')).toBe('2 + 3');
    expect(cardLabel('sub:5-2')).toBe('5 − 2');
    expect(cardLabel('mul:7x8')).toBe('7 × 8');
  });
});

describe('add10', () => {
  it('has 36 unique cards, a ≤ b and a + b ≤ 10, in two groups of 12 and 24', () => {
    expect(ADD10.cards).toHaveLength(36);
    expect(new Set(ADD10.cards.map((c) => c.id)).size).toBe(36);
    for (const c of ADD10.cards) {
      if (c.kind !== 'fact') throw new Error('fact expected');
      expect(c.a).toBeLessThanOrEqual(c.b);
      expect(c.a + c.b).toBeLessThanOrEqual(10);
      expect(c.id).toBe(`add:${c.a}+${c.b}`);
    }
    expect(g1()).toHaveLength(12);
    expect(g2()).toHaveLength(24);
    expect(g1().every((id) => ADD10.cards.some((c) => c.id === id && c.kind === 'fact' && c.a + c.b <= 5))).toBe(true);
  });

  it('orders G1 as +0 and +1, doubles, the rest; G2 ends with the pairs that make 10', () => {
    expect(g1().slice(0, 10).every((id) => /^add:[01]\+/.test(id))).toBe(true);
    expect(g1().slice(10)).toEqual(['add:2+2', 'add:2+3']);
    expect(g2().slice(-6).sort()).toEqual(['add:0+10', 'add:1+9', 'add:2+8', 'add:3+7', 'add:4+6', 'add:5+5']);
    expect(g2().slice(0, 4).every((id) => /^add:[12]\+/.test(id))).toBe(true);
  });

  it('generates answers that match the tokens, in both orders, with speech, pictures and choices', () => {
    const rng = mulberry32(5);
    const orders = new Set<string>();
    for (const c of ADD10.cards) {
      for (let i = 0; i < 20; i++) {
        const p = generateProblem(c.id, rng);
        const [a, op, b] = p.tokens;
        expect(op).toEqual({ t: 'op', v: '+' });
        const sum = numOf(a!) + numOf(b!);
        expect(p.answer).toEqual({ kind: 'int', value: sum });
        expect(p.choices).toContain(sum);
        expect(p.visual).toMatchObject({ kind: 'groups', op: '+', a: numOf(a!), b: numOf(b!) });
        expect(ICON_IDS).toContain(p.visual!.icon);
        expect(p.speech).toMatch(/ plus /);
        orders.add(`${c.id}:${numOf(a!)}`);
      }
    }
    expect(orders.size).toBeGreaterThan(36); // unequal pairs show up in both orders
  });

  it('speaks the miss hint the way the spec words it', () => {
    const rng = mulberry32(1);
    let p: Problem | undefined;
    for (let i = 0; i < 50 && !(p && numOf(p.tokens[0]!) === 3); i++) p = generateProblem('add:2+3', rng);
    expect(p!.speech).toBe('three plus two');
    expect(p!.hint).toBe("Let's count them all. One, two, three, four, five. Three plus two is five.");
  });

  it('has bars of 2 s and 6 s, which pace 3 turns into 6 s and 18 s', () => {
    const def = getCardDef('add:1+2')!;
    expect(thresholdsFor(def, 3500, 1)).toEqual({ fastMs: 2000, slowMs: 6000 });
    expect(thresholdsFor(def, 9999, 3)).toEqual({ fastMs: 6000, slowMs: 18000 });
  });
});

describe('sub10', () => {
  it('has 66 cards with 0 ≤ b ≤ a ≤ 10 and groups by the starting number', () => {
    expect(SUB10.cards).toHaveLength(66);
    expect(new Set(SUB10.cards.map((c) => c.id)).size).toBe(66);
    expect(SUB10.groups![0]!.cardIds).toHaveLength(21);
    expect(SUB10.groups![1]!.cardIds).toHaveLength(45);
  });

  it('generates answers that match the tokens', () => {
    const rng = mulberry32(8);
    for (const c of SUB10.cards) {
      const p = generateProblem(c.id, rng);
      const [a, op, b] = p.tokens;
      expect(op).toEqual({ t: 'op', v: '−' });
      expect(p.answer).toEqual({ kind: 'int', value: numOf(a!) - numOf(b!) });
      expect(p.choices).toContain(numOf(a!) - numOf(b!));
      expect(p.visual).toMatchObject({ op: '−', a: numOf(a!), b: numOf(b!) });
    }
  });

  it('is off in the pre-reader preset and in the default settings', () => {
    expect(modulesOf(PRESETS.prereader).sub10).toBe(false);
    expect(modulesOf(DEFAULT_SETTINGS).sub10).toBe(false);
  });
});

describe('choicesFor', () => {
  it('returns the answer plus 2 unique in-range neighbours, for every answer in 0..10', () => {
    for (let ans = 0; ans <= 10; ans++) {
      const c = choicesFor(ans, 10, mulberry32(ans + 1));
      expect(c).toHaveLength(3);
      expect(new Set(c).size).toBe(3);
      expect(c).toContain(ans);
      for (const v of c) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(10);
        expect(Math.abs(v - ans)).toBeLessThanOrEqual(2);
      }
    }
    expect([...choicesFor(0, 10, mulberry32(1))].sort((p, q) => p - q)).toEqual([0, 1, 2]);
    expect([...choicesFor(10, 10, mulberry32(1))].sort((p, q) => p - q)).toEqual([8, 9, 10]);
    expect([...choicesFor(5, 10, mulberry32(1))].sort((p, q) => p - q)).toEqual([4, 5, 6]);
  });

  it('is deterministic per seed and mixes the answer position across seeds', () => {
    expect(choicesFor(4, 10, mulberry32(77))).toEqual(choicesFor(4, 10, mulberry32(77)));
    const spots = new Set<number>();
    for (let s = 0; s < 60; s++) spots.add(choicesFor(4, 10, mulberry32(s)).indexOf(4));
    expect(spots.size).toBe(3);
  });
});

describe('settings migration', () => {
  it('derives modules from tracks when modules is missing', () => {
    const m = modulesOf({ tracks: { facts: true, multidigit: false, fractions: true } });
    expect(m).toMatchObject({ facts: true, multidigit: false, fractions: true, add10: false, sub10: false, add20: false });
  });

  it('lets modules win, and defaults new ids to off', () => {
    const m = modulesOf({ tracks: { facts: true, multidigit: true, fractions: true }, modules: { facts: false, add10: true } });
    expect(m).toMatchObject({ facts: false, multidigit: true, add10: true, sub10: false });
  });

  it('reads a missing learner as reader', () => {
    expect(learnerOf(DEFAULT_SETTINGS)).toBe('reader');
    expect(learnerOf(undefined)).toBe('reader');
    expect(learnerOf({ learner: 'prereader' })).toBe('prereader');
    expect(learnerOf({ learner: 'bogus' as never })).toBe('reader');
  });

  it('keeps writing tracks for old clients, and leaves an untouched reader doc alone', () => {
    const on = withModule(DEFAULT_SETTINGS, 'fractions', false);
    expect(on.tracks.fractions).toBe(false);
    expect(on.modules).toBeUndefined();
    const add = withModule(on, 'add10', true);
    expect(add.modules).toEqual({ add10: true });
    expect(add.tracks).toEqual(on.tracks);
    expect(modulesOf(add).add10).toBe(true);
  });

  it('has the spec presets', () => {
    expect(PRESETS.reader).toEqual(DEFAULT_SETTINGS);
    expect(PRESETS.prereader).toMatchObject({ learner: 'prereader', modules: { add10: true }, sessionSize: 10, maxNew: 4, paceMultiplier: 3 });
    expect(learnerParams('prereader')).toEqual({ retryGap: 2, blockSize: 3 });
    expect(learnerParams('reader')).toEqual({ retryGap: 3, blockSize: 5 });
  });
});

describe('unlocking', () => {
  // coverage-1: a pre-reader's gate is "80% seen, last two answers right", not stability. The cards below are
  // in review AND steady, so the test also still proves the 80% line.
  const steady = (cards: ReturnType<typeof reviewAll>) =>
    Object.fromEntries(Object.entries(cards).map(([id, c]) => [id, { ...c, lastResults: [true, true] }])) as ReturnType<typeof reviewAll>;
  it('opens G2 when 80% of G1 is seen with the last two answers right, not before', () => {
    expect(availableCards({}, PRE).map((c) => c.id)).toEqual(g1());
    const ten = steady(reviewAll(g1().slice(0, 10))); // 10 of 12 = 83%
    expect(groupProgress(ADD10, 0, ten)).toBeCloseTo(10 / 12);
    expect(unlockedGroups(ADD10, ten, PRE)).toBe(2);
    expect(availableCards(ten, PRE)).toHaveLength(36);
    const nine = steady(reviewAll(g1().slice(0, 9))); // 75%
    expect(unlockedGroups(ADD10, nine, PRE)).toBe(1);
    expect(availableCards(nine, PRE)).toHaveLength(12);
    // In review alone is no longer enough for a pre-reader.
    expect(unlockedGroups(ADD10, reviewAll(g1().slice(0, 10)), PRE)).toBe(1);
  });

  it('keeps facts and add10 side by side, add10 first', () => {
    const both = availableCards({}, { ...PRE, modules: { add10: true, facts: true } });
    expect(both.slice(0, 12).every((c) => c.id.startsWith('add:'))).toBe(true);
    expect(both.some((c) => c.id.startsWith('mul:'))).toBe(true);
  });
});

describe('a first pre-reader run', () => {
  it('has 10 questions, all sums of 5 or less', () => {
    const plan = planSession({ cards: {}, available: availableCards({}, PRE), now: T0, size: 10, maxNew: 4, rng: mulberry32(2) });
    expect(plan).toHaveLength(10);
    for (const p of plan) {
      const d = getCardDef(p.cardId)!;
      expect(d.kind === 'fact' && d.a + d.b <= 5, p.cardId).toBe(true);
    }
  });
});

describe('pre-reader session runner', () => {
  const right = (p: Problem) => ({ kind: 'int' as const, value: (p.answer as { value: number }).value });
  const wrong = (p: Problem) => ({ kind: 'int' as const, value: (p.answer as { value: number }).value + 1 });

  it('caps a correct first exposure at Good, even when fast', () => {
    const run = new SessionRunner([{ cardId: 'add:1+2', isNew: true }], {}, mulberry32(1), () => T0, PRE);
    expect(run.answer(right(run.current()!.problem), 300).rating).toBe(Rating.Good);
  });

  it('still gives Easy to a fast answer on a card seen before', () => {
    const cards = reviewAll(['add:1+2'], Rating.Good);
    const run = new SessionRunner([{ cardId: 'add:1+2', isNew: false }], cards, mulberry32(1), () => T0, PRE);
    expect(run.answer(right(run.current()!.problem), 300).rating).toBe(Rating.Easy);
  });

  it('caps a peek at Hard, and a wrong answer after a peek stays Again', () => {
    const cards = reviewAll(['add:1+2', 'add:1+3'], Rating.Good);
    const run = new SessionRunner([{ cardId: 'add:1+2', isNew: false }, { cardId: 'add:1+3', isNew: false }], cards, mulberry32(1), () => T0, PRE);
    expect(run.answer(right(run.current()!.problem), 300, { helped: true }).rating).toBe(Rating.Hard);
    run.advance();
    expect(run.answer(wrong(run.current()!.problem), 300, { helped: true }).rating).toBe(Rating.Again);
  });

  it('retries a miss after 2 questions for a pre-reader and after 3 for a reader', () => {
    const plan = ['add:0+1', 'add:0+2', 'add:0+3', 'add:0+4', 'add:0+5'].map((cardId) => ({ cardId, isNew: true }));
    const pre = new SessionRunner(plan, {}, mulberry32(1), () => T0, PRE);
    pre.answer(wrong(pre.current()!.problem), 1000);
    expect(pre.queue[3]!.kind).toBe('practice');
    const rdr = new SessionRunner(plan, {}, mulberry32(1), () => T0, { ...PRE, learner: 'reader' });
    rdr.answer(wrong(rdr.current()!.problem), 1000);
    expect(rdr.queue[4]!.kind).toBe('practice');
  });

  it('never shows the same icon on two questions in a row, retries included', () => {
    const plan = g1().map((cardId) => ({ cardId, isNew: true }));
    const run = new SessionRunner(plan, {}, mulberry32(3), () => T0, PRE);
    for (let i = 0; i < 6 && run.current(); i++) {
      run.answer(wrong(run.current()!.problem), 1000);
      run.advance();
    }
    const icons = run.queue.map((e) => e.problem.visual!.icon);
    for (let i = 1; i < icons.length; i++) expect(icons[i], `entry ${i}`).not.toBe(icons[i - 1]);
  });
});

describe('levels on pre-reader cards', () => {
  it('start at 0 and reach solid on repeated good reviews', () => {
    expect(cardLevel(undefined, 3500, 3)).toBe(0);
    let s = review(newCardState('add:1+2', T0), Rating.Easy, 1500, true, T0);
    let t = T0;
    for (let i = 0; i < 4; i++) {
      t = Math.max(t + 86_400_000, s.fsrs.due);
      s = review(s, Rating.Easy, 1500, true, t);
    }
    expect(cardLevel(s, 3500, 3)).toBeGreaterThanOrEqual(3);
  });
});
