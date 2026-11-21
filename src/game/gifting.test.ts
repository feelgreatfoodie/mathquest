import { describe, expect, it } from 'vitest';
import { GameDeltaError } from '../engine/game';
import { makeKid } from '../engine/newKid';
import { type GiftRecord, type Kid, type PurchaseLog } from '../engine/models';
import { buildGift, giftHeadline, giftHistory, giftingOn, giftProblem, unseenGifts } from './gifting';
import { ITEMS, itemById } from './shop/catalog';

// Gifting engine: item powers PDR, section 3. Every name is made up.
function kid(name: string, gems: number, items: string[] = []): Kid {
  const k = makeKid(name, 'reader');
  return { ...k, game: { ...k.game, gems, ...(items.length ? { items } : {}) } };
}
const BOW = itemById('w-bow')!;

describe('giftProblem', () => {
  it('passes for a catalog item the giver can pay and the receiver lacks', () => {
    expect(giftProblem(kid('Ada', 100), kid('Bo', 0), 'w-bow')).toBeNull();
  });
  it('refuses an id that is not in the shop, and a hero', () => {
    expect(giftProblem(kid('Ada', 999), kid('Bo', 0), 'w-excalibur')).toMatch(/not in the shop/);
    expect(giftProblem(kid('Ada', 999), kid('Bo', 0), 'dragon')).toMatch(/not in the shop/);
  });
  it('refuses when the receiver already owns the item', () => {
    expect(giftProblem(kid('Ada', 100), kid('Bo', 0, ['w-bow']), 'w-bow')).toMatch(/already have/);
  });
  it('refuses when the giver cannot pay the price', () => {
    expect(giftProblem(kid('Ada', BOW.cost - 1), kid('Bo', 0), 'w-bow')).toMatch(/Not enough gems/);
    expect(giftProblem(kid('Ada', BOW.cost), kid('Bo', 0), 'w-bow')).toBeNull();
  });
  it('refuses a gift to self', () => {
    const a = kid('Ada', 100);
    expect(giftProblem(a, a, 'w-bow')).toMatch(/brother or sister/);
  });
});

describe('buildGift', () => {
  const giver = kid('Ada', 100, ['c-flag']);
  const rcv = kid('Bo', 7, ['g-cape']);
  const w = buildGift(giver, rcv, 'w-bow', 'gift1', 5000);

  it('takes the price from the giver and nothing else', () => {
    expect(w.giver.gems).toBe(100 - BOW.cost);
    expect(w.giver.lastPurchaseId).toBe('gift1');
    expect(w.giver.items).toEqual(['c-flag']);
    expect(w.giver.xp).toBe(giver.game.xp);
  });
  it('adds the item to the receiver with giftFrom, and leaves their gems, equipped and goal', () => {
    expect(w.receiver.items).toEqual(['g-cape', 'w-bow']);
    expect(w.receiver.giftFrom).toEqual({ 'w-bow': giver.id });
    expect(w.receiver.gems).toBe(7);
    expect(w.receiver.equipped).toBeUndefined();
  });
  it('writes a purchase record on the giver and a gift record on the receiver, with the same id', () => {
    expect(w.entry).toEqual({ id: 'gift1', kind: 'gift', to: rcv.id, itemId: 'w-bow', cost: BOW.cost, at: 5000 });
    expect(w.gift).toEqual({ id: 'gift1', from: giver.id, itemId: 'w-bow', at: 5000, seen: false });
  });
  it('creates no gems: the family total drops by exactly the price', () => {
    expect(w.giver.gems + w.receiver.gems).toBe(giver.game.gems + rcv.game.gems - BOW.cost);
  });
  it('keeps an older giftFrom entry', () => {
    const r2 = { ...rcv, game: { ...rcv.game, items: ['w-sword'], giftFrom: { 'w-sword': 'someone' } } };
    expect(buildGift(giver, r2, 'w-bow', 'g2', 1).receiver.giftFrom).toEqual({ 'w-sword': 'someone', 'w-bow': giver.id });
  });
  it('keeps an item id this build does not know', () => {
    const r2 = { ...rcv, game: { ...rcv.game, items: ['x-future'] } };
    expect(buildGift(giver, r2, 'w-bow', 'g2', 1).receiver.items).toEqual(['x-future', 'w-bow']);
  });
  it('throws GameDeltaError when the gift is not allowed, for every item the catalog has', () => {
    for (const it of ITEMS) expect(() => buildGift(kid('Ada', it.cost - 1), kid('Bo', 0), it.id, 'g', 1)).toThrow(GameDeltaError);
    expect(() => buildGift(giver, kid('Bo', 0, ['w-bow']), 'w-bow', 'g', 1)).toThrow(GameDeltaError);
  });
  it('does not change its inputs', () => {
    const before = JSON.stringify([giver, rcv]);
    buildGift(giver, rcv, 'w-bow', 'g3', 1);
    expect(JSON.stringify([giver, rcv])).toBe(before);
  });
});

describe('the family switch', () => {
  it('reads as on when missing or true, off only when false', () => {
    expect(giftingOn(null)).toBe(true);
    expect(giftingOn({})).toBe(true);
    expect(giftingOn({ gifting: true })).toBe(true);
    expect(giftingOn({ gifting: false })).toBe(false);
  });
});

describe('the present on Home', () => {
  const g = (id: string, at: number, seen = false, itemId = 'w-bow'): GiftRecord => ({ id, from: 'a', itemId, at, seen });
  it('lists unseen gifts oldest first and skips seen ones and unknown items', () => {
    expect(unseenGifts([g('2', 20), g('1', 10), g('3', 30, true), g('4', 40, false, 'x-nothing')]).map((x) => x.id)).toEqual(['1', '2']);
  });
  it('says "A gift from <sibling>!" using the name it is given', () => {
    expect(giftHeadline('Casey')).toBe('A gift from Casey!');
  });
});

describe('the grown-up gift history', () => {
  const kids = [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bo' }];
  const logs: Record<string, PurchaseLog[]> = {
    a: [
      { id: 'p1', itemId: 'w-sword', cost: 20, at: 1 },
      { id: 'g1', kind: 'gift', to: 'b', itemId: 'w-bow', cost: 55, at: 30 },
    ],
    b: [{ id: 'g2', kind: 'gift', to: 'a', itemId: 'c-flag', cost: 15, at: 40 }],
  };
  it('lists only gift records, newest first, with names and item names', () => {
    const rows = giftHistory(kids, logs);
    expect(rows.map((r) => r.id)).toEqual(['g2', 'g1']);
    expect(rows[1]).toMatchObject({ fromName: 'Ada', toName: 'Bo', itemName: 'Bow', cost: 55 });
  });
  it('still lists a gift whose kid was removed', () => {
    expect(giftHistory([kids[0]!], logs).find((r) => r.id === 'g2')?.fromName).toBe('A player');
  });
});
