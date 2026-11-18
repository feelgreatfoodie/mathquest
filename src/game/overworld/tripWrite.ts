import type { GameDelta } from '../../engine/game';
import { noteDenied, putQuietly, removeQuietly, replayOutbox } from '../../data/outbox';
import type { Repo } from '../../data/repo';
import { reportFailure } from '../../ui/failures';
import { isSaveDenied } from '../../version';
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
