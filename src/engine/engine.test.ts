import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { ALL_CARDS, FACT_CARDS, FACT_GROUPS, SKILL_CARDS, factId, factStrategy, getCardDef } from './content';
import { add, equalValue, sub, toImproper, toMixed, type Mixed } from './fraction';
import { factBaseline, factThresholds, gradeAnswer, thresholdsFor } from './grading';
import { availableCards, cardLevel, groupProgress, unlockedFactGroups } from './mastery';
import { DEFAULT_SETTINGS, paceOf, type CardMap, type KidSettings } from './models';
import { checkAnswer, generateProblem, mulberry32, type Problem, type Token } from './problems';
import { isDue, newCardState, review } from './scheduler';
import { applyRun, buyHero, levelFor } from './game';
import { SessionRunner, planSession } from './session';
import { DEFAULT_GAME } from './models';

const DAY = 86_400_000;
const T0 = new Date('2026-11-16T16:00:00').getTime();

/** Recomputes a problem's answer from its tokens, independent of the generator. */
function evalTokens(tokens: Token[]): { n: number; d: number } {
  const val = (t: Token) =>
    t.t === 'num' ? { n: t.v, d: 1 } : t.t === 'frac' ? toImproper({ w: t.w ?? 0, n: t.n, d: t.d }) : null;
  const [a, op, b] = tokens;
  const x = val(a!)!;
  const y = val(b!)!;
  if (op!.t !== 'op') throw new Error('bad tokens');
  if (op!.v === '+') return add(x, y);
  if (op!.v === '−') return sub(x, y);
  return { n: x.n * y.n, d: x.d * y.d };
}

function expected(p: Problem): { n: number; d: number } {
  return p.answer.kind === 'int' ? { n: p.answer.value, d: 1 } : toImproper(p.answer.value);
}

describe('fractions', () => {
  it('adds, subtracts and regroups', () => {
    expect(add({ n: 3, d: 8 }, { n: 7, d: 8 })).toEqual({ n: 10, d: 8 });
    expect(toMixed({ n: 19, d: 8 })).toEqual({ w: 2, n: 3, d: 8 });
    expect(sub(toImproper({ w: 3, n: 1, d: 6 }), toImproper({ w: 1, n: 5, d: 6 }))).toEqual({ n: 8, d: 6 });
    expect(equalValue({ n: 2, d: 4 }, { n: 1, d: 2 })).toBe(true);
  });
});

describe('content', () => {
  it('has 91 unique fact cards covering 0–12', () => {
    expect(FACT_CARDS).toHaveLength(91);
    expect(new Set(FACT_CARDS.map((c) => c.id)).size).toBe(91);
    expect(factId(8, 7)).toBe('mul:7x8');
  });

  it('every strategy tip states the right product', () => {
    for (const c of FACT_CARDS) {
      const tip = factStrategy(c.a, c.b);
      if (c.a === 0) continue;
      expect(tip, `${c.a}×${c.b}: ${tip}`).toContain(String(c.a * c.b));
    }
  });

  it('skill prerequisites point at real cards or fact groups', () => {
    const ids = new Set(ALL_CARDS.map((c) => c.id));
    for (const s of SKILL_CARDS)
      for (const p of s.prereqs) expect(ids.has(p) || FACT_GROUPS.some((g) => `facts:${g.id}` === p), p).toBe(true);
  });
});

describe('problem generators', () => {
  const rng = mulberry32(42);
  for (const def of ALL_CARDS.filter((c) => c.kind === 'skill' || c.id === 'mul:7x8')) {
    it(`${def.id}: answers are right and stay in range`, () => {
      for (let i = 0; i < 400; i++) {
        const p = generateProblem(def.id, rng);
        const truth = evalTokens(p.tokens);
        expect(equalValue(truth, expected(p)), JSON.stringify(p)).toBe(true);
        expect(truth.n).toBeGreaterThan(0);
        const ans = p.answer;
        if (ans.kind === 'mixed') expect(ans.value.n).toBeLessThan(ans.value.d);

        const [a, , b] = p.tokens;
        if (def.id === 'md:2x1') {
          const x = (a as { v: number }).v;
          const y = (b as { v: number }).v;
          expect((x % 10) * y).toBeLessThan(10);
          expect(Math.floor(x / 10) * y).toBeLessThan(10);
        }
        if (def.id === 'fr:add') expect(truth.n).toBeLessThanOrEqual(truth.d);
        if (def.id === 'fr:mulw') expect(truth.n).toBeLessThan(truth.d);
        if (def.id === 'fr:mulwm') {
          expect(truth.n).toBeGreaterThan(truth.d);
          expect(truth.n % truth.d).not.toBe(0);
        }
        if (def.id === 'fr:maddr') {
          const fa = a as { n: number; d: number };
          const fb = b as { n: number };
          expect(fa.n + fb.n).toBeGreaterThan(fa.d);
        }
        if (def.id === 'fr:msubr') expect((a as { n: number }).n).toBeLessThan((b as { n: number }).n);
      }
    });
  }
});

