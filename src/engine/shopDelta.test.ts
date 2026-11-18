import { describe, expect, it } from 'vitest';
import { GameDeltaError, applyDelta } from './game';
import { DEFAULT_GAME, normalizeGame } from './models';
import { goalProgress, ownedItems, equippedOf } from '../game/shop/shopState';

const rich = { ...DEFAULT_GAME, gems: 200, xp: 100, bestCombo: 6 };

describe('buying an item', () => {
  it('spends the catalog price, adds the item and equips it in its slot', () => {
    const g = applyDelta(rich, { purchase: 'w-bow' });
    expect(g.gems).toBe(145);
    expect(g.items).toEqual(['w-bow']);
    expect(g.equipped).toEqual({ weapon: 'w-bow' });
    expect(g.hero).toBe('knight');
    expect(g.heroes).toEqual(['knight']);
  });
  it('a camp item or an adventure item is owned and equips nothing', () => {
    const g = applyDelta(applyDelta(rich, { purchase: 'c-tent' }), { purchase: 'a-lantern' });
    expect(g.items).toEqual(['c-tent', 'a-lantern']);
    expect(g.equipped ?? {}).toEqual({});
    expect(g.gems).toBe(200 - 30 - 60);
  });
  it('refuses a second buy, too few gems and an unknown id, and changes nothing', () => {
    const g = applyDelta(rich, { purchase: 'w-bow' });
    expect(() => applyDelta(g, { purchase: 'w-bow' })).toThrow(/already owned/);
    expect(() => applyDelta({ ...rich, gems: 54 }, { purchase: 'w-bow' })).toThrow(/Not enough gems/);
    expect(() => applyDelta(rich, { purchase: 'w-nope' })).toThrow(GameDeltaError);
  });
  it('buying the pinned goal clears the goal', () => {
    const g = applyDelta(applyDelta(rich, { goal: 'w-bow' }), { purchase: 'w-bow' });
    expect(g.goal).toBeUndefined();
  });
  it('keeps every hero, every item and every gem it did not spend (no clawback)', () => {
    const g = applyDelta(applyDelta(rich, { purchase: 'wizard' }), { purchase: 'g-helm' });
    expect(g.heroes).toEqual(['knight', 'wizard']);
    expect(g.gems).toBe(200 - 15 - 25);
  });
});

describe('equip and unequip', () => {
  const owned = applyDelta(applyDelta(rich, { purchase: 'w-bow' }), { purchase: 'w-sword' });
  it('equip needs an owned item and replaces the slot', () => {
    expect(owned.equipped).toEqual({ weapon: 'w-sword' });
    expect(applyDelta(owned, { equip: 'w-bow' }).equipped).toEqual({ weapon: 'w-bow' });
    expect(() => applyDelta(owned, { equip: 'w-hammer' })).toThrow(/not owned/);
  });
  it('a hero id still equips a hero and leaves the slots alone', () => {
    const g = applyDelta(applyDelta(owned, { purchase: 'wizard' }), { equip: 'knight' });
    expect(g.hero).toBe('knight');
    expect(g.equipped).toEqual({ weapon: 'w-sword' });
  });
  it('an item with no slot cannot be equipped', () => {
    const g = applyDelta(rich, { purchase: 'c-flag' });
    expect(() => applyDelta(g, { equip: 'c-flag' })).toThrow(GameDeltaError);
  });
  it('unequip empties a slot and keeps the item', () => {
    const g = applyDelta(owned, { unequip: 'weapon' });
    expect(g.equipped).toEqual({});
    expect(g.items).toEqual(['w-bow', 'w-sword']);
  });
});

describe('the savings goal', () => {
  it('pins a catalog item or hero, and clears with null', () => {
    expect(applyDelta(rich, { goal: 'p-owl' }).goal).toBe('p-owl');
    expect(applyDelta(rich, { goal: 'robot' }).goal).toBe('robot');
    expect(applyDelta(applyDelta(rich, { goal: 'p-owl' }), { goal: null }).goal).toBeUndefined();
    expect(() => applyDelta(rich, { goal: 'nothing' })).toThrow(GameDeltaError);
  });
  it('an owned item cannot be a goal', () => {
    const g = applyDelta(rich, { purchase: 'w-bow' });
    expect(() => applyDelta(g, { goal: 'w-bow' })).toThrow(GameDeltaError);
  });
  it('progress is gems over price, capped at 1, with the gems still needed', () => {
    expect(goalProgress({ ...rich, gems: 47, goal: 'w-bow' })).toEqual({ id: 'w-bow', cost: 55, have: 47, need: 8, fraction: 47 / 55, reached: false });
    expect(goalProgress({ ...rich, gems: 90, goal: 'w-bow' })).toMatchObject({ need: 0, fraction: 1, reached: true });
    expect(goalProgress(rich)).toBeNull();
    expect(goalProgress({ ...rich, goal: 'w-bow', items: ['w-bow'] })).toBeNull();
  });
});

describe('reading a stored game', () => {
  it('a game from before shop-2 reads with no items and nothing equipped', () => {
    const g = normalizeGame({ xp: 5, gems: 9, heroes: ['knight', 'wizard'], hero: 'wizard' });
    expect(ownedItems(g)).toEqual([]);
    expect(equippedOf(g)).toEqual({});
    expect(g.heroes).toEqual(['knight', 'wizard']);
  });
  it('keeps valid items, equipped slots and goal; drops junk', () => {
    const g = normalizeGame({ xp: 5, gems: 9, heroes: ['knight'], hero: 'knight', items: ['w-bow', 7], equipped: { weapon: 'w-bow', gear: 5, cape: 'x' }, goal: 'p-owl' });
    expect(ownedItems(g)).toEqual(['w-bow']);
    expect(equippedOf(g)).toEqual({ weapon: 'w-bow' });
    expect(g.goal).toBe('p-owl');
  });
});
