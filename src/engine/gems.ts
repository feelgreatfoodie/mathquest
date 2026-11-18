// Zero runtime imports from the app on purpose: the economy is one pure function the tests and the replay load alone.
import type { Learner } from './models';

/** The most one run can earn. firestore.rules (kidRaiseOk) refuses a kid write that raises gems by more. */
export const GEM_RUN_MAX = 10;

/** What a run reports to the economy. */
export interface GemRunStats {
  correct: number;
  graded: number;
  bestCombo: number;
  newLearned: number;
}

/** The parent settings the economy reads. A missing or invalid value reads as the default. */
export interface GemSettings {
  /** 0.5 (Slow), 1 (Normal) or 1.5 (Fast). Scales the base before the throttle. */
  gemSpeed?: number;
  /** Gems earned today at full rate. Half rate from here to twice this, a quarter after. Whole number, 1 to 100. */
  gemFullRate?: number;
}

export type GemTier = 'full' | 'half' | 'quarter';

export const GEM_SPEEDS = [0.5, 1, 1.5] as const;
export const GEM_FULL_RATE_DEFAULT: Record<Learner, number> = { reader: 25, prereader: 15 };
export const GEM_FULL_RATE_MAX = 100;
const TIER_RATE: Record<GemTier, number> = { full: 1, half: 0.5, quarter: 0.25 };

export function gemSpeedOf(settings: GemSettings | undefined | null): number {
  const s = settings?.gemSpeed;
  return s === 0.5 || s === 1.5 ? s : 1;
}

export function gemFullRateOf(learner: Learner, settings: GemSettings | undefined | null): number {
  const t = settings?.gemFullRate;
  if (typeof t !== 'number' || !Number.isFinite(t)) return GEM_FULL_RATE_DEFAULT[learner];
  const n = Math.round(t);
  return n >= 1 && n <= GEM_FULL_RATE_MAX ? n : GEM_FULL_RATE_DEFAULT[learner];
}

/** The tier a run starts in, from the gems earned so far today. */
export function gemTier(earnedToday: number, learner: Learner, settings: GemSettings | undefined | null): GemTier {
  const t = gemFullRateOf(learner, settings);
  return earnedToday < t ? 'full' : earnedToday < 2 * t ? 'half' : 'quarter';
}

/** Gems earned today from a stored game: the stored count only counts for the same local day (`day` is YYYY-MM-DD). */
export function earnedTodayOf(game: { gemsEarnedToday?: number; gemsDay?: string }, at: number): number {
  const d = new Date(at);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const n = game.gemsEarnedToday;
  return game.gemsDay === key && typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Gems before speed and throttle. Reader: 1 per 3 correct, +3 combo of 10, +2 for 3 new facts, +2 perfect. Pre-reader: 1 per 2 correct, +1 perfect. */
export function baseGems(stats: GemRunStats, learner: Learner): number {
  const perfect = stats.graded > 0 && stats.correct === stats.graded;
  if (learner === 'prereader') return Math.floor(stats.correct / 2) + (perfect ? 1 : 0);
  return Math.floor(stats.correct / 3) + (stats.bestCombo >= 10 ? 3 : 0) + (stats.newLearned >= 3 ? 2 : 0) + (perfect ? 2 : 0);
}

/**
 * The one place a run's gems are decided. base x Gem speed x tier rate, rounded down, at most GEM_RUN_MAX.
 * A run with 1 or more correct answers earns at least 1; a run with none earns 0. There is no hard cap:
 * the tier only slows the rate, and the kid sees no message about it. The tier is read from `earnedToday`
 * at the start of the run, so one run is never split across two rates.
 */
export function gemsForRun(stats: GemRunStats, learner: Learner, settings: GemSettings | undefined | null, earnedToday: number): number {
  if (stats.correct < 1) return 0;
  const rate = TIER_RATE[gemTier(earnedToday, learner, settings)];
  const raw = Math.floor(baseGems(stats, learner) * gemSpeedOf(settings) * rate + 1e-9);
  return Math.min(GEM_RUN_MAX, Math.max(1, raw));
}
