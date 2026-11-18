// The item catalog (shop-2). Zero imports on purpose: firestore.rules keeps a price map (itemPrices) that
// catalog.test.ts holds equal to ITEMS, and plain-Node scripts can load this file. Every price is fixed and shown
// up front. Nothing here is random, timed or on sale, and no item changes grading or help.
//
// An item id starts with its place: w- weapon, g- gear, p- pet, a- adventure, c- camp. The rules read the prefix to
// check that an equipped item fits its slot. The 5 heroes stay in HEROES (src/engine/game.ts) at their prices.

export type ItemCategory = 'weapon' | 'gear' | 'pet' | 'adventure' | 'camp' | 'legendary';
export type ItemTier = 'common' | 'rare' | 'epic' | 'legendary';
export type EquipSlot = 'weapon' | 'gear' | 'pet';

export interface ShopItem {
  id: string;
  name: string;
  category: ItemCategory;
  tier: ItemTier;
  cost: number;
  /** Where it is worn. Weapons, gear, pets and the legendary weapon and armor have one; adventure and camp items do not. */
  slot?: EquipSlot;
}

/** The price band of each tier (gems, inclusive). */
export const TIER_BANDS: Record<ItemTier, readonly [number, number]> = {
  common: [15, 30],
  rare: [50, 90],
  epic: [120, 180],
  legendary: [250, 400],
};

export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'gear', 'pet'];

export const ITEMS: readonly ShopItem[] = [
  { id: 'w-sword', name: 'Sword', category: 'weapon', tier: 'common', cost: 20, slot: 'weapon' },
  { id: 'w-wand', name: 'Magic Wand', category: 'weapon', tier: 'common', cost: 30, slot: 'weapon' },
  { id: 'w-bow', name: 'Bow', category: 'weapon', tier: 'rare', cost: 55, slot: 'weapon' },
  { id: 'w-hammer', name: 'Hammer', category: 'weapon', tier: 'rare', cost: 70, slot: 'weapon' },
  { id: 'w-boomerang', name: 'Boomerang', category: 'weapon', tier: 'rare', cost: 90, slot: 'weapon' },
  { id: 'g-cape', name: 'Cape', category: 'gear', tier: 'common', cost: 15, slot: 'gear' },
  { id: 'g-helm', name: 'Knight Helm', category: 'gear', tier: 'common', cost: 25, slot: 'gear' },
  { id: 'g-wizhat', name: 'Wizard Hat', category: 'gear', tier: 'common', cost: 30, slot: 'gear' },
  { id: 'g-dinohood', name: 'Dino Hood', category: 'gear', tier: 'rare', cost: 60, slot: 'gear' },
  { id: 'p-beetle', name: 'Beetle', category: 'pet', tier: 'rare', cost: 50, slot: 'pet' },
  { id: 'p-dog', name: 'Dog', category: 'pet', tier: 'rare', cost: 80, slot: 'pet' },
  { id: 'p-owl', name: 'Owl', category: 'pet', tier: 'epic', cost: 120, slot: 'pet' },
  { id: 'p-pup', name: 'Dragon Pup', category: 'pet', tier: 'epic', cost: 150, slot: 'pet' },
  { id: 'a-key', name: 'Key', category: 'adventure', tier: 'common', cost: 25 },
  { id: 'a-boots', name: 'Fast Boots', category: 'adventure', tier: 'rare', cost: 50 },
  { id: 'a-lantern', name: 'Lantern', category: 'adventure', tier: 'rare', cost: 60 },
  { id: 'a-bridge', name: 'Bridge Kit', category: 'adventure', tier: 'epic', cost: 120 },
  { id: 'c-flag', name: 'Flag', category: 'camp', tier: 'common', cost: 15 },
  { id: 'c-banner', name: 'Banner', category: 'camp', tier: 'common', cost: 20 },
  { id: 'c-tent', name: 'Tent', category: 'camp', tier: 'common', cost: 30 },
  { id: 'c-fire', name: 'Campfire', category: 'camp', tier: 'rare', cost: 55 },
  { id: 'g-goldarmor', name: 'Golden Dragon Armor', category: 'legendary', tier: 'legendary', cost: 300, slot: 'gear' },
  { id: 'w-crystalstaff', name: 'Crystal Staff', category: 'legendary', tier: 'legendary', cost: 350, slot: 'weapon' },
];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export function itemById(id: string): ShopItem | undefined {
  return BY_ID.get(id);
}

/** The slot an item id is worn in, or null (unknown id, or an item with no slot). */
export function slotOf(id: string): EquipSlot | null {
  return BY_ID.get(id)?.slot ?? null;
}
