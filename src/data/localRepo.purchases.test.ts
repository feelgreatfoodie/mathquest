import { beforeEach, describe, expect, it } from 'vitest';
import { makeKid } from '../engine/newKid';
import { LocalRepo } from './localRepo';

function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe('LocalRepo purchases log', () => {
  beforeEach(installStorage);

  it('a purchase writes one log entry with hero, cost and time; equip and runs write none', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Pip', 'reader');
    await repo.createKid(kid);
    await repo.applyGameDelta(kid.id, { gems: 40 });
    await repo.applyGameDelta(kid.id, { purchase: 'wizard' });
    await repo.applyGameDelta(kid.id, { equip: 'knight' });
    const log = await repo.listPurchases(kid.id, 20);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ heroId: 'wizard', cost: 15 });
    expect(typeof log[0]!.at).toBe('number');
  });

  it('a refused purchase writes no entry', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Pip', 'reader');
    await repo.createKid(kid);
    await expect(repo.applyGameDelta(kid.id, { purchase: 'wizard' })).rejects.toThrow();
    expect(await repo.listPurchases(kid.id, 20)).toEqual([]);
  });

  it('a second purchase of the same hero fails and leaves one entry', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Pip', 'reader');
    await repo.createKid(kid);
    await repo.applyGameDelta(kid.id, { gems: 40 });
    await repo.applyGameDelta(kid.id, { purchase: 'wizard' });
    await expect(repo.applyGameDelta(kid.id, { purchase: 'wizard' })).rejects.toThrow();
    expect(await repo.listPurchases(kid.id, 20)).toHaveLength(1);
  });

  it('watchKid reports a change made by another writer', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Pip', 'reader');
    await repo.createKid(kid);
    const seen: number[] = [];
    const off = repo.watchKid(kid.id, (k) => k && seen.push(k.game.xp), { pollMs: 20 });
    await repo.applyGameDelta(kid.id, { xp: 50 });
    await new Promise((r) => setTimeout(r, 120));
    off();
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(50);
  });
});
