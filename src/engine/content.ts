/**
 * The curriculum: every reviewable "card" and the skill graph that gates it.
 *
 * Two kinds of cards:
 *  - fact cards: one per unordered pair a×b (0–12). Fixed answer, built for fast recall.
 *  - skill cards: one per problem family (e.g. "add mixed numbers with regrouping").
 *    Each review generates a fresh problem, so the kid practices the procedure, not one answer.
 */

export type Track = 'facts' | 'multidigit' | 'fractions';

export interface FactGroup {
  id: string;
  label: string;
  tables: number[];
}

/** Ordered easiest to hardest. A group unlocks when the previous one is mostly in review. */
export const FACT_GROUPS: FactGroup[] = [
  { id: 'g1', label: '0s, 1s, 2s, 5s, 10s', tables: [0, 1, 2, 5, 10] },
  { id: 'g2', label: '3s and 4s', tables: [3, 4] },
  { id: 'g3', label: '9s and 11s', tables: [9, 11] },
  { id: 'g4', label: '6s, 7s, 8s', tables: [6, 7, 8] },
  { id: 'g5', label: '12s', tables: [12] },
];

export interface FactCardDef {
  kind: 'fact';
  id: string;
  track: 'facts';
  a: number;
  b: number;
  groupIndex: number;
}

export interface SkillCardDef {
  kind: 'skill';
  id: string;
  track: Exclude<Track, 'facts'>;
  label: string;
  /** Card ids or fact group refs ("facts:g2") that must be solid first. */
  prereqs: string[];
  /** Response time (ms) at or under which a correct answer counts as Easy. */
  fastMs: number;
  /** Response time (ms) over which a correct answer counts as Hard. */
  slowMs: number;
  strategy: string;
}

export type CardDef = FactCardDef | SkillCardDef;

export function factId(a: number, b: number): string {
  const [x, y] = a <= b ? [a, b] : [b, a];
  return `mul:${x}x${y}`;
}

function groupIndexFor(a: number, b: number): number {
  const idx = FACT_GROUPS.findIndex((g) => g.tables.includes(a) || g.tables.includes(b));
  return idx === -1 ? FACT_GROUPS.length - 1 : idx;
}

function buildFactCards(): FactCardDef[] {
  const out: FactCardDef[] = [];
  for (let a = 0; a <= 12; a++) {
    for (let b = a; b <= 12; b++) {
      out.push({ kind: 'fact', id: factId(a, b), track: 'facts', a, b, groupIndex: groupIndexFor(a, b) });
    }
  }
  // Curriculum order: by group, then a fixed shuffle so a run mixes ×0 with ×5 and ×10
  // instead of opening with a dozen trivial facts in a row.
  const mix = (c: FactCardDef) => ((c.a * 31 + c.b * 17) * 2654435761) % 4294967296;
  return out.sort((p, q) => p.groupIndex - q.groupIndex || mix(p) - mix(q));
}

export const FACT_CARDS: FactCardDef[] = buildFactCards();

