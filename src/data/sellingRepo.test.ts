import { beforeEach, describe, expect, it } from 'vitest';
import { GameDeltaError } from '../engine/game';
import { gemChangeLabel, gemDeltaText, gemHistory } from '../engine/gemHistory';
import { makeKid } from '../engine/newKid';
import type { Kid, PurchaseLog } from '../engine/models';
import { LocalRepo } from './localRepo';

// Selling back through the offline repo and the gem history (item powers PDR, section 4). Imports only modules main already has, so each
// test fails on main with its own symptom. Every name is made up.
function kid(name: string, gems: number, items: string[], extra: Record<string, unknown> = {}): Kid {
  const k = makeKid(name, 'reader');
  return { ...k, game: { ...k.game, gems, items, ...extra } };
}
const DAY = 24 * 60 * 60 * 1000;
function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe('the gem history', () => {
  const logs = [{ id: 's1', kind: 'sale', itemId: 'w-bow', refund: 27, at: 30 }, { id: 'p1', itemId: 'w-sword', cost: 20, at: 1 }] as PurchaseLog[];
  it('a sale reads Sold: <item>, with a plus', () => {
    const c = gemHistory([], logs)[0]!;
    expect(c).toMatchObject({ kind: 'sale', gems: 27 });
    expect(gemChangeLabel(c, 'Bow')).toBe('Sold: Bow (+27 gems)');
    expect(gemDeltaText(c)).toBe('+27');
  });
  it('a purchase still reads Bought, and a sale never counts as a run', () => {
    const rows = gemHistory([], logs);
    expect(gemChangeLabel(rows[1]!, 'Sword')).toBe('Bought Sword (-20 gems)');
    expect(rows.filter((r) => r.kind === 'run')).toHaveLength(0);
  });
});

describe('LocalRepo.sellItem', () => {
  let repo: LocalRepo;
  let id: string;
  beforeEach(async () => {
    installStorage();
    repo = new LocalRepo();
    const k = kid('Bo', 100, ['c-flag', 'w-bow'], { equipped: { weapon: 'w-bow' } });
    id = k.id;
    await repo.createKid(k);
  });
  it('sells the equipped bow for 27: gems up, item gone, slot cleared, a sale record on purchases', async () => {
    const g = await repo.sellItem(id, 'w-bow');
    expect(g.gems).toBe(127);
    expect(g.items).toEqual(['c-flag']);
    expect(g.equipped).toBeUndefined();
    const stored = (await repo.getKid(id))!;
    expect(stored.game.gems).toBe(127);
    const logs = await repo.listPurchases(id, 5);
    expect(logs).toMatchObject([{ kind: 'sale', itemId: 'w-bow', refund: 27 }]);
    expect(logs[0]!.id).toBe(g.lastPurchaseId);
  });
  it('refuses a legendary item and an item not owned, with nothing written', async () => {
    await expect(repo.sellItem(id, 'g-goldarmor')).rejects.toThrow(GameDeltaError);
    await expect(repo.sellItem(id, 'w-sword')).rejects.toThrow(/do not have/);
    expect(await repo.listPurchases(id, 5)).toEqual([]);
  });
  it('refuses while the family has selling off, and works again when it is on', async () => {
    await repo.saveFamily({ pinHash: 'x', createdAt: 1 });
    expect(await repo.getSelling()).toBe(true);
    await repo.setSelling(false);
    expect(await repo.getSelling()).toBe(false);
    await expect(repo.sellItem(id, 'w-bow')).rejects.toThrow(/Selling is off/);
    await repo.setSelling(true);
    expect((await repo.sellItem(id, 'w-bow')).gems).toBe(127);
  });
  it('a gifted item is locked for 7 days and then sells, and the sale drops its gift notes', async () => {
    const k = kid('Cy', 10, ['w-hammer'], { giftFrom: { 'w-hammer': 'kid-a' }, giftAt: { 'w-hammer': Date.now() - DAY } });
    await repo.createKid(k);
    await expect(repo.sellItem(k.id, 'w-hammer')).rejects.toThrow(/You can sell this in 6 days/);
    const k2 = kid('Cz', 10, ['w-hammer'], { giftFrom: { 'w-hammer': 'kid-a' }, giftAt: { 'w-hammer': Date.now() - 8 * DAY } });
    await repo.createKid(k2);
    const g = await repo.sellItem(k2.id, 'w-hammer');
    expect(g.gems).toBe(45);
    expect(g.giftFrom).toBeUndefined();
    expect(g.giftAt).toBeUndefined();
  });
  it('a re-buy after the sale goes through the normal buy path', async () => {
    await repo.sellItem(id, 'w-bow');
    const g = await repo.applyGameDelta(id, { purchase: 'w-bow' });
    expect(g.gems).toBe(72);
    expect(g.items).toContain('w-bow');
  });
  it('selling never touches the daily gem throttle fields', async () => {
    const k = kid('Di', 100, ['w-bow'], { gemsEarnedToday: 7, gemsDay: '2026-11-21' });
    await repo.createKid(k);
    const g = await repo.sellItem(k.id, 'w-bow');
    expect(g).toMatchObject({ gemsEarnedToday: 7, gemsDay: '2026-11-21', gems: 127 });
  });
});
