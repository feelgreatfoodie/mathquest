import { lifetimeChests } from './chestLedger';
import type { RunSummary } from './session';
import { sessionModeOf, type Learner, type SessionLog, type SessionMode } from './models';

// How the parent area names a run: the mode, for Adventure the region and whether the trip is still open.

export const MODE_NAMES: Record<SessionMode, string> = { dungeon: 'Dungeon run', prereader: 'Picture run', overworld: 'Adventure', lightning: 'Lightning Round', lair: 'Lair' };

const REGION_TITLES: Record<string, string> = { meadow: 'Meadow', forest: 'Forest', castle: 'Castle' };

export interface RunLabel {
  mode: SessionMode;
  /** For example "Adventure · castle · 23 answers · in progress". Other modes: just the name. */
  text: string;
}

export function runLabel(log: SessionLog, learner: Learner): RunLabel {
  const mode = sessionModeOf(log, learner);
  if (mode === 'lair') {
    const where = log.region ? REGION_TITLES[log.region] ?? log.region : null;
    return { mode, text: ['Adventure', ...(where ? [`${where} lair`] : ['Lair']), log.bossWon ? 'boss beaten' : 'driven out'].join(' · ') };
  }
  if (mode !== 'overworld') return { mode, text: MODE_NAMES[mode] };
  const state = log.finished === true ? 'finished' : log.endedBy === 'left' ? 'left early' : 'in progress';
  const parts = ['Adventure', ...(log.region ? [log.region] : []), `${log.graded} ${log.graded === 1 ? 'answer' : 'answers'}`, state];
  return { mode, text: parts.join(' · ') };
}

/**
 * The parent-only note for an OLD log whose fill practice answers were kept out of `graded` (new runs count every answer).
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
  const chests = lifetimeChests(Array.isArray(world.openedChests) ? (world.openedChests as string[]) : []);
  const bosses = Array.isArray(world.bossesDefeated) ? world.bossesDefeated.length : 0;
  const here = ORDER.indexOf(String(world.region));
  // A beaten boss opens the next region, so the furthest region reached is at least one past the last boss.
  const reached = Math.max(here, Math.min(ORDER.length - 1, bosses), 0);
  return `Adventure: reached the ${ORDER[reached]}, ${chests} ${chests === 1 ? 'chest' : 'chests'} opened, ${bosses} of 3 bosses beaten.`;
}

/** The counts a kid's end screen shows for one run. */
export interface SummaryCounts {
  /** Right answers. A log from before every answer counted also adds its practice right. */
  right: number;
  /** Answers given, without in-run retries. A log from before every answer counted also adds its fill practice. Never 0 for a run with an answer. */
  total: number;
  graded: number;
  fill: number;
}

export function summaryCounts(s: Pick<RunSummary, 'answered' | 'graded' | 'correct' | 'practiceCorrect' | 'fillAnswered'>): SummaryCounts {
  const practiceRight = s.practiceCorrect ?? 0;
  // A trip saved before fillAnswered existed has practice answers but no count: the best guess is answers minus graded.
  const fill = s.fillAnswered ?? (practiceRight ? Math.max(practiceRight, s.answered - s.graded) : 0);
  const right = s.correct + practiceRight;
  const total = Math.max(s.graded + fill, right, s.answered > 0 && s.graded + fill === 0 ? s.answered : 0);
  return { right, total, graded: s.graded, fill };
}

/** True when the log was written by a bundle older than `live`. A log with no build is never old. */
export function isOldBuild(log: Pick<SessionLog, 'build'>, live: number): boolean {
  return typeof log.build === 'number' && Number.isFinite(log.build) && log.build < live;
}
