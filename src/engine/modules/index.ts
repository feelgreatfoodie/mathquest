import { ADD10 } from './add10';
import { FACTS } from './facts';
import { FRACTIONS } from './fractions';
import { MULTIDIGIT } from './multidigit';
import { SUB10 } from './sub10';
import type { CardDef, ModuleDef, ModuleId } from './types';

export type { CardDef, FactCardDef, GroupDef, ModuleDef, ModuleId, SkillCardDef, Thresholds } from './types';
export { MODULE_IDS } from './types';

/** Registry order: grade order, pre-reader modules first. availableCards walks it in this order. */
export const MODULES: ModuleDef[] = [ADD10, SUB10, FACTS, MULTIDIGIT, FRACTIONS];

const BY_ID = new Map<ModuleId, ModuleDef>(MODULES.map((m) => [m.id, m]));
const CARDS = new Map<string, CardDef>(MODULES.flatMap((m) => m.cards.map((c) => [c.id, c] as const)));

const PREFIX: Record<string, ModuleId> = { mul: 'facts', md: 'multidigit', fr: 'fractions', add: 'add10', sub: 'sub10' };

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
  const op = def.track === 'add10' ? '+' : def.track === 'sub10' ? '−' : '×';
  return `${def.a} ${op} ${def.b}`;
}
