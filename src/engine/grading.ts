import { Rating, type Grade } from 'ts-fsrs';
import { moduleOfCard, type CardDef } from './modules';
import { factThresholds } from './modules/facts';
import type { Thresholds } from './modules/types';
import type { CardMap } from './models';
import type { Verdict } from './problems';
import { median } from './scheduler';

export type { Thresholds };
export { factThresholds };

const DEFAULT_FACT_BASELINE = 3500;
const MIN_SAMPLES = 12;

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
 * The one place that turns a card and a pace into fast and slow bars. `pace` multiplies the bars
 * and the clamp bounds (3 = three times the time). Grading, the run summary, mastery levels and the
 * parent view all call this, so they agree. Callers pass `paceOf(kid.settings)`.
 */
export function thresholdsFor(def: CardDef, baselineMs: number, pace: number): Thresholds {
  const mod = moduleOfCard(def.id);
  if (!mod) throw new Error(`No module for card ${def.id}`);
  const base = mod.baseBars(def, { baselineMs });
  return { fastMs: base.fastMs * pace, slowMs: base.slowMs * pace };
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
