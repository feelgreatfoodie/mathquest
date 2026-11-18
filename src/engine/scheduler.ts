import { createEmptyCard, fsrs, generatorParameters, State, type Card, type Grade } from 'ts-fsrs';
import { dayKey } from './game';
import type { CardState, StoredFsrs } from './models';

/**
 * FSRS tuned for a kid's math facts:
 *  - 90% target retention, max interval 120 days (facts should resurface a few times a year).
 *  - short-term steps off: in-run repeats are handled by the session runner, and FSRS
 *    only sees the first graded attempt per card per run.
 */
const scheduler = fsrs(
  generatorParameters({
    request_retention: 0.9,
    maximum_interval: 120,
    enable_fuzz: true,
    enable_short_term: false,
  }),
);

const RECENT_KEEP = 6;

export function toStored(c: Card): StoredFsrs {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : null,
  };
}

export function fromStored(s: StoredFsrs): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as State,
    last_review: s.last_review == null ? undefined : new Date(s.last_review),
  };
}

export function newCardState(id: string, now: number): CardState {
  return {
    id,
    fsrs: toStored(createEmptyCard(new Date(now))),
    attempts: 0,
    correct: 0,
    recentMs: [],
    lastRating: 0,
    updatedAt: now,
  };
}

/** Applies one graded review. Pure: returns a new CardState. */
export function review(state: CardState, grade: Grade, ms: number, correct: boolean, now: number): CardState {
  const next = scheduler.next(fromStored(state.fsrs), new Date(now), grade);
  return {
    ...state,
    fsrs: toStored(next.card),
    attempts: state.attempts + 1,
    correct: state.correct + (correct ? 1 : 0),
    recentMs: correct ? [...state.recentMs, Math.round(ms)].slice(-RECENT_KEEP) : state.recentMs,
    lastRating: grade,
    updatedAt: now,
  };
}

/** Records an ungraded practice rep (in-run retry). Only timing stats change. */
export function practice(state: CardState, ms: number, correct: boolean, now: number): CardState {
  return {
    ...state,
    recentMs: correct ? [...state.recentMs, Math.round(ms)].slice(-RECENT_KEEP) : state.recentMs,
    updatedAt: now,
  };
}

export function isDue(state: CardState, now: number): boolean {
  return state.fsrs.reps > 0 && state.fsrs.due <= now;
}

const DAY_MS = 86_400_000;

/**
 * Probability (0–1) the kid still recalls the card right now. Elapsed time is fractional days.
 * ts-fsrs rounds it down to whole days, which made every card answered today read exactly 1 and tie.
 */
export function retrievability(state: CardState, now: number): number {
  if (state.fsrs.reps === 0 || state.fsrs.last_review == null) return 0;
  const days = Math.max(0, (now - state.fsrs.last_review) / DAY_MS);
  return scheduler.forgetting_curve(days, state.fsrs.stability);
}

/** How many counted answers the card has had today. */
export function gradedToday(state: CardState | undefined, now: number): number {
  return state && state.day === dayKey(now) ? (state.dayGraded ?? 0) : 0;
}

/**
 * Records a counted answer that is not the card's first of the day. FSRS fields stay byte-identical (only the first
 * answer of the day calls review()); the kid-facing counters move like a reviewed answer: attempts, correct, recentMs.
 * Chain noteGraded() after it for the last two outcomes and the day of a miss.
 */
export function repeatAnswer(state: CardState, ms: number, correct: boolean, now: number): CardState {
  return { ...practice(state, ms, correct, now), attempts: state.attempts + 1, correct: state.correct + (correct ? 1 : 0) };
}

/** Notes one counted answer on the card: today's count, the last two outcomes, the day of a miss. */
export function noteGraded(state: CardState, correct: boolean, now: number): CardState {
  const today = dayKey(now);
  return {
    ...state,
    day: today,
    dayGraded: (state.day === today ? (state.dayGraded ?? 0) : 0) + 1,
    lastResults: [...(state.lastResults ?? []), correct].slice(-2),
    ...(correct ? {} : { missDay: today }),
  };
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
