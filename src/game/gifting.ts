import { GameDeltaError } from '../engine/game';
import type { Family, GiftRecord, Kid, KidGame, PurchaseLog } from '../engine/models';
import { itemById } from './shop/catalog';
import { ownedItems } from './shop/shopState';

// Gifting (docs/pdr/item-powers.md, section 3). A kid buys a catalog item for a sibling in the same family. The giver pays the
// price through the one gift transaction, the item joins the receiver's owned list with giftFrom, and a purchases record on the
// giver plus a gift record on the receiver ride in that same write. No gem is created: the giver's gems drop by the price and
// nothing rises. Pure functions here; the repos run the transaction and firestore.rules hold the same limits.

/** Gifting is on unless a grown-up turned it off. A family doc from before the setting reads as on. */
export function giftingOn(family: Pick<Family, 'gifting'> | null | undefined): boolean {
  return family?.gifting !== false;
}

/** Why this gift cannot be made, in a sentence a kid can read, or null when it can. Items only: a hero is never a gift. */
export function giftProblem(giver: Pick<Kid, 'id' | 'game'>, receiver: Pick<Kid, 'id' | 'game'>, itemId: string): string | null {
  const item = itemById(itemId);
  if (!item) return 'That is not in the shop.';
  if (giver.id === receiver.id) return 'Pick a brother or sister.';
  if (ownedItems(receiver.game).includes(itemId)) return 'They already have that.';
  if (giver.game.gems < item.cost) return 'Not enough gems.';
  return null;
}

export interface GiftWrite {
  /** The giver after paying: gems down by the price, lastPurchaseId set. Nothing else changes. */
  giver: KidGame;
  /** The receiver after the gift: the item at the end of `items` and its giftFrom entry. Equipped and goal stay. */
  receiver: KidGame;
  /** The giver's purchases record. */
  entry: PurchaseLog;
  /** The receiver's gift record, unseen. */
  gift: GiftRecord;
}

/**
 * The four documents of one gift. Throws GameDeltaError when the gift is not allowed (giftProblem). `id` is the purchases doc id
 * and the gift doc id. Gems only drop: nothing here adds gems to anyone.
 */
export function buildGift(giver: Kid, receiver: Kid, itemId: string, id: string, at: number): GiftWrite {
  const problem = giftProblem(giver, receiver, itemId);
  if (problem) throw new GameDeltaError(problem);
  const cost = itemById(itemId)!.cost;
  // The stored list, unfiltered: an id this build does not know stays in the receiver's items.
  const items = receiver.game.items ?? [];
  return {
    giver: { ...giver.game, gems: giver.game.gems - cost, lastPurchaseId: id },
    receiver: { ...receiver.game, items: [...items, itemId], giftFrom: { ...(receiver.game.giftFrom ?? {}), [itemId]: giver.id } },
    entry: { id, kind: 'gift', to: receiver.id, itemId, cost, at },
    gift: { id, from: giver.id, itemId, at, seen: false },
  };
}

/** The gifts a kid has not opened, oldest first (the Home present opens them in the order they arrived). */
export function unseenGifts(gifts: readonly GiftRecord[]): GiftRecord[] {
  return gifts.filter((g) => !g.seen && !!itemById(g.itemId)).sort((a, b) => a.at - b.at);
}

/** The line on the present. Reads the giver's display name at run time, never a stored or typed name. */
export function giftHeadline(fromName: string): string {
  return `A gift from ${fromName}!`;
}

export interface GiftHistoryRow {
  id: string;
  at: number;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  itemId: string;
  itemName: string;
  cost: number;
}

/** The grown-up's gift history, newest first: every gift purchases record of the family's kids, with names. A record naming a kid or item that is gone still shows. */
export function giftHistory(kids: readonly Pick<Kid, 'id' | 'name'>[], purchases: Readonly<Record<string, readonly PurchaseLog[]>>): GiftHistoryRow[] {
  const nameOf = (id: string) => kids.find((k) => k.id === id)?.name ?? 'A player';
  const rows: GiftHistoryRow[] = [];
  for (const [from, logs] of Object.entries(purchases)) {
    for (const p of logs) {
      if (p.kind !== 'gift' || !p.to || !p.itemId) continue;
      rows.push({ id: p.id, at: p.at, from, fromName: nameOf(from), to: p.to, toName: nameOf(p.to), itemId: p.itemId, itemName: itemById(p.itemId)?.name ?? p.itemId, cost: p.cost });
    }
  }
  return rows.sort((a, b) => b.at - a.at);
}
