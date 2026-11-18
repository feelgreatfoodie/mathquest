import type { RunSummary } from '../../engine/session';
import type { SessionLog } from '../../engine/models';

// One Adventure trip = one session doc, sessions/{tripId}. The trip's identity and totals-so-far live on this device
// (world/main holds exactly 10 fields by rule, so they cannot go there) and in the session doc itself. A trip under
// 24 hours old that was not closed at the campfire resumes with the same id; otherwise a new one starts.

export const TRIP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Graded answers between checkpoints. */
export const CHECKPOINT_EVERY = 10;
const MISSED_MAX = 30;

/** Totals of the trip so far, over every open of it. */
export interface TripTotals {
  answered: number;
  graded: number;
  correct: number;
  fast: number;
  newLearned: number;
  xp: number;
  bestCombo: number;
  medianMs: number;
  missed: string[];
}

export interface TripState {
  tripId: string;
  startedAt: number;
  /** The last checkpoint number queued for this trip. The next is seq + 1. */
  seq: number;
  /** When the trip last changed. A trip older than TRIP_MAX_AGE_MS since `startedAt` does not resume. */
  updatedAt: number;
  finished: boolean;
  totals: TripTotals;
}

export const EMPTY_TOTALS: TripTotals = { answered: 0, graded: 0, correct: 0, fast: 0, newLearned: 0, xp: 0, bestCombo: 0, medianMs: 0, missed: [] };

const key = (kidId: string) => `mathquest:v1:trip:${kidId}`;

export function loadTrip(kidId: string): TripState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key(kidId)) ?? 'null') as Partial<TripState> | null;
    if (!raw || typeof raw.tripId !== 'string' || typeof raw.startedAt !== 'number' || typeof raw.seq !== 'number' || !raw.totals) return null;
    return { ...(raw as TripState), finished: raw.finished === true, updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : raw.startedAt, totals: { ...EMPTY_TOTALS, ...raw.totals } };
  } catch {
    return null;
  }
}

export function saveTrip(kidId: string, trip: TripState): void {
  try {
    localStorage.setItem(key(kidId), JSON.stringify(trip));
  } catch {
    // Not kept: the next open starts a new trip, and the session doc already holds what was credited.
  }
}

/**
 * The trip to play now. `resume` is the stored trip when it is open and under 24 h old. Otherwise a new trip starts, and
 * `close` is the stored trip when it was left open (expired): its session doc is closed as 'left'.
 */
export function resolveTrip(stored: TripState | null, now: number, newId: () => string): { trip: TripState; close: TripState | null } {
  if (stored && !stored.finished && now - stored.startedAt < TRIP_MAX_AGE_MS) return { trip: stored, close: null };
  const trip: TripState = { tripId: newId(), startedAt: now, seq: 0, updatedAt: now, finished: false, totals: EMPTY_TOTALS };
  return { trip, close: stored && !stored.finished ? stored : null };
}

/** The trip's totals after this open's runner: the totals at the start of the open plus the runner's own summary. */
export function addRun(base: TripTotals, run: RunSummary): TripTotals {
  return {
    answered: base.answered + run.answered,
    graded: base.graded + run.graded,
    correct: base.correct + run.correct,
    fast: base.fast + run.fast,
    newLearned: base.newLearned + run.newLearned,
    xp: base.xp + run.xp,
    bestCombo: Math.max(base.bestCombo, run.bestCombo),
    medianMs: run.medianMs || base.medianMs,
    missed: [...new Set([...base.missed, ...run.missed])].slice(0, MISSED_MAX),
  };
}

/** The session log a checkpoint writes: cumulative totals, mode 'overworld', open unless `finished`. */
export function tripLog(trip: Pick<TripState, 'tripId' | 'startedAt'>, t: TripTotals, now: number, region: string, end?: 'camp' | 'left'): SessionLog {
  return {
    id: trip.tripId,
    startedAt: trip.startedAt,
    endedAt: now,
    answered: t.answered,
    graded: t.graded,
    correct: t.correct,
    fast: t.fast,
    newLearned: t.newLearned,
    medianMs: t.medianMs,
    xp: t.xp,
    gems: 0,
    bestCombo: t.bestCombo,
    missed: t.missed,
    mode: 'overworld',
    region,
    finished: end === 'camp',
    ...(end ? { endedBy: end } : {}),
  };
}
