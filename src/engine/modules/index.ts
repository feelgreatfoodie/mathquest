import { ADD10 } from './add10';
import { ADD20, BONDS10, DOUBLES, MISSING10 } from './early';
import { FACTS } from './facts';
import { FRACTIONS } from './fractions';
import { MULTIDIGIT } from './multidigit';
import { SUB10 } from './sub10';
import type { CardDef, ModuleDef, ModuleId } from './types';

export type { CardDef, FactCardDef, GroupDef, ModuleDef, ModuleId, SkillCardDef, Thresholds } from './types';
export { MODULE_IDS } from './types';

/** Registry order: grade order, pre-reader modules first. availableCards walks it in this order. */
export const MODULES: ModuleDef[] = [ADD10, SUB10, BONDS10, MISSING10, DOUBLES, ADD20, FACTS, MULTIDIGIT, FRACTIONS];

const BY_ID = new Map<ModuleId, ModuleDef>(MODULES.map((m) => [m.id, m]));
const CARDS = new Map<string, CardDef>(MODULES.flatMap((m) => m.cards.map((c) => [c.id, c] as const)));

const PREFIX: Record<string, ModuleId> = { mul: 'facts', md: 'multidigit', fr: 'fractions', add: 'add10', sub: 'sub10', bond: 'bonds10', miss: 'missing10', dbl: 'doubles', near: 'doubles', a20: 'add20' };

export function getModule(id: ModuleId): ModuleDef | undefined {
  return BY_ID.get(id);
}

/** The module a card belongs to, looked up by the id prefix (`mul:`, `md:`, `fr:`, `add:`, `sub:`). */
export function moduleOfCard(cardId: string): ModuleDef | undefined {
  const prefix = PREFIX[cardId.split(':')[0] ?? ''];
  return prefix ? BY_ID.get(prefix) : undefined;
}

export function getCardDef(id: string): CardDef | undefined {
  return CARDS.get(id);
}

/** Human label: "7 × 8" for facts, "3 + 2", "5 − 2", or the skill name for skills. */
export function cardLabel(id: string): string {
  const def = CARDS.get(id);
  if (!def) return id;
  if (def.kind === 'skill') return def.label;
  // A missing addend: "3 + ? = 10". b is the answer, so the total is a + b.
  if (def.track === 'bonds10' || def.track === 'missing10') return `${def.a} + ? = ${def.a + def.b}`;
  const op = def.track === 'sub10' ? '−' : def.track === 'facts' ? '×' : '+';
  return `${def.a} ${op} ${def.b}`;
}
