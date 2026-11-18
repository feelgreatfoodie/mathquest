import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import type { CardMap } from './models';
import { mulberry32, type AnswerInput } from './problems';
import { newCardState, review } from './scheduler';
import { SessionRunner, type Entry, type PlanItem } from './session';

const DAY = 86_400_000;
const T0 = new Date('2026-11-16T16:00:00').getTime();

/** Seen cards have FSRS history, so due and stability are real numbers, not defaults. */
function history(): CardMap {
  const cards: CardMap = {};
  const seen: Array<[string, number, number]> = [['mul:7x8', 9, 3100], ['mul:4x6', 5, 1800], ['mul:3x3', 2, 900]];
  for (const [id, daysAgo, ms] of seen) {
    const at = T0 - daysAgo * DAY;
    cards[id] = review(review(newCardState(id, at - DAY), Rating.Good, ms, true, at - DAY), Rating.Good, ms, true, at);
  }
  return cards;
}

const PLAN: PlanItem[] = [
  { cardId: 'mul:7x8', isNew: false },
  { cardId: 'mul:4x6', isNew: false },
  { cardId: 'mul:9x9', isNew: true },
  { cardId: 'fr:add', isNew: true }, // a skill: teach entry plus graded entry
  { cardId: 'mul:3x3', isNew: false },
  { cardId: 'mul:5x5', isNew: true },
  { cardId: 'add:2+3', isNew: true }, // choices module
];

function make(): SessionRunner {
  return new SessionRunner(PLAN, history(), mulberry32(11), () => T0, { learner: 'reader', paceMultiplier: 3 });
}

/** The same kid behaviour in any order: odd attempts per card miss, the time depends on the card and the attempt. */
function inputFor(entry: Entry, attempt: number): AnswerInput {
  const a = entry.problem.answer;
  if (a.kind === 'int') return { kind: 'int', value: attempt === 0 && /7x8|9x9|fr:add/.test(entry.cardId) ? a.value + 1 : a.value };
  return { kind: 'mixed', value: attempt === 0 ? { w: 0, n: 1, d: 99 } : a.value };
}
const msFor = (cardId: string, attempt: number) => 900 + ((cardId.length * 311 + attempt * 1700) % 4000);

/** Answers every graded and practice entry, including retries, choosing the next entry with `pick`. */
function drain(run: SessionRunner, pick: (pending: Entry[]) => Entry): void {
  const attempts = new Map<string, number>();
  for (let guard = 0; guard < 100; guard++) {
    const pending = run.pending();
    if (!pending.length) return;
    const e = pick(pending);
    const n = attempts.get(e.cardId) ?? 0;
    attempts.set(e.cardId, n + 1);
    run.answerEntry(e.id, inputFor(e, n), msFor(e.cardId, n));
  }
  throw new Error('never drained');
}

const states = (run: SessionRunner) => Object.fromEntries(run.changedCards().map((c) => [c.id, c]));

describe('answerEntry', () => {
  it('gives every entry a unique id, retries included', () => {
    const run = make();
    drain(run, (p) => p[0]!);
    const ids = run.queue.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(run.queue.some((e) => e.kind === 'practice')).toBe(true);
  });

  it('out-of-order answers leave every card exactly as in-order answers do (FSRS due and stability included)', () => {
    const inOrder = make();
    drain(inOrder, (p) => p[0]!);
    const reversed = make();
    drain(reversed, (p) => p[p.length - 1]!);
    const shuffled = make();
    const rng = mulberry32(5);
    drain(shuffled, (p) => p[Math.floor(rng() * p.length)]!);

    const want = states(inOrder);
    expect(Object.keys(want).sort()).toEqual(['add:2+3','fr:add','mul:3x3','mul:5x5','mul:4x6','mul:7x8','mul:9x9'].sort());
    for (const other of [reversed, shuffled]) {
      expect(states(other)).toEqual(want);
      for (const id of Object.keys(want)) {
        expect(other.getCard(id)!.fsrs.due).toBe(want[id]!.fsrs.due);
        expect(other.getCard(id)!.fsrs.stability).toBe(want[id]!.fsrs.stability);
        expect(other.getCard(id)!.recentMs).toEqual(want[id]!.recentMs);
      }
      const a = other.summary();
      const b = inOrder.summary();
      // XP, gems and combo depend on the order of hits, so they are not compared.
      expect({ ...a, xp: 0, gems: 0, bestCombo: 0, medianMs: 0, faster: [], missed: [...a.missed].sort() }).toEqual({
        ...b, xp: 0, gems: 0, bestCombo: 0, medianMs: 0, faster: [], missed: [...b.missed].sort(),
      });
      expect(a.medianMs).toBe(b.medianMs);
    }
  });

  it('is the same grading path as answer(): same feedback and card for the current entry', () => {
    const viaAnswer = make();
    const viaEntry = make();
    const e = viaAnswer.current()!;
    const fbA = viaAnswer.answer(inputFor(e, 0), 2500);
    const fbB = viaEntry.answerEntry(viaEntry.current()!.id, inputFor(e, 0), 2500);
    expect(fbB).toEqual(fbA);
    expect(viaEntry.getCard(e.cardId)).toEqual(viaAnswer.getCard(e.cardId));
    expect(viaEntry.queue.map((x) => x.kind)).toEqual(viaAnswer.queue.map((x) => x.kind));
  });

  it('puts a retry after the entry that was answered, not after the in-order cursor', () => {
    const run = make();
    const last = run.pending().at(-1)!;
    run.answerEntry(last.id, { kind: 'int', value: -1 }, 3000);
    const at = run.queue.findIndex((x) => x.id === last.id);
    expect(run.queue[at + 1]!.kind === 'practice' || at + 1 === run.queue.length - 1 || run.queue.slice(at + 1).some((x) => x.kind === 'practice')).toBe(true);
    expect(run.queue.slice(0, at).some((x) => x.kind === 'practice' && x.cardId === last.cardId)).toBe(false);
  });

  it('refuses a second answer, an unknown id and a teach entry', () => {
    const run = make();
    const first = run.pending()[0]!;
    run.answerEntry(first.id, inputFor(first, 1), 2000);
    expect(() => run.answerEntry(first.id, inputFor(first, 1), 2000)).toThrow(/already answered/);
    expect(() => run.answerEntry('nope', { kind: 'int', value: 1 }, 1)).toThrow(/No entry/);
    const teach = run.queue.find((x) => x.kind === 'teach')!;
    expect(() => run.answerEntry(teach.id, { kind: 'int', value: 1 }, 1)).toThrow(/No question/);
    expect(run.pending().some((x) => x.kind === 'teach')).toBe(false);
  });
});
