import type { Problem, Rng } from '../problemBase';

export type ModuleId =
  | 'add10' | 'sub10' // Phase 1
  | 'count10' | 'bonds10' | 'missing10' | 'doubles' // Phase 2
  | 'add20' | 'sub20' | 'add2d' | 'sub2d' // Phase 3
  | 'facts' | 'multidigit' | 'fractions'; // live, same ids as the old Track

/** Every id a settings doc may mention, in registry order. */
export const MODULE_IDS: readonly ModuleId[] = [
  'add10', 'sub10', 'count10', 'bonds10', 'missing10', 'doubles', 'add20', 'sub20', 'add2d', 'sub2d', 'facts', 'multidigit', 'fractions',
];

export type Audience = 'prereader' | 'reader' | 'any';
export type InputKind = 'choices' | 'keypad' | 'fraction';

export interface Thresholds {
  fastMs: number;
  slowMs: number;
}

/** A fixed-answer card: one per pair `a`, `b`. Built for fast recall. */
export interface FactCardDef {
  kind: 'fact';
  id: string;
  track: ModuleId;
  a: number;
  b: number;
  groupIndex: number;
}

/** One per problem family. Each review generates a fresh problem. */
export interface SkillCardDef {
  kind: 'skill';
  id: string;
  track: ModuleId;
  label: string;
  /** Card ids or group refs ("facts:g2") that must be solid first. */
  prereqs: string[];
  /** Response time (ms) at or under which a correct answer counts as Easy. */
  fastMs: number;
  /** Response time (ms) over which a correct answer counts as Hard. */
  slowMs: number;
  strategy: string;
}

export type CardDef = FactCardDef | SkillCardDef;

export interface GroupDef {
  id: string;
  label: string;
  cardIds: string[];
}

export interface ModuleDef {
  id: ModuleId;
  name: string;
  gradeBand: string;
  audience: Audience;
  status: 'live' | 'planned';
  /** Curriculum order. */
  cards: CardDef[];
  /** Fact-style unlock ladder: group n+1 opens when 80% of group n is in review. */
  groups?: GroupDef[];
  generate(cardId: string, rng: Rng): Problem;
  /** Bars before pace. Grading multiplies them by `paceOf()`. */
  baseBars(def: CardDef, ctx: { baselineMs: number }): Thresholds;
  input: InputKind;
  /** The biggest number key on the pad, once a fact of this module reaches the pad. A missing value reads as 10. */
  padMax?: number;
  presentation: 'symbolic' | 'visual-first';
}
