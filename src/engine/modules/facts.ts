import { FACT_CARDS, FACT_GROUPS, factStrategy } from './legacy';
import type { Problem, Rng } from '../problemBase';
import type { CardDef, FactCardDef, ModuleDef, Thresholds } from './types';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

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

const BY_ID = new Map<string, FactCardDef>(FACT_CARDS.map((c) => [c.id, c]));

function factProblem(cardId: string, a: number, b: number, rng: Rng): Problem {
  const [x, y] = rng() < 0.5 ? [a, b] : [b, a];
  return {
    cardId,
    tokens: [{ t: 'num', v: x }, { t: 'op', v: '×' }, { t: 'num', v: y }],
    answer: { kind: 'int', value: x * y },
    hint: factStrategy(a, b),
  };
}

export const FACTS: ModuleDef = {
  id: 'facts',
  name: 'Times tables',
  gradeBand: '3–5',
  audience: 'reader',
  status: 'live',
  cards: FACT_CARDS,
  groups: FACT_GROUPS.map((g, i) => ({ id: g.id, label: g.label, cardIds: FACT_CARDS.filter((c) => c.groupIndex === i).map((c) => c.id) })),
  generate(cardId, rng) {
    const def = BY_ID.get(cardId);
    if (!def) throw new Error(`Unknown card ${cardId}`);
    return factProblem(cardId, def.a, def.b, rng);
  },
  baseBars: (_def: CardDef, { baselineMs }) => factThresholds(baselineMs, 1),
  input: 'keypad',
  presentation: 'symbolic',
};
