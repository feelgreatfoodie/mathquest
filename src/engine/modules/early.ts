import { ICON_IDS, choicesFor, pick, type Problem, type Rng } from '../problemBase';
import type { FactCardDef, GroupDef, ModuleDef, ModuleId } from './types';

/** Number words the voice reads. */
export const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const;
export const word = (n: number): string => WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "One, two, three." for n >= 1. */
function countWords(n: number): string {
  return cap(WORDS.slice(1, n + 1).join(', ')) + '.';
}

export const EARLY_BARS = { fastMs: 2000, slowMs: 6000 } as const;

function byTier(tier: (c: FactCardDef) => number, cmp: (p: FactCardDef, q: FactCardDef) => number) {
  return (p: FactCardDef, q: FactCardDef) => p.groupIndex - q.groupIndex || tier(p) - tier(q) || cmp(p, q);
}

function groupsOf(cards: FactCardDef[], labels: [string, string]): GroupDef[] {
  return [0, 1].map((i) => ({ id: `g${i + 1}`, label: labels[i]!, cardIds: cards.filter((c) => c.groupIndex === i).map((c) => c.id) }));
}

// ---- add10: one card per unordered pair a <= b with a + b <= 10 ----

export const addId = (a: number, b: number): string => `add:${Math.min(a, b)}+${Math.max(a, b)}`;

function buildAddCards(): FactCardDef[] {
  const out: FactCardDef[] = [];
  for (let a = 0; a <= 5; a++) {
    for (let b = a; a + b <= 10; b++) out.push({ kind: 'fact', id: addId(a, b), track: 'add10', a, b, groupIndex: a + b <= 5 ? 0 : 1 });
  }
  // G1: +0 and +1, then doubles, then the rest. G2: +1 and +2, doubles, the rest, then the pairs that make 10.
  const tier = (c: FactCardDef): number => {
    if (c.groupIndex === 0) return c.a <= 1 ? 0 : c.a === c.b ? 1 : 2;
    if (c.a + c.b === 10) return 3;
    return c.a === 1 || c.a === 2 ? 0 : c.a === c.b ? 1 : 2;
  };
  return out.sort(byTier(tier, (p, q) => p.a + p.b - (q.a + q.b) || p.a - q.a));
}

function addProblem(cardId: string, rng: Rng): Problem {
  const m = /^add:(\d+)\+(\d+)$/.exec(cardId);
  if (!m) throw new Error(`Unknown card ${cardId}`);
  const [a, b] = [Number(m[1]), Number(m[2])];
  const [x, y] = rng() < 0.5 ? [a, b] : [b, a];
  const sum = x + y;
  const icon = pick(rng, ICON_IDS);
  const speech = `${word(x)} plus ${word(y)}`;
  return {
    cardId,
    tokens: [{ t: 'num', v: x }, { t: 'op', v: '+' }, { t: 'num', v: y }],
    answer: { kind: 'int', value: sum },
    hint: `Let's count them all. ${sum ? countWords(sum) : 'There are none.'} ${cap(speech)} is ${word(sum)}.`,
    speech,
    visual: { kind: 'groups', op: '+', a: x, b: y, icon },
    choices: choicesFor(sum, 10, rng),
  };
}

export const addCards = buildAddCards();

// ---- sub10: one card per minuend a and subtrahend b, 0 <= b <= a <= 10 ----

export const subId = (a: number, b: number): string => `sub:${a}-${b}`;

function buildSubCards(): FactCardDef[] {
  const out: FactCardDef[] = [];
  for (let a = 0; a <= 10; a++) for (let b = 0; b <= a; b++) out.push({ kind: 'fact', id: subId(a, b), track: 'sub10', a, b, groupIndex: a <= 5 ? 0 : 1 });
  // Take away 0 or 1 first, then taking everything away, then the rest.
  const tier = (c: FactCardDef): number => (c.b <= 1 ? 0 : c.a === c.b ? 1 : 2);
  return out.sort(byTier(tier, (p, q) => p.a - q.a || p.b - q.b));
}

function subProblem(cardId: string, rng: Rng): Problem {
  const m = /^sub:(\d+)-(\d+)$/.exec(cardId);
  if (!m) throw new Error(`Unknown card ${cardId}`);
  const [a, b] = [Number(m[1]), Number(m[2])];
  const left = a - b;
  const icon = pick(rng, ICON_IDS);
  const speech = `${word(a)} minus ${word(b)}`;
  return {
    cardId,
    tokens: [{ t: 'num', v: a }, { t: 'op', v: '−' }, { t: 'num', v: b }],
    answer: { kind: 'int', value: left },
    hint: `Start with ${word(a)}. Take away ${word(b)}. ${left ? `Count what is left. ${countWords(left)}` : 'Nothing is left.'} ${cap(speech)} is ${word(left)}.`,
    speech,
    visual: { kind: 'groups', op: '−', a, b, icon },
    choices: choicesFor(left, 10, rng),
  };
}

export const subCards = buildSubCards();

function early(id: ModuleId, name: string, gradeBand: string, cards: FactCardDef[], labels: [string, string], generate: ModuleDef['generate']): ModuleDef {
  return {
    id,
    name,
    gradeBand,
    audience: 'prereader',
    status: 'live',
    cards,
    groups: groupsOf(cards, labels),
    generate,
    baseBars: () => ({ ...EARLY_BARS }),
    input: 'choices',
    presentation: 'visual-first',
  };
}

export const makeAdd10 = (): ModuleDef => early('add10', 'Addition within 10', 'K', addCards, ['Sums to 5', 'Sums 6 to 10'], addProblem);
export const makeSub10 = (): ModuleDef => early('sub10', 'Subtraction within 10', 'K–1', subCards, ['Start with 5 or less', 'Start with 6 to 10'], subProblem);
