import { sessionModeOf, type Learner, type SessionLog, type SessionMode } from './models';

// How the parent area names a run: the mode, for Adventure the region and whether the trip is still open.

export const MODE_NAMES: Record<SessionMode, string> = { dungeon: 'Dungeon run', prereader: 'Picture run', overworld: 'Adventure' };

export interface RunLabel {
  mode: SessionMode;
  /** For example "Adventure · castle · 23 answers · in progress". Other modes: just the name. */
  text: string;
}

export function runLabel(log: SessionLog, learner: Learner): RunLabel {
  const mode = sessionModeOf(log, learner);
  if (mode !== 'overworld') return { mode, text: MODE_NAMES[mode] };
  const state = log.finished === true ? 'finished' : log.endedBy === 'left' ? 'left early' : 'in progress';
  const parts = ['Adventure', ...(log.region ? [log.region] : []), `${log.graded} ${log.graded === 1 ? 'answer' : 'answers'}`, state];
  return { mode, text: parts.join(' · ') };
}

/**
 * The counts line for a run that holds practice fill answers (ungraded, so the Questions column leaves them out).
 * A run with none of them returns null. An all-fill run reads "52 answers · 49 right · practice"; a mixed run reads
 * "30 graded · 27 right · 22 practice · 20 right". A log from before practiceCorrect reads as 0 right.
 */
export function fillLine(log: Pick<SessionLog, 'answered' | 'graded' | 'correct' | 'practiceCorrect'>): string | null {
  const fill = log.answered - log.graded;
  if (fill <= 0) return null;
  const right = log.practiceCorrect ?? 0;
  if (log.graded === 0) return `${log.answered} ${log.answered === 1 ? 'answer' : 'answers'} · ${right} right · practice`;
  return `${log.graded} graded · ${log.correct} right · ${fill} practice · ${right} right`;
}

const ORDER = ['meadow', 'forest', 'castle'];

/** One line about the kid's map, from world/main: how far they got, chests opened, bosses beaten. Null before the first Adventure save. */
export function adventureLine(world: { region?: unknown; openedChests?: unknown; bossesDefeated?: unknown } | null | undefined): string | null {
  if (!world) return null;
  const chests = Array.isArray(world.openedChests) ? world.openedChests.length : 0;
  const bosses = Array.isArray(world.bossesDefeated) ? world.bossesDefeated.length : 0;
  const here = ORDER.indexOf(String(world.region));
  // A beaten boss opens the next region, so the furthest region reached is at least one past the last boss.
  const reached = Math.max(here, Math.min(ORDER.length - 1, bosses), 0);
  return `Adventure: reached the ${ORDER[reached]}, ${chests} ${chests === 1 ? 'chest' : 'chests'} opened, ${bosses} of 3 bosses beaten.`;
}
