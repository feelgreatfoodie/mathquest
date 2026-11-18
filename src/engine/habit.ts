import { dayKey } from './game';

// The habit display (UX review item 13): a weekly star chart is the main view, the streak is secondary and allows one
// free rest day per week. Both are worked out from the days the kid played (the session logs), so no stored field
// changes: the stored `streakDays` keeps its rules, and the screen never shows less than it.

const DAY = 86_400_000;
const parse = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12).getTime();
};
const shift = (key: string, days: number): string => dayKey(parse(key) + days * DAY);
/** Monday of the week that holds `key`. */
const weekStart = (key: string): string => {
  const dow = (new Date(parse(key)).getDay() + 6) % 7; // Monday is 0
  return shift(key, -dow);
};

export interface WeekDay {
  day: string;
  played: boolean;
  today: boolean;
}

/** Monday to Sunday of the week that holds `today`, with the days played marked. */
export function weekDays(played: readonly string[], today: string): WeekDay[] {
  const set = new Set(played);
  const mon = weekStart(today);
  return Array.from({ length: 7 }, (_, i) => {
    const day = shift(mon, i);
    return { day, played: set.has(day), today: day === today };
  });
}

/**
 * Days in a row ending today, or yesterday when today is not played yet. One missed day per week (Monday to Sunday)
 * is a free rest day and does not break the run; a second missed day in the same week does.
 */
export function streakWithRest(played: readonly string[], today: string): number {
  const set = new Set(played);
  let cursor = set.has(today) ? today : shift(today, -1);
  if (!set.has(cursor)) return 0;
  let n = 0;
  const rested = new Set<string>(); // the Monday of each week whose rest day is used
  for (let guard = 0; guard < 400; guard++) {
    if (set.has(cursor)) {
      n++;
    } else {
      const wk = weekStart(cursor);
      // A rest day only bridges to a played day: two empty days in a row end the run.
      if (rested.has(wk) || !set.has(shift(cursor, -1))) break;
      rested.add(wk);
    }
    cursor = shift(cursor, -1);
  }
  return n;
}

/** What home shows: the stored streak, or the longer run with a rest day. It never shows less than what was stored. */
export function displayStreak(stored: number, played: readonly string[], today: string): number {
  return Math.max(stored, streakWithRest(played, today));
}
