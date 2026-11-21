import { describe, expect, it } from 'vitest';
import { GameDeltaError } from '../engine/game';
import { makeKid } from '../engine/newKid';
import { normalizeGame, splitGame, type Kid } from '../engine/models';
import { GIFT_LOCK_DAYS, buildSale, giftTimeMissing, giftWaitDays, sellProblem, sellQuestion, sellWaitText, sellingOn } from './selling';

// Selling back (item powers PDR, section 4), pure parts. Every name is made up.
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 21, 12);
function kid(items: string[], extra: Partial<Kid['game']> = {}, gems = 100): Kid {
  const k = makeKid('Bo', 'reader');
  return { ...k, game: { ...k.game, gems, items, ...extra } };
}

describe('sellingOn', () => {
  it('is on unless a grown-up turned it off', () => {
    expect(sellingOn(null)).toBe(true);
    expect(sellingOn({})).toBe(true);
    expect(sellingOn({ selling: true })).toBe(true);
    expect(sellingOn({ selling: false })).toBe(false);
  });
});

describe('sellProblem', () => {
  it('null for an owned common, rare or epic item', () => {
    expect(sellProblem(kid(['w-sword']).game, 'w-sword', NOW)).toBeNull();
    expect(sellProblem(kid(['w-bow']).game, 'w-bow', NOW)).toBeNull();
    expect(sellProblem(kid(['p-owl']).game, 'p-owl', NOW)).toBeNull();
  });
  it('refuses a legendary item, an item that is not owned, a hero and an unknown id', () => {
    expect(sellProblem(kid(['g-goldarmor']).game, 'g-goldarmor', NOW)).toMatch(/Legendary/);
    expect(sellProblem(kid(['w-crystalstaff']).game, 'w-crystalstaff', NOW)).toMatch(/Legendary/);
    expect(sellProblem(kid(['w-sword']).game, 'w-bow', NOW)).toMatch(/do not have/);
    expect(sellProblem(kid([]).game, 'wizard', NOW)).toMatch(/not in the shop/);
    expect(sellProblem(kid([]).game, 'x-fake', NOW)).toMatch(/not in the shop/);
  });
  it('a gifted item waits 7 days after the gift, then sells', () => {
    const at = (days: number) => kid(['w-bow'], { giftFrom: { 'w-bow': 'kid-a' }, giftAt: { 'w-bow': NOW - days * DAY } }).game;
    expect(sellProblem(at(0), 'w-bow', NOW)).toBe('You can sell this in 7 days');
    expect(sellProblem(at(2), 'w-bow', NOW)).toBe('You can sell this in 5 days');
    expect(sellProblem(at(6.5), 'w-bow', NOW)).toBe('You can sell this in 1 day');
    expect(sellProblem(at(7), 'w-bow', NOW)).toBeNull();
    expect(sellProblem(at(30), 'w-bow', NOW)).toBeNull();
  });
  it('a gifted item with no gift time is never sellable', () => {
    const g = kid(['w-bow'], { giftFrom: { 'w-bow': 'kid-a' } }).game;
    expect(giftTimeMissing(g, 'w-bow')).toBe(true);
    expect(giftWaitDays(g, 'w-bow', NOW + 400 * DAY)).toBe(GIFT_LOCK_DAYS);
    expect(sellProblem(g, 'w-bow', NOW + 400 * DAY)).toMatch(/gift cannot be sold/);
  });
  it('an item that is not a gift has no wait', () => {
    expect(giftWaitDays(kid(['w-bow']).game, 'w-bow', NOW)).toBe(0);
  });
});

describe('texts', () => {
  it('the confirm question names the item and the refund', () => {
    expect(sellQuestion('Bow', 27)).toBe('Sell the Bow for 27 gems?');
    expect(sellQuestion('Cape', 1)).toBe('Sell the Cape for 1 gem?');
  });
  it('the wait text counts days', () => {
    expect(sellWaitText(3)).toBe('You can sell this in 3 days');
    expect(sellWaitText(1)).toBe('You can sell this in 1 day');
  });
});

