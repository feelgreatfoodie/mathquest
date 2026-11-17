import { factStrategy, getCardDef } from './content';
import { add, equalValue, formatMixed, isProperMixed, mulWhole, sub, toImproper, toMixed, type Frac, type Mixed } from './fraction';

export type Rng = () => number;

/** Render tokens; the UI turns these into big readable math. */
export type Token =
  | { t: 'num'; v: number }
  | { t: 'op'; v: '×' | '+' | '−' }
  | { t: 'frac'; w?: number; n: number; d: number };

export type Answer =
  | { kind: 'int'; value: number }
  | { kind: 'mixed'; value: Mixed; requireProper: boolean };

export interface Problem {
  cardId: string;
  tokens: Token[];
  answer: Answer;
  /** Shown after a miss, and on the "learn" card for new material. */
  hint: string;
}

export type MixedInput = { w: number | null; n: number | null; d: number | null };
export type AnswerInput = { kind: 'int'; value: number | null } | { kind: 'mixed'; value: MixedInput };

/** correct | almost (right amount, wrong form) | wrong */
export type Verdict = 'correct' | 'almost' | 'wrong';

export function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)]!;
}

/** Deterministic PRNG for tests and reproducible sessions. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DENOMS = [3, 4, 5, 6, 8, 10, 12] as const;

const fracTok = (m: Mixed): Token => (m.w ? { t: 'frac', w: m.w, n: m.n, d: m.d } : { t: 'frac', n: m.n, d: m.d });

function mixedAnswer(f: Frac, requireProper: boolean): Answer {
  return { kind: 'mixed', value: toMixed(f), requireProper };
}

function factProblem(cardId: string, a: number, b: number, rng: Rng): Problem {
  const [x, y] = rng() < 0.5 ? [a, b] : [b, a];
  return {
    cardId,
    tokens: [{ t: 'num', v: x }, { t: 'op', v: '×' }, { t: 'num', v: y }],
    answer: { kind: 'int', value: x * y },
    hint: factStrategy(a, b),
  };
}

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

/** Builds a fresh problem for a card. Fact cards always ask the same fact; skill cards vary. */
export function generateProblem(cardId: string, rng: Rng): Problem {
  const def = getCardDef(cardId);
  if (!def) throw new Error(`Unknown card ${cardId}`);
  if (def.kind === 'fact') return factProblem(cardId, def.a, def.b, rng);

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

export function checkAnswer(problem: Problem, input: AnswerInput): Verdict {
  const ans = problem.answer;
  if (ans.kind === 'int') {
    return input.kind === 'int' && input.value === ans.value ? 'correct' : 'wrong';
  }
  if (input.kind !== 'mixed') return 'wrong';
  const { w, n, d } = input.value;
  const whole = w ?? 0;
  const top = n ?? 0;
  // A bare whole number (no fraction typed) is fine when the answer is a whole number.
  const bottom = d ?? (top === 0 ? 1 : 0);
  if (bottom <= 0) return 'wrong';
  const given: Mixed = { w: whole, n: top, d: bottom };
  if (!equalValue(toImproper(given), toImproper(ans.value))) return 'wrong';
  if (ans.requireProper && !isProperMixed(given)) return 'almost';
  return 'correct';
}

export function answerText(problem: Problem): string {
  const a = problem.answer;
  return a.kind === 'int' ? String(a.value) : formatMixed(a.value);
}
