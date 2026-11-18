import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { FACT_CARDS, getCardDef } from './content';
import { dayKey } from './game';
import { gemsForRun } from './gems';
import { DEFAULT_SETTINGS, type CardMap, type SessionLog } from './models';
import { makeKid } from './newKid';
import { mulberry32 } from './problems';
import { isOldBuild, summaryCounts } from './runLabel';
import { newCardState, review } from './scheduler';
import { FILL_REST_MS, SessionRunner, planSession, type PlanItem } from './session';
import { LocalRepo } from '../data/localRepo';
import { outbox } from '../data/outbox';
import { BUILD } from '../version';
import { saveRun } from '../ui/runShared';
import { addRun, EMPTY_TOTALS, tripLog } from '../game/overworld/trip';

// Every name and number here is made up.
const NOW = new Date('2026-11-18T12:00:00').getTime();
const HOUR = 3_600_000;

function fillRun(n: number, wrong: number): SessionRunner {
  const ids = ['mul:7x8', 'mul:4x6', 'mul:3x3', 'mul:5x5', 'mul:9x9', 'mul:6x7'];
  const plan: PlanItem[] = Array.from({ length: n }, (_, i) => ({ cardId: ids[i % ids.length]!, isNew: false, fill: true }));
  const run = new SessionRunner(plan, {}, mulberry32(3), () => NOW, DEFAULT_SETTINGS);
  let seen = 0;
  while (!run.done()) {
    const e = run.current()!;
    const a = e.problem.answer;
    if (a.kind !== 'int') throw new Error('facts only');
    run.answer({ kind: 'int', value: e.fill === true && seen++ < wrong ? a.value + 1 : a.value }, 1500);
    run.advance();
  }
  return run;
}

describe('summaryCounts: every answer counts, right out of answered', () => {
  it('a fill-only run of 6 with 1 wrong reads 5 of 6, and the in-run retry is not counted', () => {
    const s = fillRun(6, 1).summary();
    expect(s.answered).toBe(7); // 6 answers + 1 retry of the miss
    expect(s).toMatchObject({ graded: 6, correct: 5 });
    expect(s.practiceCorrect).toBeUndefined();
    expect(s.fillAnswered).toBeUndefined();
    expect(summaryCounts(s)).toMatchObject({ right: 5, total: 6, graded: 6, fill: 0 });
  });
  it('the counts carry no practice wording or flag for the kid', () => {
    expect(Object.keys(summaryCounts(fillRun(4, 0).summary())).sort()).toEqual(['fill', 'graded', 'right', 'total']);
  });
  it('an old log with 52 fill answers and 49 right still reads 49 of 52', () => {
    expect(summaryCounts({ answered: 55, graded: 0, correct: 0, practiceCorrect: 49, fillAnswered: 52 })).toMatchObject({ right: 49, total: 52 });
  });
  it('an old mixed log adds graded and practice: 27 of 30 graded and 20 of 22 practice read 47 of 52', () => {
    expect(summaryCounts({ answered: 56, graded: 30, correct: 27, practiceCorrect: 20, fillAnswered: 22 })).toMatchObject({ right: 47, total: 52 });
  });
  it('a graded-only run keeps its numbers', () => {
    expect(summaryCounts({ answered: 33, graded: 30, correct: 27 })).toMatchObject({ right: 27, total: 30 });
  });
  it('a trip saved before fillAnswered existed falls back to answers minus graded', () => {
    expect(summaryCounts({ answered: 52, graded: 0, correct: 0, practiceCorrect: 49 })).toMatchObject({ right: 49, total: 52 });
  });
  it('a run with answers but no graded and no fill count never reads 0 of 0', () => {
    expect(summaryCounts({ answered: 3, graded: 0, correct: 0 }).total).toBe(3);
  });
  it('a trip adds a new run into old totals once: practiceCorrect stays at the old 8, correct grows by the run', () => {
    const base = { ...EMPTY_TOTALS, fillAnswered: 10, practiceCorrect: 8 };
    const t = addRun(base, { ...fillRun(6, 0).summary() });
    expect(t).toMatchObject({ fillAnswered: 10, practiceCorrect: 8, graded: 6, correct: 6 });
  });
});

describe('gems: no answer is counted twice', () => {
  const stats = (correct: number, practiceCorrect?: number) => ({ correct, ...(practiceCorrect ? { practiceCorrect } : {}), graded: correct, bestCombo: 0, newLearned: 0 });
  it('a new run (correct only) earns the same as an old payload that split the same right answers into correct plus practiceCorrect', () => {
    for (const learner of ['reader', 'prereader'] as const) {
      expect(gemsForRun(stats(30), learner, {}, 0)).toBe(gemsForRun({ ...stats(18), practiceCorrect: 12 }, learner, {}, 0));
    }
  });
  it('a new run reports no practiceCorrect, so only `correct` feeds the gems', () => {
    const run = fillRun(9, 0);
    expect(run.summary().practiceCorrect).toBeUndefined();
    expect(run.summary().gems).toBe(gemsForRun({ correct: 9, graded: 9, bestCombo: 9, newLearned: 0 }, 'reader', {}, 0));
  });
});