describe('answer checking', () => {
  const mixed = (w: number | null, n: number | null, d: number | null) => ({ kind: 'mixed' as const, value: { w, n, d } });
  const regroup: Problem = {
    cardId: 'fr:maddr',
    tokens: [],
    answer: { kind: 'mixed', value: { w: 4, n: 2, d: 8 }, requireProper: true },
    hint: '',
  };

  it('accepts equivalent proper forms', () => {
    expect(checkAnswer(regroup, mixed(4, 2, 8))).toBe('correct');
    expect(checkAnswer(regroup, mixed(4, 1, 4))).toBe('correct');
  });

  it('flags right amount in improper form as almost', () => {
    expect(checkAnswer(regroup, mixed(3, 10, 8))).toBe('almost');
  });

  it('rejects wrong values and missing bottoms', () => {
    expect(checkAnswer(regroup, mixed(3, 10, 16))).toBe('wrong');
    expect(checkAnswer(regroup, mixed(4, 2, null))).toBe('wrong');
  });

  it('accepts a bare whole number for a whole answer', () => {
    const whole: Problem = { ...regroup, answer: { kind: 'mixed', value: { w: 4, n: 0, d: 8 }, requireProper: true } };
    expect(checkAnswer(whole, mixed(4, null, null))).toBe('correct');
    expect(checkAnswer(whole, mixed(3, 8, 8))).toBe('almost');
  });

  it('checks integer answers', () => {
    const p = generateProblem('mul:7x8', mulberry32(1));
    expect(checkAnswer(p, { kind: 'int', value: 56 })).toBe('correct');
    expect(checkAnswer(p, { kind: 'int', value: 54 })).toBe('wrong');
  });
});

describe('grading', () => {
  it('maps accuracy and speed to FSRS grades', () => {
    const th = factThresholds(3500, 1);
    expect(th.fastMs).toBe(3000);
    expect(gradeAnswer('wrong', 1000, th)).toBe(Rating.Again);
    expect(gradeAnswer('almost', 1000, th)).toBe(Rating.Hard);
    expect(gradeAnswer('correct', 2000, th)).toBe(Rating.Easy);
    expect(gradeAnswer('correct', 5000, th)).toBe(Rating.Good);
    expect(gradeAnswer('correct', 20000, th)).toBe(Rating.Hard);
  });

  it('tightens the fast bar as the kid gets faster', () => {
    const cards: CardMap = {};
    FACT_CARDS.slice(0, 10).forEach((c) => (cards[c.id] = { ...newCardState(c.id, T0), recentMs: [1800, 1900] }));
    const base = factBaseline(cards);
    expect(base).toBeLessThan(2000);
    expect(factThresholds(base, 1).fastMs).toBeLessThan(2000);
  });
});

