import { GameDeltaError } from '../engine/game';
import type { Family, Kid, KidGame, PurchaseLog } from '../engine/models';
import { isSellable, itemById, saleRefund, slotOf } from './shop/catalog';
import { ownedItems } from './shop/shopState';

// Selling back (docs/pdr/item-powers.md, section 4). A kid sells an owned shop item for half its catalog price, rounded down. One
// transaction writes the kid doc (gems up by the refund, the item gone from the owned list, its equipped slot cleared) and a sale
// record on purchases. Pure functions here; the repos run the transaction and firestore.rules hold the same limits.

/** Selling is on unless a grown-up turned it off. A family doc from before the setting reads as on. */
export function sellingOn(family: Pick<Family, 'selling'> | null | undefined): boolean {
  return family?.selling !== false;
}

/** A gifted item waits this many days after the gift before it can be sold (server time; firestore.rules saleGiftNotesOk and saleLockOk). */
export const GIFT_LOCK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days left before a gifted item can be sold (rounded up, at least 1), or 0 when it is not locked: not a gift, or the 7 days have passed.
 * A gift with no recorded time is never sellable, so it reads as the full lock; use `sellProblem` for the sentence.
 */
export function giftWaitDays(game: Pick<KidGame, 'giftFrom' | 'giftAt'>, itemId: string, now: number): number {
  const at = game.giftAt?.[itemId];
  // An item with a time but no giftFrom is one whose notes were stripped: the lock doc still holds it (see withLockTimes).
  if (!game.giftFrom?.[itemId] && typeof at !== 'number') return 0;
  if (typeof at !== 'number') return GIFT_LOCK_DAYS;
  const left = at + GIFT_LOCK_DAYS * DAY_MS - now;
  return left > 0 ? Math.max(1, Math.ceil(left / DAY_MS)) : 0;
}

/**
 * The kid with each gift lock's time read as giftAt, for an owned item whose own giftAt is missing. A lock is a gift lock doc
 * { itemId, giftId, at } (at a number or a Firestore Timestamp). The wait then reads the lock when both notes were stripped.
 */
export function withLockTimes(kid: Kid, locks: unknown[]): Kid {
  const owned = new Set(kid.game.items ?? []);
  const add: Record<string, number> = {};
  for (const l of locks) {
    const d = l as { itemId?: unknown; at?: unknown } | null;
    if (!d || typeof d.itemId !== 'string' || !owned.has(d.itemId) || kid.game.giftAt?.[d.itemId] !== undefined) continue;
    const t = d.at as { toMillis?: () => number } | number | null;
    const ms = typeof t === 'number' ? t : t && typeof t.toMillis === 'function' ? t.toMillis() : null;
    if (typeof ms === 'number' && Number.isFinite(ms)) add[d.itemId] = ms;
  }
  return Object.keys(add).length ? { ...kid, game: { ...kid.game, giftAt: { ...(kid.game.giftAt ?? {}), ...add } } } : kid;
}

/** True for a gifted item whose gift time is unknown: it never sells. */
export function giftTimeMissing(game: Pick<KidGame, 'giftFrom' | 'giftAt'>, itemId: string): boolean {
  return !!game.giftFrom?.[itemId] && typeof game.giftAt?.[itemId] !== 'number';
}

/** Why this item cannot be sold, in a sentence a kid can read, or null when it can. Items only: a hero is never sold. */
export function sellProblem(game: KidGame, itemId: string, now: number): string | null {
  if (!itemById(itemId)) return 'That is not in the shop.';
  if (!isSellable(itemId)) return 'Legendary items are yours to keep.';
  if (!ownedItems(game).includes(itemId)) return 'You do not have that.';
  if (giftTimeMissing(game, itemId)) return 'A gift cannot be sold.';
  const days = giftWaitDays(game, itemId, now);
  if (days > 0) return sellWaitText(days);
  return null;
}

/** "You can sell this in 3 days" for a gifted item inside its 7 days. */
export function sellWaitText(days: number): string {
  return `You can sell this in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The confirm question: "Sell the Bow for 27 gems?". */
export function sellQuestion(itemName: string, refund: number): string {
  return `Sell the ${itemName} for ${refund} ${refund === 1 ? 'gem' : 'gems'}?`;
}

export interface SaleWrite {
  /** The kid's game after the sale: gems up by the refund, lastPurchaseId set, the item gone from items, its slot cleared, its gift notes gone. Nothing else changes. */
  game: KidGame;
  /** The sale record: { id, kind: 'sale', itemId, refund, at } and nothing else. */
  entry: PurchaseLog;
  /** The equipped slot the sale cleared, or null. */
  clearedSlot: 'weapon' | 'gear' | 'pet' | null;
}

/**
 * The two documents of one sale. Throws GameDeltaError when the sale is not allowed (sellProblem). `id` is the purchases doc id.
 * The only gems it adds are the refund, and it leaves xp, heroes and the daily gem count alone.
 */
export function buildSale(kid: Pick<Kid, 'game'>, itemId: string, id: string, at: number, now: number = at): SaleWrite {
  const problem = sellProblem(kid.game, itemId, now);
  if (problem) throw new GameDeltaError(problem);
  const refund = saleRefund(itemId);
  const g = kid.game;
  // The stored list, unfiltered: an id this build does not know stays in the player's items.
  const items = (g.items ?? []).filter((i) => i !== itemId);
  const slot = slotOf(itemId);
  const clearedSlot = slot && g.equipped?.[slot] === itemId ? slot : null;
  const next: KidGame = { ...g, gems: g.gems + refund, lastPurchaseId: id, items };
  if (clearedSlot) {
    const { [clearedSlot]: _gone, ...rest } = g.equipped ?? {};
    if (Object.keys(rest).length) next.equipped = rest;
    else delete next.equipped;
  }
  if (g.giftFrom?.[itemId] !== undefined) {
    const { [itemId]: _f, ...rest } = g.giftFrom;
    if (Object.keys(rest).length) next.giftFrom = rest;
    else delete next.giftFrom;
  }
  if (g.giftAt?.[itemId] !== undefined) {
    const { [itemId]: _t, ...rest } = g.giftAt;
    if (Object.keys(rest).length) next.giftAt = rest;
    else delete next.giftAt;
  }
  return { game: next, entry: { id, kind: 'sale', itemId, refund, at }, clearedSlot };
}
