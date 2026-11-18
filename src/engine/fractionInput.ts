// Fraction entry rules (UX review item 7). Zero imports from the app on purpose: plain tests load it alone.

export interface Mixed3 {
  w: string;
  n: string;
  d: string;
}
export type FracField = 'w' | 'n' | 'd';

/** Families whose answer is always a proper fraction (never a whole or a mixed number): the Whole box is hidden. */
const PROPER_ONLY = new Set(['fr:sub', 'fr:mulw']);

/** True when the card's answer can be a whole or mixed number, so the Whole box is worth showing. */
export function wholeAllowed(cardId: string): boolean {
  return !PROPER_ONLY.has(cardId);
}

export type GoStep = { kind: 'none' } | { kind: 'field'; field: FracField } | { kind: 'submit' };

/**
 * What GO does: with nothing typed, nothing. With only a whole typed, submit it (a whole-number answer). Otherwise jump to
 * the first empty of Top and Bottom, and submit once both are filled (Whole is optional).
 */
export function goAction(m: Mixed3): GoStep {
  if (m.w === '' && m.n === '' && m.d === '') return { kind: 'none' };
  if (m.n === '' && m.d === '') return m.w !== '' ? { kind: 'submit' } : { kind: 'none' };
  if (m.n === '') return { kind: 'field', field: 'n' };
  if (m.d === '') return { kind: 'field', field: 'd' };
  return { kind: 'submit' };
}
