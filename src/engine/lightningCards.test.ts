import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Learner, type KidSettings } from './models';
import { LightningRound, lightningCard, type LightningCard } from './lightning';
import { MODULES, getCardDef } from './modules';
import { answerText, mulberry32 } from './problems';
import { MathView } from '../ui/MathView';
import { threeChoices } from '../game/modes/LightningMode.js';

// Every Lightning card, every module, both learner types: the prompt is the form the module shows elsewhere, and the answer is among the choices once.

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);
const LEARNERS: Learner[] = ['reader', 'prereader'];

/** The text a kid reads on the card, with the answer slot as "?". */
function promptText(tokens: Parameters<typeof MathView>[0]['tokens']): string {
  const html = renderToStaticMarkup(createElement(MathView, { tokens }));
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The form QuestionPanel shows for the same card, written from the card's own numbers. */
function canonical(cardId: string): RegExp | null {
  const def = getCardDef(cardId)!;
  if (def.kind !== 'fact') return null;
  if (def.track === 'bonds10') return new RegExp(`^${def.a} \\+ \\? = 10$`);
  if (def.track === 'missing10') return new RegExp(`^${def.a} \\+ \\? = ${def.a + def.b}$`);
  return null;
}

/** "L op R = S" with ? replaced by the answer must be a true sum, product or difference. */
function holds(text: string, answer: number): boolean {
  const m = /^(\S+) (\+|−|×) (\S+) = (\S+)$/.exec(text.replace(/\?/g, String(answer)));
  if (!m) return false;
  const [l, r, s] = [Number(m[1]), Number(m[3]), Number(m[4])];
  return (m[2] === '+' ? l + r : m[2] === '−' ? l - r : l * r) === s;
}

describe('Lightning cards, every module', () => {
  for (const learner of LEARNERS) {
    const settings: KidSettings = { ...DEFAULT_SETTINGS, learner };
    for (const mod of MODULES) {
      const cardIds = mod.cards.filter((c) => lightningCard(c.id, learner)).map((c) => c.id);
      if (!cardIds.length) continue;
      it(`${mod.id} / ${learner}: prompt, answer and 3 choices on ${cardIds.length} cards x ${SEEDS.length} seeds`, () => {
        const failures: string[] = [];
        for (const seed of SEEDS) {
          const round = new LightningRound({ cards: cardIds.map((cardId) => ({ cardId, target: false })), targets: [] }, {}, settings, mulberry32(seed));
          const queue = (round as unknown as { queue: LightningCard[] }).queue;
          for (const c of queue) {
            const p = c.problem;
            const text = promptText(p.tokens);
            const answer = p.answer.kind === 'int' ? p.answer.value : NaN;
            const want = canonical(c.cardId);
            if (want && !want.test(text)) failures.push(`${c.cardId} prompt "${text}" is not the module's form ${want}`);
            if (!want && !holds(text, answer)) failures.push(`${c.cardId} prompt "${text}" is not true with answer ${answerText(p)}`);
            if (learner === 'prereader') {
              const shown = threeChoices(p);
              if (shown.filter((v) => v === answer).length !== 1) failures.push(`${c.cardId} answer ${answer} not once in [${shown}]`);
              if (new Set(shown).size !== 3 || shown.some((v) => v < 0)) failures.push(`${c.cardId} choices [${shown}] are not 3 distinct non-negative`);
            }
          }
        }
        expect(failures).toEqual([]);
      });
    }
  }
});