describe('buildSale', () => {
  it('pays half the price (rounded down), drops the item, names the record, and changes nothing else', () => {
    const k = kid(['c-flag', 'w-bow', 'g-cape'], { xp: 300, gemsEarnedToday: 6, gemsDay: '2026-11-21', goal: 'p-owl' });
    const w = buildSale(k, 'w-bow', 's1', NOW);
    expect(w.entry).toEqual({ id: 's1', kind: 'sale', itemId: 'w-bow', refund: 27, at: NOW });
    expect(w.game).toEqual({ ...k.game, gems: 127, items: ['c-flag', 'g-cape'], lastPurchaseId: 's1' });
    expect(w.game.xp).toBe(300);
    expect(w.game.gemsEarnedToday).toBe(6);
    expect(w.clearedSlot).toBeNull();
  });
  it('an equipped item clears its slot and keeps the other slots', () => {
    const k = kid(['w-bow', 'g-cape'], { equipped: { weapon: 'w-bow', gear: 'g-cape' } });
    const w = buildSale(k, 'w-bow', 's1', NOW);
    expect(w.game.equipped).toEqual({ gear: 'g-cape' });
    expect(w.clearedSlot).toBe('weapon');
    expect(buildSale(kid(['w-bow'], { equipped: { weapon: 'w-bow' } }), 'w-bow', 's1', NOW).game.equipped).toBeUndefined();
  });
  it('an item that is not equipped leaves equipped alone', () => {
    const k = kid(['w-bow', 'w-sword'], { equipped: { weapon: 'w-sword' } });
    expect(buildSale(k, 'w-bow', 's1', NOW).game.equipped).toEqual({ weapon: 'w-sword' });
  });
  it('a gifted item after 7 days removes its giftFrom and giftAt and no others', () => {
    const k = kid(['w-bow', 'g-cape'], { giftFrom: { 'w-bow': 'a', 'g-cape': 'a' }, giftAt: { 'w-bow': NOW - 8 * DAY, 'g-cape': NOW - DAY } });
    const w = buildSale(k, 'w-bow', 's1', NOW);
    expect(w.game.giftFrom).toEqual({ 'g-cape': 'a' });
    expect(w.game.giftAt).toEqual({ 'g-cape': NOW - DAY });
    const only = buildSale(kid(['w-bow'], { giftFrom: { 'w-bow': 'a' }, giftAt: { 'w-bow': NOW - 8 * DAY } }), 'w-bow', 's1', NOW);
    expect(only.game.giftFrom).toBeUndefined();
    expect(only.game.giftAt).toBeUndefined();
  });
  it('throws GameDeltaError for a legendary item, an unowned item and a locked gift, and never adds gems', () => {
    expect(() => buildSale(kid(['g-goldarmor']), 'g-goldarmor', 's1', NOW)).toThrow(GameDeltaError);
    expect(() => buildSale(kid([]), 'w-bow', 's1', NOW)).toThrow(GameDeltaError);
    expect(() => buildSale(kid(['w-bow'], { giftFrom: { 'w-bow': 'a' }, giftAt: { 'w-bow': NOW - DAY } }), 'w-bow', 's1', NOW)).toThrow(/6 days/);
  });
  it('keeps an item id this build does not know', () => {
    expect(buildSale(kid(['w-bow', 'x-future']), 'w-bow', 's1', NOW).game.items).toEqual(['x-future']);
  });
});

describe('giftAt through the stored shape', () => {
  it('normalizeGame reads a Timestamp-like and a number as ms, for owned items only', () => {
    const ts = { toMillis: () => 1234 };
    const g = normalizeGame({ items: ['w-bow', 'g-cape'], giftFrom: { 'w-bow': 'a', 'g-cape': 'a' }, giftAt: { 'w-bow': ts, 'g-cape': 99, 'w-sword': 5, 'p-dog': 'x' } });
    expect(g.giftAt).toEqual({ 'w-bow': 1234, 'g-cape': 99 });
  });
  it('splitGame keeps giftAt out of the inventory and out of game: the app never writes it back', () => {
    const k = kid(['w-bow'], { giftFrom: { 'w-bow': 'a' }, giftAt: { 'w-bow': NOW } });
    const { game, inventory } = splitGame(k.game);
    expect(inventory).toEqual({ items: ['w-bow'], giftFrom: { 'w-bow': 'a' } });
    expect('giftAt' in game).toBe(false);
  });
});
