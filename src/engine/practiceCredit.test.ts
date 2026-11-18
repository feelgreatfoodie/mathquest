import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { FACT_CARDS, getCardDef } from './content';
import { dayKey } from './game';
import { gemsForRun } from './gems';
import { DEFAULT_SETTINGS, type CardMap, type SessionLog } from './models';
import { makeKid } from './newKid';
import { mulberry32 } from './problems';
import { isOldBuild, practiceLine, summaryCounts } from './runLabel';
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

describe('summaryCounts: a kid never reads 0/0', () => {
  it('an all-fill run of 6 with 1 wrong reads 5 of 6, not 0/0, and the in-run retry is not counted', () => {
    const s = fillRun(6, 1).summary();
    expect(s.answered).toBe(7); // 6 fill answers + 1 retry of the miss
    expect(s.fillAnswered).toBe(6);
    const c = summaryCounts(s);
    expect(c).toMatchObject({ right: 5, total: 6, graded: 0, fill: 6, practiceOnly: true });
    expect(`${c.right}/${c.total}`).not.toBe('0/0');
    expect(practiceLine(c)).toBe('Practice round: 5 of 6 right. Practice answers earn gems too.');
  });
  it('a run with 52 fill answers and 49 right reads 49 of 52', () => {
    expect(summaryCounts({ answered: 55, graded: 0, correct: 0, practiceCorrect: 49, fillAnswered: 52 })).toMatchObject({ right: 49, total: 52 });
  });
  it('a mixed run adds graded and practice: 27 of 30 graded and 20 of 22 practice read 47 of 52', () => {
    const c = summaryCounts({ answered: 56, graded: 30, correct: 27, practiceCorrect: 20, fillAnswered: 22 });
    expect(c).toMatchObject({ right: 47, total: 52, practiceOnly: false });
    expect(practiceLine(c)).toBe('30 graded and 22 practice. Practice answers earn gems too.');
  });
  it('a graded-only run keeps its old numbers and shows no practice line', () => {
    const c = summaryCounts({ answered: 33, graded: 30, correct: 27 });
    expect(c).toMatchObject({ right: 27, total: 30 });
    expect(practiceLine(c)).toBeNull();
  });
  it('a trip saved before fillAnswered existed falls back to answers minus graded', () => {
    expect(summaryCounts({ answered: 52, graded: 0, correct: 0, practiceCorrect: 49 })).toMatchObject({ right: 49, total: 52 });
  });
  it('a run with answers but no graded and no fill count never reads 0 of 0', () => {
    expect(summaryCounts({ answered: 3, graded: 0, correct: 0 }).total).toBe(3);
  });
  it('a trip adds fill answers across opens', () => {
    const base = { ...EMPTY_TOTALS, fillAnswered: 10, practiceCorrect: 8 };
    const t = addRun(base, { ...fillRun(6, 0).summary() });
    expect(t).toMatchObject({ fillAnswered: 16, practiceCorrect: 14 });
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
  /** A seen card that already had its 3 graded answers today, last answered `ago` ms before NOW. */
  function capped(id: string, ago: number, missed = false): CardMap[string] {
    const c = review(newCardState(id, NOW - 20 * 86_400_000), Rating.Good, 1500, true, NOW - 10 * 86_400_000);
    return { ...c, updatedAt: NOW - ago, day: dayKey(NOW), dayGraded: 3, ...(missed ? { missDay: dayKey(NOW) } : {}) };
  }
  const ids = FACT_CARDS.filter((c) => c.groupIndex === 0).slice(0, 3).map((c) => c.id);
  const plan = (cards: CardMap, size: number) => planSession({ cards, available: Object.keys(cards).map((id) => getCardDef(id)!), now: NOW, size, maxNew: 0, rng: mulberry32(5) });

  it('a card answered 10 minutes ago waits behind cards that rested over an hour, even when it was missed today', () => {
    const cards: CardMap = { [ids[0]!]: capped(ids[0]!, 10 * 60_000, true), [ids[1]!]: capped(ids[1]!, 3 * HOUR), [ids[2]!]: capped(ids[2]!, 2 * HOUR) };
    const fill = plan(cards, 2).filter((p) => p.fill).map((p) => p.cardId).sort();
    expect(fill).toEqual([ids[1]!, ids[2]!].sort());
  });
  it('when every card is recent, the least recent still goes first', () => {
    const cards: CardMap = { [ids[0]!]: capped(ids[0]!, 5 * 60_000), [ids[1]!]: capped(ids[1]!, 40 * 60_000), [ids[2]!]: capped(ids[2]!, 20 * 60_000) };
    expect(FILL_REST_MS).toBe(HOUR);
    const fill = plan(cards, 1).filter((p) => p.fill).map((p) => p.cardId);
    expect(fill).toEqual([ids[1]!]);
  });
  it('the daily cap and the run size do not change: 3 graded stay out of graded slots and the plan has the size asked', () => {
    const cards: CardMap = { [ids[0]!]: capped(ids[0]!, 3 * HOUR), [ids[1]!]: capped(ids[1]!, 3 * HOUR), [ids[2]!]: capped(ids[2]!, 3 * HOUR) };
    const p = plan(cards, 7);
    expect(p).toHaveLength(7);
    expect(p.every((i) => i.fill)).toBe(true);
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
