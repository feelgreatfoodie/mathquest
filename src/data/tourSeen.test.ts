import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepo } from './localRepo';

function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe('tourSeen (local data)', () => {
  beforeEach(installStorage);
  it('is unset, set by markTourSeen, and kept when the PIN changes', async () => {
    const repo = new LocalRepo();
    await repo.saveFamily({ pinHash: 'a', createdAt: 1 });
    expect((await repo.getFamily())?.tourSeen).toBeUndefined();
    await repo.markTourSeen();
    expect((await repo.getFamily())?.tourSeen).toBe(true);
    await repo.saveFamily({ pinHash: 'b', createdAt: 2 });
    expect(await repo.getFamily()).toEqual({ pinHash: 'b', createdAt: 2, tourSeen: true });
  });
  it('writes nothing when there is no family yet', async () => {
    const repo = new LocalRepo();
    await repo.markTourSeen();
    expect(await repo.getFamily()).toBeNull();
  });
});
