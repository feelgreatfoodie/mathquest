import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRepo } from './localRepo';
import { outbox, replayOutbox } from './outbox';
import { makeKid } from '../engine/newKid';
import { MODE_NAMES, runLabel } from '../engine/runLabel';
import { sessionModeOf } from '../engine/models';
import { lairStats } from '../game/overworld/lair';
import { resolveTrip, type TripState } from '../game/overworld/trip';
import { lairLog, queueCheckpoint, queueLairLog } from '../game/overworld/tripWrite';
import { EMPTY_TOTALS } from '../game/overworld/trip';
import { clearFailures } from '../ui/failures';

function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}
const newTrip = (): TripState => resolveTrip(null, Date.now(), () => 'trip0000000000000002').trip;

describe('queueLairLog', () => {
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
    const kid = makeKid('Testkid', 'reader');
    await repo.createKid(kid);
    return { repo, kid };
  }

  it('writes one small log per boss fight: id tripId-lairN, mode lair, every count 0, xp 0', async () => {
    const { repo, kid } = await setup();
    const trip = newTrip();
    await queueLairLog(repo, kid.id, trip, { region: 'castle', bossWon: true, bossCorrect: 5, bossMs: 41_234.6 });
    await queueLairLog(repo, kid.id, trip, { region: 'castle', bossWon: false, bossCorrect: 3, bossMs: 90_000 });
    const logs = (await repo.listSessions(kid.id, 20)).sort((a, b) => a.id.localeCompare(b.id));
    expect(logs.map((l) => l.id)).toEqual([`${trip.tripId}-lair1`, `${trip.tripId}-lair2`]);
    expect(logs[0]).toMatchObject({ mode: 'lair', region: 'castle', bossWon: true, bossCorrect: 5, bossMs: 41_235, answered: 0, graded: 0, correct: 0, xp: 0, gems: 0 });
    expect(logs[1]).toMatchObject({ bossWon: false, bossCorrect: 3 });
    expect(trip.lairs).toBe(2);
    expect(await outbox.list(kid.id)).toHaveLength(0);
    expect((await repo.getKid(kid.id))!.game.xp).toBe(kid.game.xp);
  });
  it('beaten N and the bests come from the stored logs', async () => {
    const { repo, kid } = await setup();
    const trip = newTrip();
    await queueLairLog(repo, kid.id, trip, { region: 'forest', bossWon: true, bossCorrect: 6, bossMs: 50_000 });
    await queueLairLog(repo, kid.id, trip, { region: 'forest', bossWon: true, bossCorrect: 5, bossMs: 44_000 });
    await queueLairLog(repo, kid.id, trip, { region: 'forest', bossWon: false, bossCorrect: 2, bossMs: 20_000 });
    expect(lairStats(await repo.listSessions(kid.id, 50), 'forest')).toEqual({ beaten: 2, bestMs: 44_000, bestCorrect: 6 });
  });
  it('a lair log does not touch the trip checkpoint doc or its XP', async () => {
    const { repo, kid } = await setup();
    const trip = newTrip();
    await queueCheckpoint(repo, kid.id, trip, { ...EMPTY_TOTALS, answered: 10, graded: 10, correct: 9, xp: 100 }, 'meadow');
    await queueLairLog(repo, kid.id, trip, { region: 'meadow', bossWon: true, bossCorrect: 5, bossMs: 30_000 });
    const logs = await repo.listSessions(kid.id, 20);
    expect(logs).toHaveLength(2);
    expect(logs.find((l) => l.id === trip.tripId)).toMatchObject({ graded: 10, xp: 100, mode: 'overworld' });
    expect((await repo.getKid(kid.id))!.game.xp).toBe(100);
  });
  it('an outbox replay after a crash writes the log once', async () => {
    const { repo, kid } = await setup();
    const trip = newTrip();
    const real = repo.applyGameDelta.bind(repo);
    repo.applyGameDelta = async (...a: Parameters<typeof real>) => {
      await real(...a);
      throw new Error('page died after the write');
    };
    await queueLairLog(repo, kid.id, trip, { region: 'castle', bossWon: true, bossCorrect: 5, bossMs: 40_000 });
    repo.applyGameDelta = real;
    expect(await outbox.list(kid.id)).toHaveLength(1);
    expect((await replayOutbox(repo, kid.id)).replayed).toBe(1);
    expect((await replayOutbox(repo, kid.id)).replayed).toBe(0);
    expect(await repo.listSessions(kid.id, 20)).toHaveLength(1);
  });
});

describe('lair run label and mode', () => {
  it('reads "Adventure · Castle lair · boss beaten" for a win and "driven out" for a loss', () => {
    const base = lairLog({ tripId: 't1' }, 1, { region: 'castle', bossWon: true, bossCorrect: 5, bossMs: 1 }, 1);
    expect(runLabel(base, 'reader')).toEqual({ mode: 'lair', text: 'Adventure · Castle lair · boss beaten' });
    expect(runLabel({ ...base, bossWon: false, region: 'meadow' }, 'prereader').text).toBe('Adventure · Meadow lair · driven out');
    expect(MODE_NAMES.lair).toBe('Lair');
    expect(sessionModeOf(base, 'prereader')).toBe('lair');
  });
});
