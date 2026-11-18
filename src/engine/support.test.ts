import { Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { cardLevel } from './mastery';
import { PRESETS, type CardMap, type CardState, type KidSettings } from './models';
import { addCards, subCards } from './modules/early';
import { CHOICE_MAX, closeChoices, generateProblem, mulberry32, type Problem } from './problems';
import { newCardState, review } from './scheduler';
import { SessionRunner } from './session';
import { HOLD_AFTER_PAD_MISS, fadeStep, strategyCue, supportOf } from './support';

const T0 = new Date('2026-11-16T16:00:00').getTime();
const PRE: KidSettings = { ...PRESETS.prereader };
const right = (p: Problem) => ({ kind: 'int' as const, value: (p.answer as { value: number }).value });
const wrong = (p: Problem) => ({ kind: 'int' as const, value: (p.answer as { value: number }).value + 1 });
const ok = { correct: true, helped: false, solid: false };

/** A card FSRS calls Solid: reviewing, stable for a month, 5 reviews. */
function solidCard(id: string, over: Partial<CardState> = {}): CardState {
  const c = review(newCardState(id, T0 - 40 * 86_400_000), Rating.Good, 2000, true, T0 - 40 * 86_400_000);
  return { ...c, fsrs: { ...c.fsrs, state: State.Review, stability: 30, reps: 5, due: T0 + 86_400_000, last_review: T0 - 86_400_000 }, recentMs: [2000, 2000, 2000], lastRating: Rating.Good, ...over };
}

describe('supportOf', () => {
  it('reads a missing card, a missing field and a junk value as dots', () => {
    expect(supportOf(undefined)).toBe('dots');
    expect(supportOf({})).toBe('dots');
    expect(supportOf({ supportLevel: 'bogus' as never })).toBe('dots');
    expect(supportOf({ supportLevel: 'pad' })).toBe('pad');
  });
});

describe('the fade ladder', () => {
  it('moves dots to numerals after 2 right answers in a row, and a miss in between starts the count over', () => {
    let c = fadeStep(undefined, ok);
    expect(c).toMatchObject({ supportLevel: 'dots', supportRun: 1 });
    c = fadeStep(c, { ...ok, correct: false });
    expect(c).toMatchObject({ supportLevel: 'dots', supportRun: 0 });
    c = fadeStep(c, ok);
    c = fadeStep(c, ok);
    expect(c).toMatchObject({ supportLevel: 'numerals', supportRun: 0 });
  });

  it('moves numerals to the pad only when the fact is Solid', () => {
    const num = { supportLevel: 'numerals' as const, supportRun: 0, supportHold: 0 };
    expect(fadeStep(num, ok).supportLevel).toBe('numerals');
    expect(fadeStep(num, { ...ok, solid: true }).supportLevel).toBe('pad');
  });

  it('drops a miss on numerals to dots, and a miss on the pad to numerals with 2 right answers owed', () => {
    expect(fadeStep({ supportLevel: 'numerals' }, { ...ok, correct: false })).toMatchObject({ supportLevel: 'dots', supportRun: 0 });
    let c = fadeStep({ supportLevel: 'pad' }, { ...ok, correct: false });
    expect(c).toMatchObject({ supportLevel: 'numerals', supportHold: HOLD_AFTER_PAD_MISS });
    c = fadeStep(c, { ...ok, solid: true });
    expect(c.supportLevel).toBe('numerals');
    c = fadeStep(c, { ...ok, solid: true });
    expect(c.supportLevel).toBe('numerals');
    expect(fadeStep(c, { ...ok, solid: true }).supportLevel).toBe('pad');
  });

  it('never moves up on help, and sends the fact back to dots', () => {
    for (const level of ['dots', 'numerals', 'pad'] as const) {
      const c = fadeStep({ supportLevel: level, supportRun: 1 }, { correct: true, helped: true, solid: true });
      expect(c).toEqual({ supportLevel: 'dots', supportRun: 0, supportHold: 0 });
    }
  });

  it('leaves a preview alone', () => {
    const from = { supportLevel: 'numerals' as const, supportRun: 1, supportHold: 0 };
    expect(fadeStep(from, { ...ok, correct: false, preview: true })).toEqual(from);
  });
});

describe('the fade in a run', () => {
  const run = (cards: CardMap, id: string) => new SessionRunner([{ cardId: id, isNew: false }], cards, mulberry32(3), () => T0, PRE);

  it('writes the fade fields onto the saved card, and a new card starts on dots', () => {
    const r = new SessionRunner([{ cardId: 'add:2+3', isNew: true }], {}, mulberry32(3), () => T0, PRE);
    expect(r.supportLevelOf('add:2+3')).toBe('dots');
    r.answer(right(r.current()!.problem), 2000);
    expect(r.getCard('add:2+3')).toMatchObject({ supportLevel: 'dots', supportRun: 1 });
  });

  it('rates a right answer with help Hard, and the fact shows dots again', () => {
    const cards: CardMap = { 'add:2+3': { ...solidCard('add:2+3'), supportLevel: 'numerals', supportRun: 1 } };
    const r = run(cards, 'add:2+3');
    expect(r.answer(right(r.current()!.problem), 300, { helped: true }).rating).toBe(Rating.Hard);
    expect(r.getCard('add:2+3')).toMatchObject({ supportLevel: 'dots', supportRun: 0 });
  });

  it('moves a Solid numerals fact to the pad on an unaided right answer', () => {
    const cards: CardMap = { 'add:2+3': { ...solidCard('add:2+3'), supportLevel: 'numerals' } };
    expect(cardLevel(cards['add:2+3'], 3500, 3)).toBeGreaterThanOrEqual(3);
    const r = run(cards, 'add:2+3');
    r.answer(right(r.current()!.problem), 2000);
    expect(r.getCard('add:2+3')?.supportLevel).toBe('pad');
  });

  it('grades a pad answer as a number: right is right, wrong is Again, and a miss drops the fact to numerals', () => {
    const cards: CardMap = { 'add:2+3': { ...solidCard('add:2+3'), supportLevel: 'pad' } };
    const r = run(cards, 'add:2+3');
    expect(r.answer(wrong(r.current()!.problem), 2000).rating).toBe(Rating.Again);
    expect(r.getCard('add:2+3')).toMatchObject({ supportLevel: 'numerals', supportHold: HOLD_AFTER_PAD_MISS });
    const r2 = run(cards, 'add:2+3');
    expect(r2.answer(right(r2.current()!.problem), 2000).verdict).toBe('correct');
    expect(r2.getCard('add:2+3')?.supportLevel).toBe('pad');
  });

  it('counts an in-run retry as a step, so a miss on numerals comes back on dots', () => {
    const cards: CardMap = { 'sub:5-2': { ...solidCard('sub:5-2'), supportLevel: 'numerals' } };
    const r = new SessionRunner([{ cardId: 'sub:5-2', isNew: false }], cards, mulberry32(3), () => T0, PRE);
    r.answer(wrong(r.current()!.problem), 2000);
    r.advance();
    expect(r.current()!.kind).toBe('practice');
    expect(r.supportLevelOf('sub:5-2')).toBe('dots');
  });

  it('marks facts answered right, without help, under 3 seconds', () => {
    const r = new SessionRunner([{ cardId: 'add:1+2', isNew: true }, { cardId: 'add:1+3', isNew: true }], {}, mulberry32(3), () => T0, PRE);
    r.answer(right(r.current()!.problem), 2900);
    r.advance();
    r.answer(right(r.current()!.problem), 2900, { helped: true });
    expect(r.quickFacts()).toEqual(['add:1+2']);
  });

  it('leaves summary() in its old shape', () => {
    const r = new SessionRunner([{ cardId: 'add:1+2', isNew: true }], {}, mulberry32(3), () => T0, PRE);
    r.answer(right(r.current()!.problem), 1000);
    expect(Object.keys(r.summary()).sort()).toEqual(['answered', 'bestCombo', 'correct', 'fast', 'faster', 'gems', 'graded', 'medianMs', 'missed', 'newLearned', 'xp']);
  });
});

describe('closeChoices', () => {
  const all = [...addCards, ...subCards];

  it('gives 4 distinct choices in 0 to 20, with the answer, for every pre-reader fact and many seeds', () => {
    for (const def of all) {
      for (let seed = 1; seed <= 12; seed++) {
        const p = generateProblem(def.id, mulberry32(seed * 101 + def.a));
        const ans = (p.answer as { value: number }).value;
        expect(p.choices, def.id).toHaveLength(4);
        expect(new Set(p.choices).size, def.id).toBe(4);
        expect(p.choices).toContain(ans);
        for (const c of p.choices!) {
          expect(Number.isInteger(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(CHOICE_MAX);
        }
      }
    }
  });

  it('keeps every distractor close: within 2 of the answer, or the one common error (answer 0 has only 2 neighbours, so it may reach 3)', () => {
    for (const def of all) {
      const p = generateProblem(def.id, mulberry32(7));
      const ans = (p.answer as { value: number }).value;
      const common = def.track === 'add10' ? Math.max(def.a, def.b) : def.a + def.b;
      for (const c of p.choices!) if (c !== ans) expect(Math.abs(c - ans) <= (ans === 0 ? 3 : 2) || c === common, `${def.id} ${c}`).toBe(true);
    }
  });

  it('includes the common error: the bigger addend for an addition, the sum for a subtraction', () => {
    expect(closeChoices(7, CHOICE_MAX, mulberry32(1), 4)).toContain(4);
    const sub = generateProblem('sub:6-2', mulberry32(1));
    expect(sub.choices).toContain(8);
    const add = generateProblem('add:2+5', mulberry32(1));
    expect(add.choices).toContain(5);
  });

  it('copes with the edges: answer 0, answer 20, and a common error that equals the answer', () => {
    expect([...closeChoices(0, CHOICE_MAX, mulberry32(1), 0)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    const top = closeChoices(20, CHOICE_MAX, mulberry32(1), 12);
    expect(new Set(top).size).toBe(4);
    expect(Math.max(...top)).toBe(20);
  });

  it('puts the right answer in every one of the 4 positions, none under 15% of the time', () => {
    const slots = [0, 0, 0, 0];
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const p = generateProblem('add:3+4', mulberry32(i + 1));
      slots[p.choices!.indexOf(7)]!++;
    }
    for (const s of slots) expect(s / n).toBeGreaterThan(0.15);
  });

  it('is the same for the same seed', () => {
    expect(closeChoices(5, CHOICE_MAX, mulberry32(9), 3)).toEqual(closeChoices(5, CHOICE_MAX, mulberry32(9), 3));
  });
});

describe('strategyCue', () => {
  const cue = (id: string) => strategyCue(generateProblem(id, mulberry32(1)));

  it('says "4 + 4, double!" for a double', () => {
    expect(cue('add:4+4')).toMatchObject({ kind: 'double', text: '4 + 4, double!' });
  });
  it('fills the ten-frame for sums of 9 and 10', () => {
    expect(cue('add:3+7')?.kind).toBe('make10');
    expect(cue('add:4+5')?.kind).toBe('make10');
  });
  it('counts on from the bigger number when the smaller is 1 to 3', () => {
    expect(cue('add:2+6')).toMatchObject({ kind: 'counton', big: 6, small: 2 });
  });
  it('has none for 0, for small sums and for subtraction', () => {
    expect(cue('add:0+4')).toBeNull();
    expect(cue('add:1+2')).toBeNull();
    expect(cue('sub:7-2')).toBeNull();
  });
});
