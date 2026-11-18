import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRepo } from './localRepo';
import { outbox, replayOutbox } from './outbox';
import { makeKid } from '../engine/newKid';
import { planSession, SessionRunner } from '../engine/session';
import { availableCards } from '../engine/mastery';
import { mulberry32 } from '../engine/problems';
import { sessionModeOf, type Learner, type SessionLog } from '../engine/models';
import { EMPTY_TOTALS, addRun, loadTrip, resolveTrip, saveTrip, type TripState, type TripTotals } from '../game/overworld/trip';
import { queueCheckpoint } from '../game/overworld/tripWrite';
import { clearFailures } from '../ui/failures';
import { saveRun } from '../ui/runShared';

function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

const totals = (graded: number, xp: number): TripTotals => ({ ...EMPTY_TOTALS, answered: graded, graded, correct: graded, xp, bestCombo: graded });
const newTrip = (): TripState => resolveTrip(null, Date.now(), () => 'trip0000000000000001').trip;
const sessions = (repo: LocalRepo, id: string) => repo.listSessions(id, 20);

/** A real runner that answers `n` questions right, so saveRun has something to close. */
function runnerAnswering(kid: ReturnType<typeof makeKid>, n: number) {
  const cards = {};
  const plan = planSession({ cards, available: availableCards(cards, kid.settings), now: Date.now(), size: 10, maxNew: 10, rng: mulberry32(1) });
  const run = new SessionRunner(plan, cards, mulberry32(2), Date.now, kid.settings);
  let done = 0;
  while (!run.done() && done < n) {
    const e = run.current()!;
    if (e.kind === 'teach') {
      run.acknowledge();
      continue;
    }
    const a = e.problem.answer;
    run.answer(a.kind === 'int' ? { kind: 'int', value: a.value } : { kind: 'int', value: 0 }, 1200);
    run.advance();
    done++;
  }
  return run;
}

