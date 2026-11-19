import type { CardState, SupportLevel } from './models';
import type { Problem } from './problemBase';

/**
 * The pre-reader fade: how much help one fact shows, kept on the card.
 *   dots     counting pictures. Two right answers in a row, without help, move the fact to numerals.
 *   numerals the numbers and 4 close choices. A Solid fact answered right without help moves to the pad.
 *   pad      a big 0 to 10 number pad: no choices to guess from.
 * A miss moves the fact down one step (numerals to dots, pad to numerals, with 2 right answers owed before the pad).
 * Help counts as a right answer with help: it never moves a fact up, and it sends the fact back to dots.
 */
export const SUPPORT_LEVELS: readonly SupportLevel[] = ['dots', 'numerals', 'pad'];

/** Right answers in a row, without help, that move a fact from dots to numerals. */
export const RUN_TO_NUMERALS = 2;
/** Right answers owed at numerals after a miss on the pad, before the fact can move up to the pad again. */
export const HOLD_AFTER_PAD_MISS = 2;
/** Pre-reader fluency target per fact. The summary marks a right answer under it, and the Lightning Round reads the same number. */
export const FLUENCY_TARGET_MS = 3000;

type Fade = Pick<CardState, 'supportLevel' | 'supportRun' | 'supportHold'>;

/** The support level of a card. A missing card, or a card from an old client with no value, reads as 'dots'. */
export function supportOf(card: Fade | undefined | null): SupportLevel {
  const s = card?.supportLevel;
  return s === 'numerals' || s === 'pad' ? s : 'dots';
}

export interface FadeAnswer {
  correct: boolean;
  /** The kid used help (a strategy cue or the dots) on this answer. */
  helped: boolean;
  /** The card is Solid after this answer (card level 3 or more). */
  solid: boolean;
  /** A preview of a locked group: it shows its hint first, so it says nothing about recall. */
  preview?: boolean;
}

/** The fade fields after one counted answer. Pure: callers spread the result onto the card. */
export function fadeStep(card: Fade | undefined | null, a: FadeAnswer): Required<Fade> {
  const level = supportOf(card);
  const run = Math.max(0, card?.supportRun ?? 0);
  const hold = Math.max(0, card?.supportHold ?? 0);
  const keep = { supportLevel: level, supportRun: run, supportHold: hold };
  if (a.preview) return keep;
  if (a.helped) return { supportLevel: 'dots', supportRun: 0, supportHold: 0 };
  if (!a.correct) {
    if (level === 'pad') return { supportLevel: 'numerals', supportRun: 0, supportHold: HOLD_AFTER_PAD_MISS };
    return { supportLevel: 'dots', supportRun: 0, supportHold: 0 };
  }
  if (level === 'dots') {
    return run + 1 >= RUN_TO_NUMERALS ? { supportLevel: 'numerals', supportRun: 0, supportHold: 0 } : { ...keep, supportRun: run + 1 };
  }
  if (level === 'numerals') {
    if (hold > 0) return { ...keep, supportRun: run + 1, supportHold: hold - 1 };
    return a.solid ? { supportLevel: 'pad', supportRun: 0, supportHold: 0 } : { ...keep, supportRun: run + 1 };
  }
  return { ...keep, supportRun: run + 1 };
}

// ---- strategy cues ----

export type CueKind = 'double' | 'counton' | 'make10';

export interface StrategyCue {
  kind: CueKind;
  /** Short line shown on screen. */
  text: string;
  /** What the voice says. */
  speech: string;
  /** counton: the bigger number (shown as a numeral) and the smaller one (shown as dots). */
  big?: number;
  small?: number;
}

/**
 * A strategy for this addition, shown instead of full dots (and first in the help order, before the dots):
 *   doubles      "4 + 4, double!"
 *   make 10      a ten-frame with the gap highlighted, for sums of 9 and 10
 *   count on     the bigger number as a numeral, dots only for the smaller one (smaller 1 to 3, bigger 4 or more)
 * Subtraction has none. Returns null when no strategy fits.
 */
export function strategyCue(p: Pick<Problem, 'visual'>): StrategyCue | null {
  const v = p.visual;
  if (!v || v.op !== '+') return null;
  const { a, b } = v;
  const big = Math.max(a, b);
  const small = Math.min(a, b);
  if (a === b && a >= 1) return { kind: 'double', text: `${a} + ${b}, double!`, speech: 'A double!' };
  if (a + b === 9 || a + b === 10) return { kind: 'make10', text: 'Make 10!', speech: 'Fill up the ten frame.' };
  if (big >= 4 && small >= 1 && small <= 3) return { kind: 'counton', text: `Start at ${big}`, speech: `Start at ${big}. Count on ${small}.`, big, small };
  return null;
}
