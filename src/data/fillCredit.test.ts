import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRepo } from './localRepo';
import { outbox } from './outbox';
import { makeKid } from '../engine/newKid';
import { SessionRunner, type PlanItem } from '../engine/session';
import { mulberry32 } from '../engine/problems';
import { gemsForRun } from '../engine/gems';
import type { Learner } from '../engine/models';
import { clearFailures } from '../ui/failures';
import { saveRun } from '../ui/runShared';
import { fillLine } from '../engine/runLabel';

function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

/** A run made only of fill practice: `n` fill entries, the first `wrong` answered wrong (each wrong one adds a retry entry, answered right). */
function fillRunner(kid: ReturnType<typeof makeKid>, n: number, wrong: number) {
  const ids = ['mul:7x8', 'mul:4x6', 'mul:3x3', 'mul:5x5', 'mul:9x9', 'mul:6x7'];
  const plan: PlanItem[] = Array.from({ length: n }, (_, i) => ({ cardId: ids[i % ids.length]!, isNew: false, fill: true }));
  const run = new SessionRunner(plan, {}, mulberry32(3), Date.now, kid.settings);
  let seen = 0;
  while (!run.done()) {
    const e = run.current()!;
    const a = e.problem.answer;
    if (a.kind !== 'int') throw new Error('fill cards in this test are facts');
    const miss = e.fill === true && seen++ < wrong;
    run.answer({ kind: 'int', value: miss ? a.value + 1 : a.value }, 1500);
    run.advance();
  }
  return run;
}

describe.each<Learner>(['reader', 'prereader'])('fill-credit (%s)', (learner) => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    installStorage();
    clearFailures();
    await outbox.clear();
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  it('an all-fill run counts its right answers, earns gems, and the session log keeps practiceCorrect', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', learner);
    await repo.createKid(kid);
    const run = fillRunner(kid, 6, 1);
    const s = run.summary();
    expect(s).toMatchObject({ graded: 0, correct: 0, practiceCorrect: 5 });
    expect(s.gems).toBeGreaterThanOrEqual(1);
    const out = (await saveRun(repo, kid, run, Date.now()))!;
    expect(out.saved).toBe(true);
    expect(out.summary.gems).toBeGreaterThanOrEqual(1);
    const [log] = await repo.listSessions(kid.id, 5);
    expect(log).toMatchObject({ graded: 0, correct: 0, practiceCorrect: 5 });
    expect((await repo.getKid(kid.id))!.game.gems).toBe(out.summary.gems);
  });

  it('an all-fill run with 0 right earns 0 gems and logs no practiceCorrect', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', learner);
    await repo.createKid(kid);
    const run = fillRunner(kid, 4, 4);
    expect(run.summary().practiceCorrect).toBeUndefined();
    expect(run.summary().gems).toBe(0);
    const out = (await saveRun(repo, kid, run, Date.now()))!;
    expect(out.summary.gems).toBe(0);
    expect(await repo.listSessions(kid.id, 5).then((l) => l[0]!.practiceCorrect)).toBeUndefined();
  });

  it('the gem count the server recomputes from the delta matches the one the screen shows', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', learner);
    await repo.createKid(kid);
    const run = fillRunner(kid, 6, 0);
    const out = (await saveRun(repo, kid, run, Date.now()))!;
    expect((await repo.getKid(kid.id))!.game.gems).toBe(gemsForRun({ correct: 0, practiceCorrect: 6, graded: 0, bestCombo: run.summary().bestCombo, newLearned: 0 }, learner, {}, 0));
    expect(out.summary.gems).toBeGreaterThanOrEqual(1);
  });
});

describe('fillLine', () => {
  const base = { answered: 52, graded: 0, correct: 0, practiceCorrect: 49 };
  it('an all-fill run reads answers, right, practice', () => {
    expect(fillLine(base)).toBe('52 answers · 49 right · practice');
    expect(fillLine({ ...base, answered: 1, practiceCorrect: 1 })).toBe('1 answer · 1 right · practice');
  });
  it('a mixed run shows both counts', () => {
    expect(fillLine({ answered: 52, graded: 30, correct: 27, practiceCorrect: 20 })).toBe('30 graded · 27 right · 22 practice · 20 right');
  });
  it('a graded-only run has no extra line', () => {
    expect(fillLine({ answered: 30, graded: 30, correct: 27 })).toBeNull();
  });
  it('an old log without practiceCorrect still renders, with 0 right', () => {
    expect(fillLine({ answered: 52, graded: 0, correct: 0 })).toBe('52 answers · 0 right · practice');
  });
});
