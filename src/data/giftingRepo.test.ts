import { beforeEach, describe, expect, it } from 'vitest';
import { GameDeltaError } from '../engine/game';
import { gemChangeLabel, gemHistory } from '../engine/gemHistory';
import { makeKid } from '../engine/newKid';
import { normalizeGame, normalizeKid, splitGame, type Kid, type PurchaseLog } from '../engine/models';
import { ITEMS } from '../game/shop/catalog';
import { LocalRepo } from './localRepo';

// Gifting through the stored shape and the offline repo (item powers PDR, section 3). Imports only modules main already has,
// so each test fails on main with its own symptom. Every name is made up.
function kid(name: string, gems: number, items: string[] = []): Kid {
  const k = makeKid(name, 'reader');
  return { ...k, game: { ...k.game, gems, ...(items.length ? { items } : {}) } };
}

describe('giftFrom through the stored shape', () => {
  it('splitGame puts giftFrom in the inventory and normalizeKid reads it back', () => {
    const k = kid('Bo', 5, ['w-bow']);
    const game = { ...k.game, giftFrom: { 'w-bow': 'kid-a' } };
    const { game: g, inventory } = splitGame(game);
    expect(inventory).toEqual({ items: ['w-bow'], giftFrom: { 'w-bow': 'kid-a' } });
    expect('giftFrom' in g).toBe(false);
    expect(normalizeKid({ ...k, game: g, inventory }).game.giftFrom).toEqual({ 'w-bow': 'kid-a' });
  });
  it('a kid with no gifts has no giftFrom in the inventory', () => {
    expect(splitGame(kid('Bo', 5, ['w-bow']).game).inventory).toEqual({ items: ['w-bow'] });
  });
  it('normalizeGame drops giftFrom entries for items not owned, and junk values', () => {
    const g = normalizeGame({ items: ['w-bow'], giftFrom: { 'w-bow': 'kid-a', 'w-sword': 'kid-b', 'g-cape': 7 } });
    expect(g.giftFrom).toEqual({ 'w-bow': 'kid-a' });
    expect(normalizeGame({ items: ['w-bow'], giftFrom: ['x'] }).giftFrom).toBeUndefined();
  });
});

describe('the gem history', () => {
  const logs: PurchaseLog[] = [{ id: 'g1', kind: 'gift', to: 'b', itemId: 'w-bow', cost: 55, at: 30 }, { id: 'p1', itemId: 'w-sword', cost: 20, at: 1 }];
  it('the gem history labels a gift as a gift, not a purchase', () => {
    const c = gemHistory([], logs)[0]!;
    expect(c.kind).toBe('gift');
    expect(gemChangeLabel(c, 'Bow')).toBe('Gift: Bow (-55 gems)');
  });
});

function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe('LocalRepo.giftItem', () => {
  beforeEach(installStorage);
  async function setup() {
    const repo = new LocalRepo();
    const a = makeKid('Ada', 'reader');
    const b = makeKid('Bo', 'prereader');
    await repo.createKid(a);
    await repo.createKid(b);
    await repo.applyGameDelta(a.id, { gems: 200 });
    return { repo, a, b };
  }
  it('moves the gems and the item in one step and writes both records', async () => {
    const { repo, a, b } = await setup();
    const game = await repo.giftItem(a.id, b.id, 'w-bow');
    expect(game.gems).toBe(145);
    expect((await repo.getKid(b.id))!.game.items).toEqual(['w-bow']);
    expect((await repo.getKid(b.id))!.game.giftFrom).toEqual({ 'w-bow': a.id });
    expect((await repo.getKid(a.id))!.game.items).toBeUndefined();
    expect(await repo.listPurchases(a.id, 10)).toMatchObject([{ kind: 'gift', to: b.id, itemId: 'w-bow', cost: 55 }]);
    expect(await repo.listGifts(b.id, 10)).toMatchObject([{ from: a.id, itemId: 'w-bow', seen: false }]);
  });
  it('refuses a second gift of the same item and leaves one record', async () => {
    const { repo, a, b } = await setup();
    await repo.giftItem(a.id, b.id, 'w-bow');
    await expect(repo.giftItem(a.id, b.id, 'w-bow')).rejects.toThrow(GameDeltaError);
    expect(await repo.listGifts(b.id, 10)).toHaveLength(1);
    expect((await repo.getKid(a.id))!.game.gems).toBe(145);
  });
  it('refuses when the giver is short, and changes nothing', async () => {
    const { repo, a, b } = await setup();
    await expect(repo.giftItem(a.id, b.id, 'g-goldarmor')).rejects.toThrow(/Not enough gems/);
    expect((await repo.getKid(a.id))!.game.gems).toBe(200);
    expect(await repo.listPurchases(a.id, 10)).toEqual([]);
  });
  it('refuses when a grown-up turned gifting off, and the sibling list is empty', async () => {
    const { repo, a, b } = await setup();
    await repo.saveFamily({ pinHash: null, createdAt: 1 });
    await repo.setGifting(false);
    await expect(repo.giftItem(a.id, b.id, 'w-bow')).rejects.toThrow(/off/);
    expect(await repo.listSiblings(a.id)).toEqual([]);
    await repo.setGifting(true);
    expect((await repo.listSiblings(a.id)).map((k) => k.id)).toEqual([b.id]);
  });
  it('markGiftSeen clears the present', async () => {
    const { repo, a, b } = await setup();
    await repo.giftItem(a.id, b.id, 'w-bow');
    const [g] = await repo.listGifts(b.id, 10);
    await repo.markGiftSeen(b.id, g!.id);
    expect((await repo.listGifts(b.id, 10)).filter((x) => !x.seen)).toEqual([]);
  });
  it('listSiblings leaves out the kid asking', async () => {
    const { repo, a } = await setup();
    expect((await repo.listSiblings(a.id)).map((k) => k.name)).toEqual(['Bo']);
  });
  it('the rules price map equals the catalog the gift reads', async () => {
    const rules = (await import('node:fs')).readFileSync('firestore.rules', 'utf8');
    for (const it of ITEMS) expect(rules).toContain(`'${it.id}': ${it.cost}`);
  });
});
