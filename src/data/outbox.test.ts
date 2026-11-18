import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRepo } from './localRepo';
import { outbox, replayOutbox, type OutboxEntry } from './outbox';
import { makeKid } from '../engine/newKid';
import { planSession, SessionRunner } from '../engine/session';
import { availableCards } from '../engine/mastery';
import { mulberry32 } from '../engine/problems';
import { clearFailures, getFailures } from '../ui/failures';
import { saveRun } from '../ui/runShared';

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

describe('the outbox keeps a finished run until both writes are confirmed', () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    installStorage();
    clearFailures();
    await outbox.clear();
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  it('a refused write lands in the outbox and replays on the next launch exactly once', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', 'reader');
    await repo.createKid(kid);
    const run = playedRun(kid);
    repo.applyGameDelta = async () => {
      throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    };
    const saved = (await saveRun(repo, kid, run, Date.now() - 1000))!;
    expect(saved.saved).toBe(false);
    const queued = await outbox.list(kid.id);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.runId).toBe(queued[0]!.sessionLog!.id);
    expect(queued[0]!.gameDelta.xp).toBe(run.summary().xp);

    // Next launch: a fresh repo on the same storage, the outbox read back from IndexedDB.
    const next = new LocalRepo();
    const first = await replayOutbox(next);
    expect(first.replayed).toBe(1);
    expect((await next.getKid(kid.id))!.game.xp).toBe(run.summary().xp);
    expect(await next.listSessions(kid.id, 10)).toHaveLength(1);
    expect(await outbox.list(kid.id)).toHaveLength(0);
    const again = await replayOutbox(next);
    expect(again.replayed).toBe(0);
    expect((await next.getKid(kid.id))!.game.xp).toBe(run.summary().xp);
  });

  it('a run that saves leaves nothing in the outbox', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', 'reader');
    await repo.createKid(kid);
    const saved = (await saveRun(repo, kid, playedRun(kid), Date.now() - 1000))!;
    expect(saved.saved).toBe(true);
    expect(await outbox.list()).toHaveLength(0);
  });

  it('the Try again button replays the outbox, once', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', 'reader');
    await repo.createKid(kid);
    const run = playedRun(kid);
    const real = repo.applyGameDelta.bind(repo);
    let calls = 0;
    repo.applyGameDelta = async (...a) => {
      if (calls++ === 0) throw new Error('offline');
      return real(...a);
    };
    await saveRun(repo, kid, run, Date.now() - 1000);
    const toast = getFailures().find((f) => /not saved/.test(f.message))!;
    await toast.retry!();
    await toast.retry?.();
    expect((await repo.getKid(kid.id))!.game.xp).toBe(run.summary().xp);
    expect(await outbox.list()).toHaveLength(0);
  });

  it('replaying the same runId twice changes game and sessions once', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', 'reader');
    await repo.createKid(kid);
    const entry: OutboxEntry = {
      runId: 'run-aaaa',
      kidId: kid.id,
      sessionLog: { id: 'run-aaaa', startedAt: 1, endedAt: 2, answered: 5, graded: 5, correct: 5, fast: 0, newLearned: 0, medianMs: 1000, xp: 50, gems: 5, bestCombo: 5, missed: [] },
      gameDelta: { xp: 50, gems: 5, bestCombo: 5, playedAt: 2 },
      savedAt: 3,
    };
    await outbox.put(entry);
    await replayOutbox(repo);
    await outbox.put(entry);
    await replayOutbox(repo);
    await replayOutbox(repo);
    const stored = (await repo.getKid(kid.id))!;
    expect(stored.game.xp).toBe(50);
    expect(stored.game.gems).toBe(5);
    expect(await repo.listSessions(kid.id, 10)).toHaveLength(1);
    expect(await outbox.list()).toHaveLength(0);
  });
});

describe('a run the server always refuses', () => {
  beforeEach(async () => {
    await outbox.clear();
  });
  const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  it('is parked after 3 tries, and the next launch makes 0 attempts', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: number[] = [];
    const repo = { applyGameDelta: vi.fn(async (_k: string, d: { gems?: number; xp?: number }) => { seen.push(d.gems ?? 0); throw denied(); }) } as unknown as Parameters<typeof replayOutbox>[0];
    const session = { id: 'r1', startedAt: 1, endedAt: 2, answered: 1, graded: 1, correct: 1, fast: 0, newLearned: 0, medianMs: 1, xp: 3000, gems: 12, bestCombo: 1, missed: [] };
    await outbox.put({ runId: 'r1', kidId: 'k1', sessionLog: session, gameDelta: { xp: 3000, gems: 12, playedAt: 5 }, savedAt: 5 });
    await expect(replayOutbox(repo)).rejects.toThrow(); // try 1
    await expect(replayOutbox(repo)).rejects.toThrow(); // try 2
    expect(await replayOutbox(repo)).toEqual({ replayed: 0 }); // try 3, clamped, then parked
    expect(seen).toEqual([12, 12, 10]); // the third try carries gems cut to 10
    expect(await outbox.list()).toHaveLength(0);
    expect((await outbox.listParked()).map((p) => p.runId)).toEqual(['r1']);
    expect(log).toHaveBeenCalled(); // console.error on parking
    const calls = (repo.applyGameDelta as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(await replayOutbox(repo)).toEqual({ replayed: 0 }); // next launch
    expect((repo.applyGameDelta as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
    expect(calls).toBe(3);
    log.mockRestore();
  });
  it('an offline failure is not counted and never parks', async () => {
    const repo = { applyGameDelta: vi.fn(async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); }) } as unknown as Parameters<typeof replayOutbox>[0];
    const session = { id: 'r2', startedAt: 1, endedAt: 2, answered: 1, graded: 1, correct: 1, fast: 0, newLearned: 0, medianMs: 1, xp: 3, gems: 1, bestCombo: 1, missed: [] };
    await outbox.put({ runId: 'r2', kidId: 'k1', sessionLog: session, gameDelta: { xp: 3, gems: 1, playedAt: 5 }, savedAt: 5 });
    for (let i = 0; i < 5; i++) await expect(replayOutbox(repo)).rejects.toThrow();
    expect(await outbox.list()).toHaveLength(1);
    expect(await outbox.listParked()).toHaveLength(0);
  });
  it('a tip the stored game refuses (the 4th of a day) is dropped, not retried, and does not block the queue', async () => {
    const { GameDeltaError } = await import('../engine/game');
    const apply = vi.fn(async (_id: string, d: { shopTip?: boolean }) => {
      if (d.shopTip) throw new GameDeltaError('That is all the tips for today.');
      return {} as never;
    });
    const repo = { applyGameDelta: apply } as unknown as Parameters<typeof replayOutbox>[0];
    const tipDelta = { shopTip: true, gemGrant: { base: 1, learner: 'reader' as const, settings: {} }, playedAt: 5 };
    await outbox.put({ runId: 't1', kidId: 'k1', gameDelta: tipDelta, savedAt: 5 });
    await outbox.put({ runId: 't2', kidId: 'k1', gameDelta: { xp: 3, playedAt: 6 }, savedAt: 6 });
    expect(await replayOutbox(repo)).toEqual({ replayed: 1 });
    expect(await outbox.list()).toHaveLength(0);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(await outbox.listParked()).toHaveLength(0);
  });
});
