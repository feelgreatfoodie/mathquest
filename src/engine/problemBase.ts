import type { Mixed } from './fraction';

export type Rng = () => number;

/** Render tokens; the UI turns these into big readable math. */
export type Token =
  | { t: 'num'; v: number }
  | { t: 'op'; v: '×' | '+' | '−' | '=' }
  /** The empty slot of a missing-number form ("? × 8 = 56"). MathView draws the answer there instead of after the "=". */
  | { t: 'blank' }
  | { t: 'frac'; w?: number; n: number; d: number };

export type Answer =
  | { kind: 'int'; value: number }
  | { kind: 'mixed'; value: Mixed; requireProper: boolean };

export type IconId = 'apple' | 'star' | 'fish' | 'bug' | 'dino';
export const ICON_IDS: readonly IconId[] = ['apple', 'star', 'fish', 'bug', 'dino'];

/** Pictures for a pre-reader problem: `a` icons, the operator, then `b` icons (all the same icon). */
export interface Visual {
  kind: 'groups';
  op: '+' | '−';
  a: number;
  b: number;
  icon: IconId;
}

export interface Problem {
  cardId: string;
  tokens: Token[];
  answer: Answer;
  /** Shown after a miss, and on the "learn" card for new material. Pre-reader modules speak it. */
  hint: string;
  /** What the voice reads for the question, e.g. "three plus two". */
  speech?: string;
  visual?: Visual;
  /** Answer buttons for choice input, in display order. */
  choices?: number[];
  /**
   * A missing addend ("4 + ? = 7"): the ten-frame shows `a` filled and the gap up to `total`. The tokens are the addend and
   * the total, and the answer is the gap. Pre-reader modules bonds10 and missing10 only.
   */
  gap?: { a: number; total: number };
  /** Which strategy cue fits this fact. Absent: the add10 rules in support.ts decide from the pictures. */
  strategy?: 'double' | 'neardouble' | 'split10';
  /** A riddle chest's story, shown (and spoken for a pre-reader) above the question. Only riddle entries carry it. */
  story?: string;
  /** What the voice says after a right answer, instead of "<speech> is <answer>". */
  confirm?: string;
}

export type MixedInput = { w: number | null; n: number | null; d: number | null };
export type AnswerInput = { kind: 'int'; value: number | null } | { kind: 'mixed'; value: MixedInput };

/** correct | almost (right amount, wrong form) | wrong */
export type Verdict = 'correct' | 'almost' | 'wrong';

export function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)]!;
}

export function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * The tokens a flashcard draws. A gap problem ("4 + ? = 10") stores the addend and the total in `tokens`, and QuestionPanel draws
 * the ten-frame form itself, so a card that draws `tokens` bare would read "4 + 10 = ?" with the answer 6. Here the form is
 * spelled out: addend, plus, blank, equals, total. Every other problem draws its own tokens.
 */
export function promptTokens(p: Problem): Token[] {
  if (!p.gap) return p.tokens;
  return [{ t: 'num', v: p.gap.a }, { t: 'op', v: '+' }, { t: 'blank' }, { t: 'op', v: '=' }, { t: 'num', v: p.gap.total }];
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

/**
 * Three answer buttons: the answer plus its nearest neighbours in 0..max. The neighbours are
 * answer±1, then answer±2 when ±1 falls outside the range (answer 0 gives 0,1,2; answer 10 gives 8,9,10).
 * The order is shuffled with `rng`, so the same seed always gives the same buttons.
 */
export function choicesFor(answer: number, max: number, rng: Rng): number[] {
  if (!Number.isInteger(answer) || answer < 0 || answer > max || max < 2) throw new Error(`choicesFor(${answer}, ${max})`);
  const out = [answer];
  for (const d of [1, 2]) {
    for (const v of [answer - d, answer + d]) if (out.length < 3 && v >= 0 && v <= max && !out.includes(v)) out.push(v);
  }
  return shuffled(out, rng);
}

/** The most any pre-reader answer button or pad key shows. */
export const CHOICE_MAX = 20;

/**
 * Four answer buttons for a pre-reader: the answer, one common error, and the nearest of answer±1 and answer±2.
 * All four are distinct and in 0..max. The common error (the bigger addend for an addition, the sum for a
 * subtraction) goes in when it is in range and not the answer; answer±1 and ±2 fill the rest, in random order.
 * The positions are shuffled with `rng`, so the same seed always gives the same buttons.
 */
export function closeChoices(answer: number, max: number, rng: Rng, commonError?: number): number[] {
  if (!Number.isInteger(answer) || answer < 0 || answer > max || max < 3) throw new Error(`closeChoices(${answer}, ${max})`);
  const ok = (v: number) => Number.isInteger(v) && v >= 0 && v <= max && v !== answer;
  const out = [answer];
  if (commonError !== undefined && ok(commonError)) out.push(commonError);
  for (const v of shuffled([answer - 1, answer + 1, answer - 2, answer + 2], rng)) if (out.length < 4 && ok(v) && !out.includes(v)) out.push(v);
  // Answer 0 with the range cut short: widen outward until there are four.
  for (let d = 3; out.length < 4 && d <= max; d++) for (const v of [answer - d, answer + d]) if (out.length < 4 && ok(v) && !out.includes(v)) out.push(v);
  return shuffled(out, rng);
}
