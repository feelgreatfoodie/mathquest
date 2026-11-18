import { SKILL_CARDS } from './legacy';
import { int, type Problem, type Rng } from '../problemBase';
import type { CardDef, ModuleDef } from './types';

function intProblem(cardId: string, x: number, y: number, hint: string): Problem {
  return {
    cardId,
    tokens: [{ t: 'num', v: x }, { t: 'op', v: '×' }, { t: 'num', v: y }],
    answer: { kind: 'int', value: x * y },
    hint,
  };
}

function areaHint(x: number, y: number): string {
  const tens = Math.floor(x / 10) * 10;
  const ones = x % 10;
  if (ones === 0) return `${tens / 10} × ${y} = ${(tens / 10) * y}, so ${x} × ${y} = ${x * y}.`;
  return `Split ${x} into ${tens} + ${ones}. ${tens} × ${y} = ${tens * y} and ${ones} × ${y} = ${ones * y}. Add: ${x * y}.`;
}

function area2Hint(x: number, y: number): string {
  const [xt, xo, yt, yo] = [Math.floor(x / 10) * 10, x % 10, Math.floor(y / 10) * 10, y % 10];
  return `(${xt} + ${xo}) × (${yt} + ${yo}): ${xt * yt} + ${xt * yo} + ${xo * yt} + ${xo * yo} = ${x * y}.`;
}

function generate(cardId: string, rng: Rng): Problem {
  switch (cardId) {
    case 'md:tens': {
      const x = int(rng, 2, 9) * 10;
      const y = int(rng, 2, 9);
      return intProblem(cardId, x, y, areaHint(x, y));
    }
    case 'md:2x1': {
      // No regrouping: every partial product stays a single digit.
      const y = int(rng, 2, 4);
      const t = int(rng, 1, Math.floor(9 / y));
      const o = int(rng, 1, Math.floor(9 / y));
      const x = t * 10 + o;
      return intProblem(cardId, x, y, areaHint(x, y));
    }
    case 'md:2x1r': {
      let x: number, y: number;
      do {
        x = int(rng, 13, 98);
        y = int(rng, 3, 9);
      } while ((x % 10) * y < 10 || x % 10 === 0);
      return intProblem(cardId, x, y, areaHint(x, y));
    }
    case 'md:2x2': {
      const x = int(rng, 11, 25);
      const y = int(rng, 11, 19);
      return intProblem(cardId, x, y, area2Hint(x, y));
    }
    default:
      throw new Error(`No generator for ${cardId}`);
  }
}

export const MULTIDIGIT: ModuleDef = {
  id: 'multidigit',
  name: 'Multi-digit multiplication',
  gradeBand: '3–5',
  audience: 'reader',
  status: 'live',
  cards: SKILL_CARDS.filter((c) => c.track === 'multidigit'),
  generate,
  baseBars: (def: CardDef) => (def.kind === 'skill' ? { fastMs: def.fastMs, slowMs: def.slowMs } : { fastMs: 0, slowMs: 0 }),
  input: 'keypad',
  presentation: 'symbolic',
};
