import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEROES } from '../../engine/game';
import { ITEM_SPRITES } from '../../ui/itemSprites';
import { EQUIP_SLOTS, ITEMS, TIER_BANDS, itemById, slotOf } from './catalog';

const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
function priceMap(fn: string): Record<string, number> {
  const body = new RegExp(`function ${fn}\\(\\) \\{\\s*return \\{([^}]*)\\};`).exec(rules);
  expect(body, `${fn} in firestore.rules`).not.toBeNull();
  const map: Record<string, number> = {};
  for (const m of body![1]!.matchAll(/'([a-z-]+)':\s*(\d+)/g)) map[m[1]!] = Number(m[2]);
  return map;
}

describe('the item catalog', () => {
  it('prices sit inside the tier bands (common 15-30, rare 50-90, epic 120-180, legendary 250-400)', () => {
    expect(TIER_BANDS).toEqual({ common: [15, 30], rare: [50, 90], epic: [120, 180], legendary: [250, 400] });
    for (const i of ITEMS) {
      const [lo, hi] = TIER_BANDS[i.tier];
      expect(i.cost, i.id).toBeGreaterThanOrEqual(lo);
      expect(i.cost, i.id).toBeLessThanOrEqual(hi);
    }
  });
  it('has every category and every tier', () => {
    expect(new Set(ITEMS.map((i) => i.category))).toEqual(new Set(['weapon', 'gear', 'pet', 'adventure', 'camp', 'legendary']));
    expect(new Set(ITEMS.map((i) => i.tier))).toEqual(new Set(['common', 'rare', 'epic', 'legendary']));
    expect(ITEMS.filter((i) => i.category === 'legendary').every((i) => i.tier === 'legendary')).toBe(true);
  });
  it('ids are unique, never a hero id, and a slot is the id prefix', () => {
    const ids = ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const h of HEROES) expect(ids).not.toContain(h.id);
    const prefix: Record<string, string> = { weapon: 'w-', gear: 'g-', pet: 'p-' };
    for (const i of ITEMS) {
      if (i.slot) expect(i.id.startsWith(prefix[i.slot]!), i.id).toBe(true);
      else expect(i.id).toMatch(/^[ac]-/);
      expect(slotOf(i.id)).toBe(i.slot ?? null);
    }
    expect(EQUIP_SLOTS).toEqual(['weapon', 'gear', 'pet']);
  });
  it('weapons, gear and pets have a slot; adventure and camp have none; no random or timed fields', () => {
    for (const i of ITEMS) {
      expect(Boolean(i.slot), i.id).toBe(['weapon', 'gear', 'pet'].includes(i.category) || (i.category === 'legendary' && Boolean(i.slot)));
      if (i.category === 'adventure' || i.category === 'camp') expect(i.slot).toBeUndefined();
      expect(Object.keys(i).sort()).toEqual(['category', 'cost', 'id', 'name', ...(i.slot ? ['slot'] : []), 'tier'].sort());
    }
  });
  it('the 5 heroes keep their prices', () => {
    expect(HEROES.map((h) => [h.id, h.cost])).toEqual([['knight', 0], ['wizard', 15], ['ranger', 35], ['robot', 60], ['dragon', 100]]);
  });
  it('itemById finds an item and nothing else', () => {
    expect(itemById('w-bow')?.cost).toBe(55);
    expect(itemById('wizard')).toBeUndefined();
  });
});

describe('item art', () => {
  it('every item has a 12 by 12 sprite whose letters are all in its palette, and no sprite is orphaned', () => {
    expect(Object.keys(ITEM_SPRITES).sort()).toEqual(ITEMS.map((i) => i.id).sort());
    for (const [id, d] of Object.entries(ITEM_SPRITES)) {
      expect(d.rows, id).toHaveLength(12);
      for (const r of d.rows) {
        expect(r, id).toHaveLength(12);
        for (const ch of r) if (ch !== '.') expect(d.palette[ch], `${id} uses ${ch}`).toBeDefined();
      }
    }
  });
});

describe('the price maps in firestore.rules', () => {
  it('itemPrices lists every catalog item at its price and nothing else', () => {
    expect(priceMap('itemPrices')).toEqual(Object.fromEntries(ITEMS.map((i) => [i.id, i.cost])));
  });
  it('heroPrices still lists the 5 heroes at their prices', () => {
    expect(priceMap('heroPrices')).toEqual(Object.fromEntries(HEROES.map((h) => [h.id, h.cost])));
  });
});
