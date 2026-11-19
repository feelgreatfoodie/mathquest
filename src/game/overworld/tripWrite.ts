import type { GameDelta } from '../../engine/game';
import { noteDenied, putQuietly, removeQuietly, replayOutbox } from '../../data/outbox';
import type { Repo } from '../../data/repo';
import { reportFailure } from '../../ui/failures';
import { isSaveDenied } from '../../version';
import type { SessionLog } from '../../engine/models';
import { BUILD } from '../../version';
import { saveTrip, tripLog, type TripState, type TripTotals } from './trip';

/**
 * Queues one checkpoint of an Adventure trip: the trip's cumulative totals go into the outbox first (save-first), then into
 * one transaction (applyGameDelta with `checkpoint`) that credits only the XP above what the stored session doc already holds.
 * A lost or repeated checkpoint changes nothing; the next one carries the totals. The returned promise settles when the write
 * and the outbox clean-up are done, and never rejects: a failed write is shown as a toast with Try again and stays in the outbox.
 */
export function queueCheckpoint(repo: Repo, kidId: string, trip: TripState, totals: TripTotals, region: string, end?: 'left', now = Date.now()): Promise<void> {
  trip.seq += 1;
  trip.updatedAt = now;
  trip.totals = totals;
  saveTrip(kidId, trip);
  const log = tripLog(trip, totals, now, region, end);
  const delta: GameDelta = { xp: totals.xp, bestCombo: totals.bestCombo, playedAt: now };
  const runId = `${trip.tripId}:${trip.seq}`;
  return (async () => {
    await putQuietly({ runId, kidId, sessionLog: log, gameDelta: delta, checkpoint: true, savedAt: now });
    try {
      await repo.applyGameDelta(kidId, delta, { session: log, checkpoint: true });
      await removeQuietly(runId);
    } catch (e) {
      if (isSaveDenied(e)) await noteDenied(runId);
      reportFailure('Your Adventure progress was not saved.', e, async () => {
        await replayOutbox(repo, kidId);
      });
    }
  })();
}

/** What one lair fight left behind: the region, whether the kid won, right answers and the time the clock ran. */
export interface LairResult {
  region: string;
  bossWon: boolean;
  bossCorrect: number;
  bossMs: number;
}

/** The small session log of one boss resolution: mode 'lair', every count 0 (the answers are already in the trip's log), xp 0. */
export function lairLog(trip: Pick<TripState, 'tripId'>, n: number, r: LairResult, now: number): SessionLog {
  return {
    id: `${trip.tripId}-lair${n}`,
    startedAt: now,
    endedAt: now,
    answered: 0,
    graded: 0,
    correct: 0,
    fast: 0,
    newLearned: 0,
    medianMs: 0,
    xp: 0,
    gems: 0,
    bestCombo: 0,
    missed: [],
    mode: 'lair',
    build: BUILD,
    region: r.region,
    bossWon: r.bossWon,
    bossCorrect: r.bossCorrect,
    bossMs: Math.max(0, Math.round(r.bossMs)),
  };
}

/**
 * Queues the log of one boss fight, through the same outbox path as a checkpoint: outbox first, then one applyGameDelta with
 * the log and a zero delta, then the outbox clean-up. The log id is `${tripId}-lair${n}` with n counted on the trip, so a
 * repeat of the same write finds the stored log and changes nothing. Never rejects; a failed write is a toast with Try again.
 * Gems for a win are not here: they go through the grant path like a chest.
 */
export function queueLairLog(repo: Repo, kidId: string, trip: TripState, r: LairResult, now = Date.now()): Promise<void> {
  trip.lairs = (trip.lairs ?? 0) + 1;
  trip.updatedAt = now;
  saveTrip(kidId, trip);
  const log = lairLog(trip, trip.lairs, r, now);
  const delta: GameDelta = { xp: 0 };
  const runId = log.id;
  return (async () => {
    await putQuietly({ runId, kidId, sessionLog: log, gameDelta: delta, savedAt: now });
    try {
      await repo.applyGameDelta(kidId, delta, { session: log });
      await removeQuietly(runId);
    } catch (e) {
      if (isSaveDenied(e)) await noteDenied(runId);
      reportFailure('Your boss fight was not saved.', e, async () => {
        await replayOutbox(repo, kidId);
      });
    }
  })();
}
