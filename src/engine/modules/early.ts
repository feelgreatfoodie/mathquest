import { CHOICE_MAX, ICON_IDS, closeChoices, pick, type Problem, type Rng } from '../problemBase';
import type { FactCardDef, GroupDef, ModuleDef, ModuleId } from './types';

/** Number words the voice reads. */
export const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
] as const;
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

function groupsOf(cards: FactCardDef[], labels: string[]): GroupDef[] {
  return labels.map((label, i) => ({ id: `g${i + 1}`, label, cardIds: cards.filter((c) => c.groupIndex === i).map((c) => c.id) }));
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
    // Common error: say the bigger number and stop.
    choices: closeChoices(sum, CHOICE_MAX, rng, Math.max(x, y)),
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
    // Common error: add instead of take away.
    choices: closeChoices(left, CHOICE_MAX, rng, a + b),
  };
}

export const subCards = buildSubCards();

// ---- bonds10: a + ? = 10, one card per addend a (0 to 10). b is the answer ----

export const bondId = (a: number): string => `bond:${a}`;

function buildBondCards(): FactCardDef[] {
  // Easy ones first: 10, 9 (one gap), 5 + 5, then 8, 7, 6. Then 4 or less, in order.
  const order = [10, 9, 5, 8, 7, 6, 0, 1, 2, 3, 4];
  return order.map((a) => ({ kind: 'fact', id: bondId(a), track: 'bonds10', a, b: 10 - a, groupIndex: a >= 5 ? 0 : 1 }));
}

/** The shared look of a missing-addend question: the ten-frame with `a` filled and the gap up to `total`. */
function gapProblem(cardId: string, a: number, total: number, rng: Rng, err: number): Problem {
  const ans = total - a;
  const icon = pick(rng, ICON_IDS);
  const speech = `${word(a)} plus what makes ${word(total)}`;
  return {
    cardId,
    tokens: [{ t: 'num', v: a }, { t: 'op', v: '+' }, { t: 'num', v: total }],
    answer: { kind: 'int', value: ans },
    hint: `Look at the gap in the ten frame. Count what is missing. ${ans ? countWords(ans) : 'Nothing is missing.'} ${cap(word(a))} plus ${word(ans)} makes ${word(total)}.`,
    speech,
    confirm: `${cap(word(a))} plus ${word(ans)} makes ${word(total)}`,
    visual: { kind: 'groups', op: '+', a, b: ans, icon },
    gap: { a, total },
    choices: closeChoices(ans, CHOICE_MAX, rng, err),
  };
}

function bondProblem(cardId: string, rng: Rng): Problem {
  const m = /^bond:(\d+)$/.exec(cardId);
  if (!m) throw new Error(`Unknown card ${cardId}`);
  // Common error: say the number you were shown.
  return gapProblem(cardId, Number(m[1]), 10, rng, Number(m[1]));
}

export const bondCards = buildBondCards();

// ---- missing10: a + ? = s within 10, one card per addend a and total s (1 <= a < s <= 10). b is the answer ----

export const missId = (a: number, s: number): string => `miss:${a}+_=${s}`;

function buildMissCards(): FactCardDef[] {
  const out: FactCardDef[] = [];
  for (let s = 2; s <= 10; s++) for (let a = 1; a < s; a++) out.push({ kind: 'fact', id: missId(a, s), track: 'missing10', a, b: s - a, groupIndex: s <= 5 ? 0 : 1 });
  // One missing first, then two missing, then the rest; smaller totals first.
  const tier = (c: FactCardDef): number => (c.b === 1 ? 0 : c.b === 2 ? 1 : 2);
  return out.sort(byTier(tier, (p, q) => p.a + p.b - (q.a + q.b) || p.a - q.a));
}

function missProblem(cardId: string, rng: Rng): Problem {
  const m = /^miss:(\d+)\+_=(\d+)$/.exec(cardId);
  if (!m) throw new Error(`Unknown card ${cardId}`);
  // Common error: say the total.
  return gapProblem(cardId, Number(m[1]), Number(m[2]), rng, Number(m[2]));
}

export const missCards = buildMissCards();

// ---- doubles: a + a for a = 1 to 10, then near doubles a + (a + 1) for a = 1 to 9 ----

export const dblId = (a: number): string => `dbl:${a}`;
export const nearId = (a: number): string => `near:${a}`;

function buildDoubleCards(): FactCardDef[] {
  const out: FactCardDef[] = [];
  for (let a = 1; a <= 10; a++) out.push({ kind: 'fact', id: dblId(a), track: 'doubles', a, b: a, groupIndex: a <= 5 ? 0 : 1 });
  for (let a = 1; a <= 9; a++) out.push({ kind: 'fact', id: nearId(a), track: 'doubles', a, b: a + 1, groupIndex: 2 });
  return out;
}