describe.each<Learner>(['reader', 'prereader'])('Adventure trip checkpoints (%s)', (learner) => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    installStorage();
    clearFailures();
    await outbox.clear();
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  async function setup() {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', learner);
    await repo.createKid(kid);
    return { repo, kid };
  }

  it('a pagehide at 15 answers leaves one session with graded 15, XP credited, mode overworld and finished false', async () => {
    const { repo, kid } = await setup();
    const trip = newTrip();
    await queueCheckpoint(repo, kid.id, trip, totals(15, 150), 'castle');
    const [log] = await sessions(repo, kid.id);
    expect(log).toMatchObject({ id: trip.tripId, graded: 15, xp: 150, xpCredited: 150, mode: 'overworld', region: 'castle', finished: false });
    expect(log!.endedBy).toBeUndefined();
    expect((await repo.getKid(kid.id))!.game.xp).toBe(150);
    expect(await outbox.list(kid.id)).toHaveLength(0);
  });

  it('resume to 30 answers and then the campfire gives one doc, finished true, XP credited once', async () => {
    const { repo, kid } = await setup();
    const trip = newTrip();
    await queueCheckpoint(repo, kid.id, trip, totals(15, 150), 'meadow');
    // A later open of the same trip: the stored trip resumes with the same id, and the session doc is the same one.
    saveTrip(kid.id, trip);
    const again = resolveTrip(loadTrip(kid.id), Date.now() + 3_600_000, () => 'other');
    expect(again.trip.tripId).toBe(trip.tripId);
    await queueCheckpoint(repo, kid.id, again.trip, totals(25, 260), 'forest');
    // The campfire: saveRun with the trip and a runner that answered 5 more.
    const run = runnerAnswering(kid, 5);
    const extra = { mode: 'overworld' as const, trip: { id: trip.tripId, startedAt: trip.startedAt, seq: again.trip.seq + 1, base: again.trip.totals, region: 'forest' } };
    const out = (await saveRun(repo, kid, run, trip.startedAt, undefined, extra))!;
    expect(out.saved).toBe(true);
    const logs = await sessions(repo, kid.id);
    expect(logs).toHaveLength(1);
    const expectedXp = 260 + run.summary().xp;
    expect(logs[0]).toMatchObject({ id: trip.tripId, finished: true, endedBy: 'camp', mode: 'overworld', graded: 25 + run.summary().graded, xpCredited: expectedXp });
    expect((await repo.getKid(kid.id))!.game.xp).toBe(expectedXp);
    // A late repeat of an earlier checkpoint cannot reopen the trip or add XP.
    await repo.applyGameDelta(kid.id, { xp: 150, playedAt: Date.now() }, { session: { ...(logs[0] as SessionLog), finished: false, graded: 15 }, checkpoint: true });
    expect((await repo.getKid(kid.id))!.game.xp).toBe(expectedXp);
    expect((await sessions(repo, kid.id))[0]!.finished).toBe(true);
  });

  it('an outbox replay after a crash does not double the XP', async () => {
    const { repo, kid } = await setup();
    const trip = newTrip();
    const real = repo.applyGameDelta.bind(repo);
    // The write lands, then the page dies before the outbox entry is removed.
    repo.applyGameDelta = async (...a: Parameters<typeof real>) => {
      await real(...a);
      throw new Error('page died after the write');
    };
    await queueCheckpoint(repo, kid.id, trip, totals(10, 100), 'meadow');
    repo.applyGameDelta = real;
    expect((await repo.getKid(kid.id))!.game.xp).toBe(100);
    expect(await outbox.list(kid.id)).toHaveLength(1);
    const first = await replayOutbox(repo, kid.id);
    expect(first.replayed).toBe(1);
    const second = await replayOutbox(repo, kid.id);
    expect(second.replayed).toBe(0);
    expect((await repo.getKid(kid.id))!.game.xp).toBe(100);
    expect((await sessions(repo, kid.id))[0]!.xpCredited).toBe(100);
  });

  it('a lost checkpoint costs nothing: the next one carries the totals', async () => {
    const { repo, kid } = await setup();
    const trip = newTrip();
    trip.seq += 1; // checkpoint 1 was never written
    await queueCheckpoint(repo, kid.id, trip, totals(20, 210), 'meadow');
    expect((await repo.getKid(kid.id))!.game.xp).toBe(210);
  });

  it('chest gems are never granted by a checkpoint, and XP above 2000 is credited across checkpoints', async () => {
    const { repo, kid } = await setup();
    const trip = newTrip();
    await queueCheckpoint(repo, kid.id, trip, totals(10, 4500), 'meadow');
    let g = (await repo.getKid(kid.id))!.game;
    expect(g.gems).toBe(kid.game.gems);
    expect(g.xp).toBe(2000);
    await queueCheckpoint(repo, kid.id, trip, totals(20, 4500), 'meadow');
    g = (await repo.getKid(kid.id))!.game;
    expect(g.xp).toBe(4000);
  });

  it('an expired open trip is closed as left and a new trip starts; a finished trip never resumes', () => {
    const t = newTrip();
    const day = 24 * 3_600_000;
    const expired = resolveTrip(t, t.startedAt + day + 1, () => 'nextTrip');
    expect(expired.trip.tripId).toBe('nextTrip');
    expect(expired.close?.tripId).toBe(t.tripId);
    const done = resolveTrip({ ...t, finished: true }, t.startedAt + 1000, () => 'afterCamp');
    expect(done.trip.tripId).toBe('afterCamp');
    expect(done.close).toBeNull();
    expect(addRun(EMPTY_TOTALS, { answered: 2, graded: 2, correct: 1, fast: 0, newLearned: 0, medianMs: 900, xp: 20, gems: 0, bestCombo: 1, missed: ['a'], faster: [] }).xp).toBe(20);
  });

  it('closing a left-open trip sets endedBy left, keeps finished false, and credits any XP not yet credited', async () => {
    const { repo, kid } = await setup();
    const trip = newTrip();
    await queueCheckpoint(repo, kid.id, trip, totals(12, 120), 'meadow');
    await queueCheckpoint(repo, kid.id, trip, totals(12, 120), 'meadow', 'left');
    expect((await sessions(repo, kid.id))[0]).toMatchObject({ finished: false, endedBy: 'left', xpCredited: 120 });
    expect((await repo.getKid(kid.id))!.game.xp).toBe(120);
  });

  it('the mode tag is on every new log: dungeon, prereader and overworld', async () => {
    const { repo, kid } = await setup();
    const dungeon = (await saveRun(repo, kid, runnerAnswering(kid, 2), Date.now() - 1000, undefined, { mode: 'dungeon' }))!;
    expect(dungeon.saved).toBe(true);
    await saveRun(repo, kid, runnerAnswering(kid, 2), Date.now() - 1000, undefined, { mode: 'prereader' });
    const t = newTrip();
    await saveRun(repo, kid, runnerAnswering(kid, 2), Date.now() - 1000, undefined, { mode: 'overworld', trip: { id: t.tripId, startedAt: t.startedAt, seq: 1, base: EMPTY_TOTALS, region: 'meadow' } });
    const modes = (await sessions(repo, kid.id)).map((l) => l.mode).sort();
    expect(modes).toEqual(['dungeon', 'overworld', 'prereader']);
    // With no tag given, the mode follows the player type.
    await saveRun(repo, kid, runnerAnswering(kid, 2), Date.now() - 1000);
    const last = (await sessions(repo, kid.id)).find((l) => l.mode === (learner === 'prereader' ? 'prereader' : 'dungeon'));
    expect(last).toBeTruthy();
    // A log from before the tag reads by player type.
    expect(sessionModeOf({}, 'reader')).toBe('dungeon');
    expect(sessionModeOf({}, 'prereader')).toBe('prereader');
  });
});
