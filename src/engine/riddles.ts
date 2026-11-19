import { getCardDef } from './modules';
import type { Problem, Rng } from './problemBase';
import { generateProblem } from './problems';

// A riddle chest is a short story around a fact the kid has already met. The templates are fixed: no generated text. The
// numbers and the answer come from the fact's own problem, so a riddle is never harder than the fact.

const ICON_WORD: Record<string, [string, string]> = {
  apple: ['apple', 'apples'],
  star: ['star', 'stars'],
  fish: ['fish', 'fish'],
  bug: ['bug', 'bugs'],
  dino: ['dino', 'dinos'],
};

const word = (icon: string, n: number) => ICON_WORD[icon]?.[n === 1 ? 0 : 1] ?? 'things';

/** The story for a problem shaped "a op b", or null when the problem has another shape (a fraction, a missing number). */
export function storyFor(p: Problem): string | null {
  const [a, op, b] = p.tokens;
  if (p.tokens.length !== 3 || a?.t !== 'num' || op?.t !== 'op' || b?.t !== 'num' || p.answer.kind !== 'int' || p.gap) return null;
  if (p.visual) {
    const ws = (n: number) => word(p.visual!.icon, n);
    return p.visual.op === '+' ? `${a.v} ${ws(a.v)} and ${b.v} more. How many ${ws(p.answer.value)}?` : `${a.v} ${ws(a.v)}, and ${b.v} go away. How many are left?`;
  }
  if (op.v === '×') return `A dragon has ${a.v} bags with ${b.v} gems in each. How many gems is that?`;
  if (op.v === '+') return `A knight finds ${a.v} coins, then ${b.v} more. How many coins now?`;
  return `A wizard has ${a.v} stars and gives away ${b.v}. How many stars are left?`;
}

/** A riddle problem for one of the kid's own fact cards, or null when that card has no story. */
export function riddleProblem(cardId: string, rng: Rng): Problem | null {
  if (getCardDef(cardId)?.kind !== 'fact') return null;
  const p = generateProblem(cardId, rng);
  const story = storyFor(p);
  if (!story) return null;
  // A pre-reader hears the story; what the voice says after a right answer keeps the plain sum.
  const confirm = p.confirm ?? (p.speech && p.answer.kind === 'int' ? `${p.speech} is ${p.answer.value}` : undefined);
  return { ...p, story, ...(p.visual ? { speech: story, ...(confirm ? { confirm } : {}) } : {}) };
}