describe('build and mode on every session log', () => {
  beforeEach(async () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    await outbox.clear();
  });
  it.each([['reader', 'dungeon'], ['prereader', 'prereader']] as const)('a %s run logs mode %s and this bundle\'s build', async (learner, mode) => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', learner);
    await repo.createKid(kid);
    await saveRun(repo, kid, fillRun(4, 0), Date.now());
    const [log] = await repo.listSessions(kid.id, 5);
    expect(log).toMatchObject({ mode, build: BUILD });
  });
  it('an Adventure checkpoint log carries mode overworld and the build', () => {
    const log = tripLog({ tripId: 't', startedAt: 1 }, EMPTY_TOTALS, 2, 'forest');
    expect(log).toMatchObject({ mode: 'overworld', build: BUILD });
  });
});

describe('old app version badge', () => {
  const log = (build?: number): Pick<SessionLog, 'build'> => (build === undefined ? {} : { build });
  it('shows for a log older than the live build only', () => {
    expect(isOldBuild(log(100), 200)).toBe(true);
    expect(isOldBuild(log(200), 200)).toBe(false);
    expect(isOldBuild(log(300), 200)).toBe(false);
  });
  it('a log with no build shows no badge', () => {
    expect(isOldBuild(log(), 200)).toBe(false);
  });
});

describe('fill rotation', () => {
  /** A seen card answered 3 times today, last answered `ago` ms before NOW. */
  function capped(id: string, ago: number, missed = false): CardMap[string] {
    const c = review(newCardState(id, NOW - 20 * 86_400_000), Rating.Good, 1500, true, NOW - 10 * 86_400_000);
    return { ...c, fsrs: { ...c.fsrs, due: NOW + 5 * 86_400_000 }, updatedAt: NOW - ago, day: dayKey(NOW), dayGraded: 3, lastResults: missed ? [true, false] : [true, true], ...(missed ? { missDay: dayKey(NOW) } : {}) };
  }
  const ids = FACT_CARDS.filter((c) => c.groupIndex === 0).slice(0, 3).map((c) => c.id);
  const plan = (cards: CardMap, size: number) => planSession({ cards, available: Object.keys(cards).map((id) => getCardDef(id)!), now: NOW, size, maxNew: 0, rng: mulberry32(5) });
  const picked = (p: PlanItem[]) => p.map((i) => i.cardId);

  it('the rest time is 10 minutes', () => expect(FILL_REST_MS).toBe(10 * 60_000));
  it('a card answered 5 minutes ago is skipped by fill; cards that rested 11 and 30 minutes are used', () => {
    const cards: CardMap = { [ids[0]!]: capped(ids[0]!, 5 * 60_000), [ids[1]!]: capped(ids[1]!, 11 * 60_000), [ids[2]!]: capped(ids[2]!, 30 * 60_000) };
    expect(picked(plan(cards, 2)).sort()).toEqual([ids[1]!, ids[2]!].sort());
  });
  it('a card answered 5 minutes ago comes back when it was missed', () => {
    const cards: CardMap = { [ids[0]!]: capped(ids[0]!, 5 * 60_000, true), [ids[1]!]: capped(ids[1]!, 11 * 60_000), [ids[2]!]: capped(ids[2]!, 30 * 60_000) };
    expect(picked(plan(cards, 3))).toContain(ids[0]);
    expect(picked(plan(cards, 3))).toHaveLength(3);
  });
  it('when every card is recent the run is still full, least recent first', () => {
    const cards: CardMap = { [ids[0]!]: capped(ids[0]!, 5 * 60_000), [ids[1]!]: capped(ids[1]!, 8 * 60_000), [ids[2]!]: capped(ids[2]!, 2 * 60_000) };
    const p = plan(cards, 1);
    expect(p).toHaveLength(1);
    expect(picked(p)).toEqual([ids[1]!]);
  });
  it('cards answered 3 times today are still planned: there is no daily cap', () => {
    const cards: CardMap = { [ids[0]!]: capped(ids[0]!, 3 * HOUR), [ids[1]!]: capped(ids[1]!, 3 * HOUR), [ids[2]!]: capped(ids[2]!, 3 * HOUR) };
    expect(picked(plan(cards, 7)).sort()).toEqual([...ids].sort());
  });
});

describe('gems for a fill-only run, tier by tier', () => {
  const fill = (right: number) => ({ correct: 0, practiceCorrect: right, graded: 0, bestCombo: 0, newLearned: 0 });
  it('a fill-only run at 50 earned today (quarter tier) earns at least 1, and never more than 10', () => {
    expect(gemsForRun(fill(49), 'reader', {}, 50)).toBeGreaterThanOrEqual(1);
    expect(gemsForRun(fill(49), 'reader', {}, 50)).toBeLessThanOrEqual(10);
    expect(gemsForRun(fill(1), 'reader', {}, 50)).toBe(1);
  });
  it('each boundary: reader 24/25 and 49/50, pre-reader 14/15 and 29/30, with the cap of 10', () => {
    const at = (l: 'reader' | 'prereader', e: number) => gemsForRun(fill(30), l, {}, e);
    expect([at('reader', 24), at('reader', 25), at('reader', 49), at('reader', 50)]).toEqual([10, 5, 5, 2]);
    expect([at('prereader', 14), at('prereader', 15), at('prereader', 29), at('prereader', 30)]).toEqual([10, 7, 7, 3]);
  });
});
