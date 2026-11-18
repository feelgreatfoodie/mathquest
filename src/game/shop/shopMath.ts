import { HEROES, dayKey } from '../../engine/game';
import type { KidGame, Learner } from '../../engine/models';
import { ITEMS, itemById } from './catalog';
import { goalProgress, ownedItems, priceOf } from './shopState';

// Pure prompts for the shop math practice card. Nothing here reads a clock or writes anything: the card is practice,
// so it never touches a card or the schedule. The only write is the 1-gem tip (shopTip.ts).

export interface ShopMathPrompt {
  /** The item or hero the sum is about. */
  itemId: string;
  /** Where it came from: the pinned goal, or the cheapest thing the kid cannot afford yet. */
  source: 'goal' | 'cheapest';
  have: number;
  cost: number;
  /** The right answer: cost minus have. Always at least 1. */
  answer: number;
  /** Pre-reader only: the within-10 variant stands in for numbers over 10. False means the real numbers. */
  variant: boolean;
}

/** The cheapest hero or item the kid does not own and cannot afford, or null. Ties go to the lower id. */
export function cheapestUnaffordable(game: Pick<KidGame, 'gems' | 'items' | 'heroes'>): { id: string; cost: number } | null {
  const owned = new Set([...ownedItems(game), ...(game.heroes ?? [])]);
  const all = [...HEROES.map((h) => h.id), ...ITEMS.map((i) => i.id)];
  let best: { id: string; cost: number } | null = null;
  for (const id of all) {
    const cost = priceOf(id);
    if (cost === undefined || owned.has(id) || cost <= game.gems) continue;
    if (!best || cost < best.cost || (cost === best.cost && id < best.id)) best = { id, cost };
  }
  return best;
}

/** The target of the sum: the pinned goal while the gems fall short of it, else the cheapest thing out of reach. */
export function shopMathTarget(game: Pick<KidGame, 'goal' | 'gems' | 'items' | 'heroes'>): { id: string; source: 'goal' | 'cheapest'; have: number; cost: number } | null {
  const g = goalProgress(game);
  if (g && g.need > 0) return { id: g.id, source: 'goal', have: g.have, cost: g.cost };
  const c = cheapestUnaffordable(game);
  return c ? { id: c.id, source: 'cheapest', have: game.gems, cost: c.cost } : null;
}

/** A small seeded generator (mulberry32) so a pre-reader's prompt is the same all day. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The prompt for this kid now, or null when there is nothing out of reach to save for (no card then).
 * A reader gets the real numbers. A pre-reader gets the real numbers when the cost and the gap are both 10 or less,
 * else a within-10 variant picked from the day and the kid, so it does not change during the day.
 */
export function buildShopMath(game: Pick<KidGame, 'goal' | 'gems' | 'items' | 'heroes'>, learner: Learner, kidId: string, now: number): ShopMathPrompt | null {
  const t = shopMathTarget(game);
  return t ? promptFor(t, learner, kidId, now) : null;
}

/** The prompt for a known target (split out so the within-10 rule can be tested with prices the catalog does not have). */
export function promptFor(t: { id: string; source: 'goal' | 'cheapest'; have: number; cost: number }, learner: Learner, kidId: string, now: number): ShopMathPrompt {
  const need = t.cost - t.have;
  if (learner === 'reader' || (need <= 10 && t.cost <= 10)) return { itemId: t.id, source: t.source, have: t.have, cost: t.cost, answer: need, variant: false };
  const rnd = seededRandom(`${dayKey(now)}|${kidId}|shopmath`);
  const cost = 2 + Math.floor(rnd() * 9); // 2..10
  const have = 1 + Math.floor(rnd() * (cost - 1)); // 1..cost-1, so the gap is at least 1
  return { itemId: t.id, source: t.source, have, cost, answer: cost - have, variant: true };
}

/** Three distinct choices from 1 to 10 for a pre-reader, the answer among them, in a day-stable order. */
export function shopMathChoices(answer: number, kidId: string, now: number): number[] {
  const rnd = seededRandom(`${dayKey(now)}|${kidId}|choices|${answer}`);
  const pool = Array.from({ length: 10 }, (_, i) => i + 1).filter((n) => n !== answer);
  const picks = [answer];
  while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]!);
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [picks[i], picks[j]] = [picks[j]!, picks[i]!];
  }
  return picks;
}

/** What the reader card says. */
export function readerText(p: ShopMathPrompt): string {
  const name = itemById(p.itemId)?.name ?? HEROES.find((h) => h.id === p.itemId)?.name ?? p.itemId;
  return `You have ${p.have}. The ${name} costs ${p.cost}. How many more?`;
}

/** What the pre-reader card says (and the voice reads). */
export function prereaderText(p: ShopMathPrompt): string {
  return `You have ${p.have} dots. You need ${p.cost}. How many more?`;
}
