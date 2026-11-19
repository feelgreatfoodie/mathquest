import { beforeEach, describe, expect, it } from 'vitest';
import { newWorld, toDoc, worldReducer } from '../game/overworld/worldState';
import { LocalRepo } from './localRepo';

function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

describe('LocalRepo world mirror', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });
  it('loadWorld is null before the first save, and a save reads back unchanged', async () => {
    const repo = new LocalRepo();
    expect(await repo.loadWorld('kidw0000000000000001')).toBeNull();
    const w = worldReducer(newWorld(1), { t: 'chest' }, 5);
    await repo.saveWorld('kidw0000000000000001', toDoc(w));
    expect(await repo.loadWorld('kidw0000000000000001')).toEqual(toDoc(w));
    expect(store.has('mathquest:v1:world:kidw0000000000000001')).toBe(true);
  });
  it('one kid never reads another kid’s world', async () => {
    const repo = new LocalRepo();
    await repo.saveWorld('kidw0000000000000001', toDoc(newWorld(1)));
    expect(await repo.loadWorld('kidw0000000000000002')).toBeNull();
  });
  it('setWorldLastMode writes the pick only when a world exists, and never creates one', async () => {
    const repo = new LocalRepo();
    await repo.setWorldLastMode('kidw0000000000000001', 'overworld');
    expect(await repo.loadWorld('kidw0000000000000001')).toBeNull();
    await repo.saveWorld('kidw0000000000000001', toDoc(newWorld(1)));
    await repo.setWorldLastMode('kidw0000000000000001', 'dungeon');
    expect((await repo.loadWorld('kidw0000000000000001'))?.lastMode).toBe('dungeon');
  });
});