describe('pace multiplier', () => {
  const fact = getCardDef('mul:7x8')!;
  const skill = getCardDef('md:2x1')!;

  it('scales fact bars and their clamp bounds by pace', () => {
    expect(thresholdsFor(fact, 3500, 1)).toEqual({ fastMs: 3000, slowMs: 8750 });
    expect(thresholdsFor(fact, 3500, 3)).toEqual({ fastMs: 9000, slowMs: 26250 });
    // A fast kid hits the lower clamp: 1500 ms and 5000 ms, times pace.
    expect(thresholdsFor(fact, 1000, 3)).toEqual({ fastMs: 4500, slowMs: 15000 });
    // A very slow kid hits the upper clamp: 3000 ms and 9000 ms, times pace.
    expect(thresholdsFor(fact, 9000, 3)).toEqual({ fastMs: 9000, slowMs: 27000 });
    expect(thresholdsFor(fact, 3500, 1.5)).toEqual({ fastMs: 4500, slowMs: 13125 });
  });

  it('scales skill bars by pace', () => {
    expect(thresholdsFor(skill, 3500, 1)).toEqual({ fastMs: 14000, slowMs: 40000 });
    expect(thresholdsFor(skill, 3500, 3)).toEqual({ fastMs: 42000, slowMs: 120000 });
  });

  it('grades a 6 s fact answer Easy at pace 3 and Good at pace 1', () => {
    expect(gradeAnswer('correct', 6000, thresholdsFor(fact, 3500, 3))).toBe(Rating.Easy);
    expect(gradeAnswer('correct', 6000, thresholdsFor(fact, 3500, 1))).toBe(Rating.Good);
  });

  it('reads a missing or invalid paceMultiplier as 3', () => {
    expect(paceOf(undefined)).toBe(3);
    expect(paceOf({})).toBe(3);
    expect(paceOf({ paceMultiplier: 0 })).toBe(3);
    expect(paceOf({ paceMultiplier: Number.NaN })).toBe(3);
    expect(paceOf({ paceMultiplier: 1 })).toBe(1);
    expect(paceOf({ paceMultiplier: 1.5 })).toBe(1.5);
    expect(DEFAULT_SETTINGS.paceMultiplier).toBe(3);
  });

  it('uses the same bar for the session grade, the summary count and the mastery level', () => {
    const answer = (settings: Partial<KidSettings>) => {
      const run = new SessionRunner([{ cardId: 'mul:7x8', isNew: false }], {}, mulberry32(3), () => T0, settings as KidSettings);
      return run.answer({ kind: 'int', value: 56 }, 6000);
    };
    expect(answer({ paceMultiplier: 3 }).rating).toBe(Rating.Easy);
    expect(answer({ paceMultiplier: 1 }).rating).toBe(Rating.Good);
    expect(answer({}).rating).toBe(Rating.Easy); // missing field behaves as 3

    // A card solid at a 6 s median is fluent at pace 3 and not at pace 1.
    let s = review(newCardState('mul:6x7', T0), Rating.Again, 9000, false, T0);
    let t = T0;
    for (let i = 0; i < 4; i++) {
      t = Math.max(t + DAY, s.fsrs.due);
      s = { ...review(s, Rating.Easy, 6000, true, t), recentMs: [6000, 6000, 6000] };
    }
    expect(cardLevel(s, 3500, 3)).toBe(4);
    expect(cardLevel(s, 3500, 1)).toBe(3);
  });
});

describe('scheduler', () => {
  it('spaces Easy further out than Hard and marks cards due later', () => {
    const s = newCardState('mul:3x4', T0);
    const easy = review(s, Rating.Easy, 1500, true, T0);
    const hard = review(s, Rating.Hard, 9000, true, T0);
    expect(easy.fsrs.due).toBeGreaterThan(hard.fsrs.due);
    expect(isDue(easy, T0 + DAY / 2)).toBe(false);
    expect(isDue(easy, T0 + 120 * DAY)).toBe(true);
    expect(easy.recentMs).toEqual([1500]);
  });
});

function reviewAll(ids: string[], grade: Rating.Good | Rating.Easy, at = T0): CardMap {
  const cards: CardMap = {};
  for (const id of ids) cards[id] = review(newCardState(id, at), grade, 2000, true, at);
  return cards;
}

describe('mastery and unlocking', () => {
  it('starts with group 1 and unlocks group 2 when group 1 is in review', () => {
    expect(unlockedFactGroups({}, DEFAULT_SETTINGS)).toBe(1);
    const g1 = FACT_CARDS.filter((c) => c.groupIndex === 0).map((c) => c.id);
    const cards = reviewAll(g1, Rating.Easy);
    expect(groupProgress(0, cards)).toBe(1);
    expect(unlockedFactGroups(cards, DEFAULT_SETTINGS)).toBe(2);
  });

  it('respects the parent unlock setting and disabled tracks', () => {
    const s: KidSettings = { ...DEFAULT_SETTINGS, factGroupsUnlocked: 4, tracks: { facts: true, multidigit: false, fractions: true } };
    const avail = availableCards({}, s);
    expect(avail.some((c) => c.id === 'mul:7x8')).toBe(true);
    expect(avail.some((c) => c.track === 'multidigit')).toBe(false);
    expect(avail.some((c) => c.id === 'fr:add')).toBe(true);
    expect(avail.some((c) => c.id === 'fr:msubr')).toBe(false);
  });

  it('does not call a card fluent after one lucky answer', () => {
    const once = review(newCardState('mul:6x7', T0), Rating.Easy, 1200, true, T0);
    expect(cardLevel(once, 3000, 1)).toBe(2);
  });

  it('levels a card from new to solid', () => {
    expect(cardLevel(undefined, 3000, 1)).toBe(0);
    let s = review(newCardState('mul:2x3', T0), Rating.Again, 9000, false, T0);
    expect(cardLevel(s, 3000, 1)).toBe(1);
    let t = T0;
    for (let i = 0; i < 4; i++) {
      t = Math.max(t + DAY, s.fsrs.due);
      s = review(s, Rating.Easy, 1500, true, t);
    }
    expect(cardLevel(s, 3000, 1)).toBeGreaterThanOrEqual(3);
  });
});

