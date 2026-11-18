/**
 * The curriculum entry point. Card data lives in modules/legacy.ts (times tables, multi-digit,
 * fractions) and in each module under modules/. The registry in modules/index.ts owns lookups.
 */
export * from './modules/legacy';
export { cardLabel, getCardDef } from './modules';
export type { CardDef, FactCardDef, SkillCardDef } from './modules';