export const SKILL_CARDS: SkillCardDef[] = [
  {
    kind: 'skill', id: 'md:tens', track: 'multidigit', label: 'Tens × ones (30 × 6)',
    prereqs: ['facts:g2'], fastMs: 5000, slowMs: 14000,
    strategy: 'Multiply the small facts, then add a zero: 3 × 6 = 18, so 30 × 6 = 180.',
  },
  {
    kind: 'skill', id: 'md:2x1', track: 'multidigit', label: '2-digit × 1-digit (23 × 3)',
    prereqs: ['md:tens'], fastMs: 14000, slowMs: 40000,
    strategy: 'Area model: split 23 into 20 + 3. Multiply each part, then add.',
  },
  {
    kind: 'skill', id: 'md:2x1r', track: 'multidigit', label: '2-digit × 1-digit, bigger (47 × 6)',
    prereqs: ['md:2x1', 'facts:g4'], fastMs: 20000, slowMs: 55000,
    strategy: 'Split 47 into 40 + 7. 40 × 6 = 240 and 7 × 6 = 42. Add them: 282.',
  },
  {
    kind: 'skill', id: 'md:2x2', track: 'multidigit', label: '2-digit × 2-digit (12 × 15)',
    prereqs: ['md:2x1r'], fastMs: 40000, slowMs: 100000,
    strategy: 'Split both numbers. 12 × 15 = (10 + 2) × (10 + 5): add all four boxes.',
  },
  {
    kind: 'skill', id: 'fr:add', track: 'fractions', label: 'Add fractions, same bottom',
    prereqs: [], fastMs: 7000, slowMs: 20000,
    strategy: 'Same bottom? Add the tops. The bottom is the piece size, so it stays.',
  },
  {
    kind: 'skill', id: 'fr:sub', track: 'fractions', label: 'Subtract fractions, same bottom',
    prereqs: ['fr:add'], fastMs: 7000, slowMs: 20000,
    strategy: 'Same bottom? Subtract the tops. The bottom stays the same.',
  },
  {
    kind: 'skill', id: 'fr:madd', track: 'fractions', label: 'Add mixed numbers',
    prereqs: ['fr:sub'], fastMs: 10000, slowMs: 30000,
    strategy: 'Add the wholes. Add the fractions. Put them together.',
  },
  {
    kind: 'skill', id: 'fr:msub', track: 'fractions', label: 'Subtract mixed numbers',
    prereqs: ['fr:madd'], fastMs: 10000, slowMs: 30000,
    strategy: 'Subtract the wholes. Subtract the fractions. Put them together.',
  },
  {
    kind: 'skill', id: 'fr:maddr', track: 'fractions', label: 'Add mixed numbers with regrouping',
    prereqs: ['fr:msub'], fastMs: 15000, slowMs: 40000,
    strategy: 'If the top gets bigger than the bottom, trade it for 1 whole: 3 10/8 = 4 2/8.',
  },
  {
    kind: 'skill', id: 'fr:msubr', track: 'fractions', label: 'Subtract mixed numbers with regrouping',
    prereqs: ['fr:maddr'], fastMs: 18000, slowMs: 50000,
    strategy: 'Not enough on top? Break 1 whole into pieces: 3 1/6 = 2 7/6. Then subtract.',
  },
  {
    kind: 'skill', id: 'fr:mulw', track: 'fractions', label: 'Whole number × fraction',
    prereqs: ['fr:add', 'facts:g2'], fastMs: 8000, slowMs: 25000,
    strategy: '3 × 2/9 means 3 groups of 2/9. Multiply the top: 6/9. The bottom stays.',
  },
  {
    kind: 'skill', id: 'fr:mulwm', track: 'fractions', label: 'Whole × fraction, answer as a mixed number',
    prereqs: ['fr:mulw', 'fr:maddr'], fastMs: 14000, slowMs: 40000,
    strategy: '4 × 3/5 = 12/5. Make wholes: 12/5 = 2 2/5.',
  },
];

export const ALL_CARDS: CardDef[] = [...FACT_CARDS, ...SKILL_CARDS];

const BY_ID = new Map<string, CardDef>(ALL_CARDS.map((c) => [c.id, c]));

export function getCardDef(id: string): CardDef | undefined {
  return BY_ID.get(id);
}

/** Human label: "7 × 8" for facts, the skill name for skills. */
export function cardLabel(id: string): string {
  const def = BY_ID.get(id);
  if (!def) return id;
  return def.kind === 'fact' ? `${def.a} × ${def.b}` : def.label;
}

/** A short "how to think about it" tip for a multiplication fact. */
export function factStrategy(a: number, b: number): string {
  const [x, y] = a <= b ? [a, b] : [b, a];
  if (x === 0) return 'Anything times 0 is 0.';
  if (x === 1) return `Anything times 1 stays the same: ${y}.`;
  if (x === 2) return `Double it: ${y} + ${y} = ${2 * y}.`;
  if (x === 10 || y === 10) return `Times 10: put a zero on the end. ${x === 10 ? y : x} → ${x * y}.`;
  if (x === 5 || y === 5) {
    const o = x === 5 ? y : x;
    return `Half of 10 × ${o}: half of ${10 * o} is ${5 * o}.`;
  }
  if (y === 9 || x === 9) {
    const o = x === 9 ? y : x;
    return `Nines trick: 10 × ${o} = ${10 * o}, minus ${o} = ${9 * o}.`;
  }
  if ((x === 11 || y === 11) && Math.min(x, y) <= 9) {
    const o = x === 11 ? y : x;
    return `11 times a single digit repeats it: 11 × ${o} = ${11 * o}.`;
  }
  if (x === 4 || y === 4) {
    const o = x === 4 ? y : x;
    return `Double, then double again: ${o} → ${2 * o} → ${4 * o}.`;
  }
  if (x === 3 || y === 3) {
    const o = x === 3 ? y : x;
    return `2 × ${o} = ${2 * o}, plus one more ${o} = ${3 * o}.`;
  }
  if (y === 12) return `Break apart 12: 10 × ${x} = ${10 * x} and 2 × ${x} = ${2 * x}. Add: ${12 * x}.`;
  if (x === 8 || y === 8) {
    const o = x === 8 ? y : x;
    return `Double 4 × ${o}: 4 × ${o} = ${4 * o}, doubled is ${8 * o}.`;
  }
  // 6 and 7 combos
  return `Break it apart: ${y} × 5 = ${5 * y} and ${y} × ${x - 5} = ${y * (x - 5)}. Add: ${x * y}.`;
}
