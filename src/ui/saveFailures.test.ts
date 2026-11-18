import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRepo } from '../data/localRepo';
import { makeKid } from '../engine/newKid';
import { planSession, SessionRunner } from '../engine/session';
import { availableCards } from '../engine/mastery';
import { mulberry32 } from '../engine/problems';
import { clearFailures, getFailures, reportFailure } from './failures';
import { saveRun } from './runShared';

function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

function playedRun(kid: ReturnType<typeof makeKid>) {
  const cards = {};
  const plan = planSession({ cards, available: availableCards(cards, kid.settings), now: Date.now(), size: 5, maxNew: 5, rng: mulberry32(1) });
  const run = new SessionRunner(plan, cards, mulberry32(2), Date.now, kid.settings);
  let n = 0;
  while (!run.done() && n++ < 40) {
    const e = run.current()!;
    if (e.kind === 'teach') {
      run.acknowledge();
      continue;
    }
    const a = e.problem.answer;
    run.answer(a.kind === 'int' ? { kind: 'int', value: a.value } : { kind: 'int', value: 0 }, 1200);
    run.advance();
  }
  return run;
}

describe('a rejected write is shown and logged, never swallowed', () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    installStorage();
    clearFailures();
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  it('reportFailure logs, keeps one toast per message, and a retry that works removes it', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    reportFailure('Settings were not saved.', new Error('denied'), retry);
    reportFailure('Settings were not saved.', new Error('denied again'), retry);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(getFailures()).toHaveLength(1);
    await getFailures()[0]!.retry!();
    expect(retry).toHaveBeenCalledOnce();
    expect(getFailures()).toHaveLength(0);
  });

  it('a retry that fails again keeps the toast and logs', async () => {
    reportFailure('x', new Error('a'), async () => {
      throw new Error('still denied');
    });
    await getFailures()[0]!.retry!();
    expect(getFailures()).toHaveLength(1);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it('a run whose game write is rejected reports it with Try again, shows the earned totals, and the retry saves once', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', 'reader');
    await repo.createKid(kid);
    const run = playedRun(kid);
    const real = repo.applyGameDelta.bind(repo);
    let calls = 0;
    repo.applyGameDelta = async (...args) => {
      if (calls++ === 0) throw new Error('permission-denied');
      return real(...args);
    };
    const synced = vi.fn();
    const saved = (await saveRun(repo, kid, run, Date.now() - 1000, synced))!;
    expect(saved.saved).toBe(false);
    expect(saved.updated.game.xp).toBe(run.summary().xp); // the screen shows what the run earned
    expect(errors).toHaveBeenCalled();
    const [toast] = getFailures();
    expect(toast?.message).toMatch(/not saved/);
    expect((await repo.getKid(kid.id))!.game.xp).toBe(0); // the server has nothing yet
    await toast!.retry!();
    await toast!.retry?.(); // a second tap after success must not double count
    expect((await repo.getKid(kid.id))!.game.xp).toBe(run.summary().xp);
    expect(synced).toHaveBeenCalled();
    expect(getFailures()).toHaveLength(0);
  });
});