/** An addition shown with pictures, for sums up to 20. `strategy` picks the cue; `err` is the common wrong answer. */
function sumProblem(cardId: string, a: number, b: number, rng: Rng, strategy: NonNullable<Problem['strategy']>, hint: (sum: number) => string, err: (x: number, y: number, sum: number) => number): Problem {
  const [x, y] = rng() < 0.5 ? [a, b] : [b, a];
  const sum = x + y;
  const speech = `${word(x)} plus ${word(y)}`;
  return {
    cardId,
    tokens: [{ t: 'num', v: x }, { t: 'op', v: '+' }, { t: 'num', v: y }],
    answer: { kind: 'int', value: sum },
    hint: `${hint(sum)} ${cap(speech)} is ${word(sum)}.`,
    speech,
    strategy,
    visual: { kind: 'groups', op: '+', a: x, b: y, icon: pick(rng, ICON_IDS) },
    choices: closeChoices(sum, CHOICE_MAX, rng, err(x, y, sum)),
  };
}

function dblProblem(cardId: string, rng: Rng): Problem {
  const d = /^dbl:(\d+)$/.exec(cardId);
  if (d) {
    const a = Number(d[1]);
    return sumProblem(cardId, a, a, rng, 'double', (sum) => `A double: ${word(a)} and ${word(a)}. Count them all. ${countWords(sum)}`, (x) => x);
  }
  const n = /^near:(\d+)$/.exec(cardId);
  if (!n) throw new Error(`Unknown card ${cardId}`);
  const a = Number(n[1]);
  return sumProblem(cardId, a, a + 1, rng, 'neardouble', (sum) => `Double ${word(a)} is ${word(2 * a)}, and one more. Count them all. ${countWords(sum)}`, (x, y) => Math.max(x, y));
}

export const doubleCards = buildDoubleCards();

// ---- add20: a + b with a <= b <= 10 and a + b from 11 to 20, solved by making ten ----

export const add20Id = (a: number, b: number): string => `a20:${Math.min(a, b)}+${Math.max(a, b)}`;

function buildAdd20Cards(): FactCardDef[] {
  const out: FactCardDef[] = [];
  for (let b = 1; b <= 10; b++) for (let a = 1; a <= b; a++) if (a + b >= 11) out.push({ kind: 'fact', id: add20Id(a, b), track: 'add20', a, b, groupIndex: a + b <= 15 ? 0 : 1 });
  // 10 + n first (ten and some more), then by sum.
  const tier = (c: FactCardDef): number => (c.b === 10 ? 0 : 1);
  return out.sort(byTier(tier, (p, q) => p.a + p.b - (q.a + q.b) || p.a - q.a));
}

function add20Problem(cardId: string, rng: Rng): Problem {
  const m = /^a20:(\d+)\+(\d+)$/.exec(cardId);
  if (!m) throw new Error(`Unknown card ${cardId}`);
  const [a, b] = [Number(m[1]), Number(m[2])];
  const gap = 10 - b;
  const rest = a - gap;
  const hint = (sum: number) =>
    gap > 0 ? `Make ten first. ${cap(word(b))} plus ${word(gap)} is ten. Then ${word(rest)} more. ${cap(word(sum))}.` : `Ten and ${word(a)} more. ${cap(word(sum))}.`;
  // Common error: drop the ten.
  return sumProblem(cardId, a, b, rng, 'split10', hint, (_x, _y, sum) => sum - 10);
}

export const add20Cards = buildAdd20Cards();

function early(id: ModuleId, name: string, gradeBand: string, cards: FactCardDef[], labels: string[], generate: ModuleDef['generate'], opts: { padMax?: number; bars?: { fastMs: number; slowMs: number } } = {}): ModuleDef {
  return {
    id,
    name,
    gradeBand,
    audience: 'prereader',
    status: 'live',
    cards,
    groups: groupsOf(cards, labels),
    generate,
    baseBars: () => ({ ...(opts.bars ?? EARLY_BARS) }),
    input: 'choices',
    ...(opts.padMax ? { padMax: opts.padMax } : {}),
    presentation: 'visual-first',
  };
}

export const makeAdd10 = (): ModuleDef => early('add10', 'Addition within 10', 'K', addCards, ['Sums to 5', 'Sums 6 to 10'], addProblem);
export const makeSub10 = (): ModuleDef => early('sub10', 'Subtraction within 10', 'K–1', subCards, ['Start with 5 or less', 'Start with 6 to 10'], subProblem);

export const makeBonds10 = (): ModuleDef => early('bonds10', 'Make 10', 'K–1', bondCards, ['Make 10 from 5 or more', 'Make 10 from 4 or less'], bondProblem);
export const makeMissing10 = (): ModuleDef => early('missing10', 'Missing number within 10', 'K–1', missCards, ['Totals to 5', 'Totals 6 to 10'], missProblem);
export const makeDoubles = (): ModuleDef =>
  early('doubles', 'Doubles and near doubles', '1', doubleCards, ['Doubles to 5 + 5', 'Doubles to 10 + 10', 'Near doubles'], dblProblem, { padMax: 20 });
export const makeAdd20 = (): ModuleDef =>
  early('add20', 'Addition within 20', '1–2', add20Cards, ['Sums 11 to 15', 'Sums 16 to 20'], add20Problem, { padMax: 20, bars: { fastMs: 3000, slowMs: 9000 } });

export const BONDS10 = makeBonds10();
export const MISSING10 = makeMissing10();
export const DOUBLES = makeDoubles();
export const ADD20 = makeAdd20();
