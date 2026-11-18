import { SKILL_CARDS } from './legacy';
import { add, formatMixed, mulWhole, sub, toImproper, toMixed, type Frac, type Mixed } from '../fraction';
import { int, pick, type Answer, type Problem, type Rng, type Token } from '../problemBase';
import type { CardDef, ModuleDef } from './types';

const DENOMS = [3, 4, 5, 6, 8, 10, 12] as const;

const fracTok = (m: Mixed): Token => (m.w ? { t: 'frac', w: m.w, n: m.n, d: m.d } : { t: 'frac', n: m.n, d: m.d });

function mixedAnswer(f: Frac, requireProper: boolean): Answer {
  return { kind: 'mixed', value: toMixed(f), requireProper };
}

function fracBinary(cardId: string, a: Mixed, op: '+' | '−', b: Mixed, requireProper: boolean): Problem {
  const fa = toImproper(a);
  const fb = toImproper(b);
  const result = op === '+' ? add(fa, fb) : sub(fa, fb);
  const ans = toMixed(result);
  let hint: string;
  const hasWholes = a.w > 0 || b.w > 0;
  if (!hasWholes) {
    hint = `Same bottom, so ${op === '+' ? 'add' : 'subtract'} the tops: ${a.n} ${op} ${b.n} = ${op === '+' ? a.n + b.n : a.n - b.n}. The answer is ${formatMixed(ans)}.`;
  } else if (op === '+') {
    const rawN = a.n + b.n;
    hint = rawN >= a.d
      ? `Wholes: ${a.w} + ${b.w} = ${a.w + b.w}. Tops: ${a.n} + ${b.n} = ${rawN}, which is more than ${a.d}. Trade ${a.d}/${a.d} for 1 whole: ${formatMixed(ans)}.`
      : `Wholes: ${a.w} + ${b.w} = ${a.w + b.w}. Tops: ${a.n} + ${b.n} = ${rawN}. Answer: ${formatMixed(ans)}.`;
  } else {
    hint = a.n < b.n
      ? `${a.n}/${a.d} is too small to take away ${b.n}/${b.d}. Break 1 whole: ${a.w} ${a.n}/${a.d} = ${a.w - 1} ${a.n + a.d}/${a.d}. Then subtract: ${formatMixed(ans)}.`
      : `Wholes: ${a.w} − ${b.w} = ${a.w - b.w}. Tops: ${a.n} − ${b.n} = ${a.n - b.n}. Answer: ${formatMixed(ans)}.`;
  }
  return {
    cardId,
    tokens: [fracTok(a), { t: 'op', v: op }, fracTok(b)],
    answer: { kind: 'mixed', value: ans, requireProper },
    hint,
  };
}

function generate(cardId: string, rng: Rng): Problem {
  switch (cardId) {
    case 'fr:add': {
      const d = pick(rng, DENOMS);
      const n1 = int(rng, 1, d - 1);
      const n2 = int(rng, 1, d - n1);
      return fracBinary(cardId, { w: 0, n: n1, d }, '+', { w: 0, n: n2, d }, false);
    }
    case 'fr:sub': {
      const d = pick(rng, DENOMS);
      const n1 = int(rng, 2, d - 1);
      const n2 = int(rng, 1, n1 - 1);
      return fracBinary(cardId, { w: 0, n: n1, d }, '−', { w: 0, n: n2, d }, false);
    }
    case 'fr:madd': {
      const d = pick(rng, DENOMS);
      const n1 = int(rng, 1, d - 2);
      const n2 = int(rng, 1, d - 1 - n1);
      return fracBinary(cardId, { w: int(rng, 1, 4), n: n1, d }, '+', { w: int(rng, 1, 3), n: n2, d }, true);
    }
    case 'fr:msub': {
      const d = pick(rng, DENOMS);
      const n1 = int(rng, 2, d - 1);
      const n2 = int(rng, 1, n1 - 1);
      const w2 = int(rng, 1, 3);
      return fracBinary(cardId, { w: w2 + int(rng, 1, 3), n: n1, d }, '−', { w: w2, n: n2, d }, true);
    }
    case 'fr:maddr': {
      const d = pick(rng, DENOMS);
      const n1 = int(rng, 2, d - 1);
      const n2 = int(rng, d - n1 + 1, d - 1); // n1 + n2 > d, so the sum must regroup
      return fracBinary(cardId, { w: int(rng, 1, 4), n: n1, d }, '+', { w: int(rng, 1, 3), n: n2, d }, true);
    }
    case 'fr:msubr': {
      const d = pick(rng, DENOMS);
      const n1 = int(rng, 1, d - 2);
      const n2 = int(rng, n1 + 1, d - 1);
      const w2 = int(rng, 1, 2);
      return fracBinary(cardId, { w: w2 + int(rng, 1, 3), n: n1, d }, '−', { w: w2, n: n2, d }, true);
    }
    case 'fr:mulw': {
      const d = pick(rng, DENOMS);
      const k = int(rng, 2, Math.min(4, d - 1));
      const n = int(rng, 1, Math.floor((d - 1) / k));
      const f = mulWhole(k, { n, d });
      return {
        cardId,
        tokens: [{ t: 'num', v: k }, { t: 'op', v: '×' }, { t: 'frac', n, d }],
        answer: mixedAnswer(f, false),
        hint: `${k} groups of ${n}/${d}. Multiply the top: ${k} × ${n} = ${k * n}. The bottom stays: ${k * n}/${d}.`,
      };
    }
    case 'fr:mulwm': {
      let d: number, k: number, n: number;
      do {
        d = pick(rng, DENOMS);
        k = int(rng, 2, 6);
        n = int(rng, 1, d - 1);
      } while (k * n <= d || (k * n) % d === 0);
      const f = mulWhole(k, { n, d });
      const m = toMixed(f);
      return {
        cardId,
        tokens: [{ t: 'num', v: k }, { t: 'op', v: '×' }, { t: 'frac', n, d }],
        answer: mixedAnswer(f, true),
        hint: `${k} × ${n} = ${k * n}, so it is ${k * n}/${d}. Make wholes: ${k * n} ÷ ${d} = ${m.w} with ${m.n} left over. ${formatMixed(m)}.`,
      };
    }
    default:
      throw new Error(`No generator for ${cardId}`);
  }
}

export const FRACTIONS: ModuleDef = {
  id: 'fractions',
  name: 'Fractions',
  gradeBand: '3–5',
  audience: 'reader',
  status: 'live',
  cards: SKILL_CARDS.filter((c) => c.track === 'fractions'),
  generate,
  baseBars: (def: CardDef) => (def.kind === 'skill' ? { fastMs: def.fastMs, slowMs: def.slowMs } : { fastMs: 0, slowMs: 0 }),
  input: 'fraction',
  presentation: 'symbolic',
};
