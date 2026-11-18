import type { GameDelta } from './game';
import type { SessionLog } from './models';

// An Adventure trip is one session doc (sessions/{tripId}) that grows. Each checkpoint carries the trip's cumulative
// totals, so a lost or repeated checkpoint changes nothing: the doc keeps the larger counts and `xpCredited` names the XP
// already added to the kid's game. The repo runs this inside the transaction that reads the stored doc, so a replay or a
// crash can never add the same XP twice. Chest and boss gems are not here: they land through their own gemGrant.

/** The XP and counts a checkpoint adds to what the stored trip doc already holds. Null when the stored trip is closed. */
export function creditCheckpoint(
  stored: SessionLog | null,
  log: SessionLog,
  delta: GameDelta,
): { delta: GameDelta; session: Omit<SessionLog, 'gems'>; storedGems: number } | null {
  // A closed trip takes no more writes: finished never goes from true back to false, and a late repeat adds nothing.
  if (stored?.finished === true) return null;
  const credited = Math.max(0, stored?.xpCredited ?? 0);
  const earned = Math.max(0, delta.xp ?? 0);
  // The rules take at most 2000 XP in one write (XP_WRITE_MAX in data/outbox); any rest is credited by the next checkpoint.
  const xpDelta = Math.min(2000, Math.max(0, earned - credited));
  const grow = (a: number | undefined, b: number): number => Math.max(a ?? 0, b);
  const closes = log.finished === true;
  const { gems: _gems, ...rest } = log;
  const session: Omit<SessionLog, 'gems'> = {
    ...rest,
    startedAt: stored?.startedAt ?? log.startedAt,
    endedAt: grow(stored?.endedAt, log.endedAt),
    answered: grow(stored?.answered, log.answered),
    graded: grow(stored?.graded, log.graded),
    correct: grow(stored?.correct, log.correct),
    fast: grow(stored?.fast, log.fast),
    newLearned: grow(stored?.newLearned, log.newLearned),
    xp: grow(stored?.xp, log.xp),
    bestCombo: grow(stored?.bestCombo, log.bestCombo),
    mode: 'overworld',
    finished: closes,
    xpCredited: credited + xpDelta,
  };
  if (closes) session.endedBy = 'camp';
  else if (log.endedBy === 'left') session.endedBy = 'left';
  else delete session.endedBy;
  return { delta: { ...delta, xp: xpDelta }, session, storedGems: stored?.gems ?? 0 };
}
