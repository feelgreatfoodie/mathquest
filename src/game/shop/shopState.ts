import { HEROES } from '../../engine/game';
import type { KidGame } from '../../engine/models';
import { EQUIP_SLOTS, itemById, slotOf, type EquipSlot } from './catalog';

// Pure readers of the shop fields on a game. A game from before shop-2 has none of them, so each reads as empty.

export function ownedItems(game: Pick<KidGame, 'items'>): string[] {
  return Array.isArray(game.items) ? game.items.filter((i) => itemById(i)) : [];
}

export function equippedOf(game: Pick<KidGame, 'equipped' | 'items'>): Partial<Record<EquipSlot, string>> {
  const out: Partial<Record<EquipSlot, string>> = {};
  const eq = game.equipped ?? {};
  for (const s of EQUIP_SLOTS) {
    const id = eq[s];
    if (typeof id === 'string' && slotOf(id) === s) out[s] = id;
  }
  return out;
}

/** The price of a hero or an item id, or undefined. */
export function priceOf(id: string): number | undefined {
  return itemById(id)?.cost ?? HEROES.find((h) => h.id === id)?.cost;
}

export interface GoalProgress {
  id: string;
  cost: number;
  have: number;
  need: number;
  fraction: number;
  reached: boolean;
}

/** The pinned goal and how far the gems go toward it. Null with no goal, an unknown goal or a goal already owned. */
export function goalProgress(game: Pick<KidGame, 'goal' | 'gems' | 'items' | 'heroes'>): GoalProgress | null {
  const id = game.goal;
  if (!id) return null;
  const cost = priceOf(id);
  if (cost === undefined || ownedItems(game).includes(id) || game.heroes?.includes(id)) return null;
  const have = game.gems;
  return { id, cost, have, need: Math.max(0, cost - have), fraction: Math.min(1, have / cost), reached: have >= cost };
}
