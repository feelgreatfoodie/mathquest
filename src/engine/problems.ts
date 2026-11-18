import { equalValue, formatMixed, isProperMixed, toImproper, type Mixed } from './fraction';
import { getCardDef, moduleOfCard } from './modules';
import type { AnswerInput, Problem, Rng, Verdict } from './problemBase';

export * from './problemBase';

/** Builds a fresh problem for a card, through the module that owns it. */
export function generateProblem(cardId: string, rng: Rng): Problem {
  const def = getCardDef(cardId);
  const mod = moduleOfCard(cardId);
  if (!def || !mod) throw new Error(`Unknown card ${cardId}`);
  return mod.generate(cardId, rng);
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
