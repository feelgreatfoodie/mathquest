import { Rating, type Grade } from 'ts-fsrs';
import type { CardDef } from './content';
import type { CardMap } from './models';
import type { Verdict } from './problems';
import { median } from './scheduler';

export interface Thresholds {
  fastMs: number;
  slowMs: number;
}

const DEFAULT_FACT_BASELINE = 3500;
const MIN_SAMPLES = 12;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * The kid's typical correct-answer time on facts (ms), from recent answers.
 * Thresholds are relative to this, so the bar rises as the kid gets faster.
 */
export function factBaseline(cards: CardMap): number {
  const samples: number[] = [];
  for (const c of Object.values(cards)) if (c.id.startsWith('mul:')) samples.push(...c.recentMs);
  if (samples.length < MIN_SAMPLES) return DEFAULT_FACT_BASELINE;
  return median(samples.slice(-80));
}

/**
 * Facts: Easy means automatic recall. At pace 1 the fast bar never exceeds 3 s (the usual fluency
 * target) and tightens toward 1.5 s as the kid's own baseline drops. Pace multiplies all of it.
 */
export function factThresholds(baselineMs: number, pace: number): Thresholds {
  return {
    fastMs: clamp(baselineMs * 0.9 * pace, 1500 * pace, 3000 * pace),
    slowMs: clamp(baselineMs * 2.5 * pace, 5000 * pace, 9000 * pace),
  };
}

/**
 * The one place that turns a card and a pace into fast and slow bars. `pace` multiplies the bars
 * and the clamp bounds (3 = three times the time). Grading, the run summary, mastery levels and the
 * parent view all call this, so they agree. Callers pass `paceOf(kid.settings)`.
 */
export function thresholdsFor(def: CardDef, baselineMs: number, pace: number): Thresholds {
  return def.kind === 'fact'
    ? factThresholds(baselineMs, pace)
    : { fastMs: def.fastMs * pace, slowMs: def.slowMs * pace };
}

/**
 * wrong → Again; right amount but wrong form (e.g. 3 10/8) → Hard;
 * right and fast → Easy; right within the slow bar → Good; right but slow → Hard.
 */
export function gradeAnswer(verdict: Verdict, ms: number, th: Thresholds): Grade {
  if (verdict === 'wrong') return Rating.Again;
  if (verdict === 'almost') return Rating.Hard;
  if (ms <= th.fastMs) return Rating.Easy;
  if (ms <= th.slowMs) return Rating.Good;
  return Rating.Hard;
}