describe('session planning', () => {
  it('fills a first run with placement probes plus one new skill', () => {
    const plan = planSession({ cards: {}, available: availableCards({}, DEFAULT_SETTINGS), now: T0, size: 30, maxNew: 8, rng: mulberry32(7) });
    expect(plan).toHaveLength(30);
    expect(plan.every((p) => p.isNew)).toBe(true);
    expect(plan.filter((p) => p.cardId.startsWith('fr:'))).toHaveLength(1);
  });

  it('puts due reviews first and limits new cards when reviews exist', () => {
    const g1 = FACT_CARDS.filter((c) => c.groupIndex === 0).map((c) => c.id);
    const cards = reviewAll(g1.slice(0, 40), Rating.Good);
    const later = T0 + 30 * DAY;
    const avail = availableCards(cards, DEFAULT_SETTINGS);
    const plan = planSession({ cards, available: avail, now: later, size: 30, maxNew: 8, rng: mulberry32(3) });
    expect(plan).toHaveLength(30);
    expect(plan.filter((p) => !p.isNew).every((p) => isDue(cards[p.cardId]!, later))).toBe(true);
    expect(plan.filter((p) => p.isNew)).toHaveLength(0);
  });
});

describe('session runner', () => {
  it('retries misses, teaches new skills, and reports a summary', () => {
    const plan = [
      { cardId: 'mul:7x8', isNew: false },
      { cardId: 'fr:add', isNew: true },
      { cardId: 'mul:2x3', isNew: false },
    ];
    let clock = T0;
    const run = new SessionRunner(plan, {}, mulberry32(9), () => clock);
    expect(run.queue.map((e) => e.kind)).toEqual(['graded', 'teach', 'graded', 'graded']);

    // Miss 7×8: a practice retry should be queued.
    run.answer({ kind: 'int', value: 54 }, 4000);
    expect(run.queue.filter((e) => e.cardId === 'mul:7x8')).toHaveLength(2);
    run.advance();

    run.acknowledge(); // teach card
    const fr = run.current()!;
    const a = fr.problem.answer as { kind: 'mixed'; value: Mixed };
    const fb = run.answer({ kind: 'mixed', value: { w: a.value.w || null, n: a.value.n || null, d: a.value.n ? a.value.d : null } }, 3000);
    expect(fb.verdict).toBe('correct');
    expect(fb.rating).toBe(Rating.Good); // capped: just demonstrated
    run.advance();

    while (!run.done()) {
      const e = run.current()!;
      clock += 5000;
      const ans = e.problem.answer;
      if (ans.kind === 'int') run.answer({ kind: 'int', value: ans.value }, 1500);
      else run.answer({ kind: 'mixed', value: { w: ans.value.w || null, n: ans.value.n || null, d: ans.value.n ? ans.value.d : null } }, 3000);
      run.advance();
    }
    const sum = run.summary();
    expect(sum.graded).toBe(3);
    expect(sum.correct).toBe(2);
    expect(sum.missed).toEqual(['mul:7x8']);
    expect(sum.newLearned).toBe(1);
    expect(run.changedCards().map((c) => c.id).sort()).toEqual(['fr:add', 'mul:2x3', 'mul:7x8']);
  });
});

describe('game', () => {
  it('tracks streaks, levels, and hero purchases', () => {
    const run = { answered: 30, graded: 30, correct: 25, fast: 10, newLearned: 2, medianMs: 2000, xp: 300, gems: 5, bestCombo: 12, missed: [], faster: [] };
    const day1 = applyRun(DEFAULT_GAME, run, T0);
    const day2 = applyRun(day1, run, T0 + DAY);
    const sameDay = applyRun(day2, run, T0 + DAY + 1000);
    const gap = applyRun(sameDay, run, T0 + 4 * DAY);
    expect([day1.streakDays, day2.streakDays, sameDay.streakDays, gap.streakDays]).toEqual([1, 2, 2, 1]);
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(400).level).toBe(3);
    expect(buyHero({ ...DEFAULT_GAME, gems: 10 }, 'wizard')).toBeNull();
    expect(buyHero({ ...DEFAULT_GAME, gems: 20 }, 'wizard')?.gems).toBe(5);
  });
});
