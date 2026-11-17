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
 * Facts: Easy means automatic recall. The fast bar never exceeds 3 s (the usual fluency target)
 * and tightens toward 1.5 s as the kid's own baseline drops.
 */
export function factThresholds(baselineMs: number): Thresholds {
  return {
    fastMs: clamp(baselineMs * 0.9, 1500, 3000),
    slowMs: clamp(baselineMs * 2.5, 5000, 9000),
  };
}

export function thresholdsFor(def: CardDef, baselineMs: number): Thresholds {
  return def.kind === 'fact' ? factThresholds(baselineMs) : { fastMs: def.fastMs, slowMs: def.slowMs };
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
