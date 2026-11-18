import { assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { ITEMS } from '../src/game/shop/catalog';
import { FAM, GAME, HEROES, KID, deposit, kidDb, newEnv, payChunk, seed, stored, storedDeposit, vaultRef } from './vaultHelpers';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

// Worst case for the Firestore rules expression cap (1000 per request), now with the vault rules in the kid-write
// path. Every kid write type runs for a kid with all 23 catalog items (22 owned, the 23rd bought in the item case),
// all 5 heroes, three equipped slots and a full vault (3 active deposits). Each must be accepted. An expression-cap
// failure shows up here as a denied write. Every name, id and number is made up.
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await newEnv('demo-mathquest-vault-worst');
});
afterAll(async () => env.cleanup());

const BUYABLE = 'c-fire'; // 55 gems
const owned = () => ITEMS.map((i) => i.id).filter((id) => id !== BUYABLE);
const EQUIPPED = { weapon: 'w-bow', gear: 'g-helm', pet: 'p-owl' };
const FULL_GAME = { ...GAME, gems: 300, heroes: HEROES, hero: 'knight' };
const dep = (id: string, ageDays: number) => ({ id, amount: 30, termDays: 3 as const, ratePer10: 1, bonus: 3, ageDays });

async function seedFull(ages: [number, number, number] = [0.5, 0.5, 0.5], n = 3) {
  await seed(env, {
    game: FULL_GAME,
    inventory: { items: owned(), equipped: EQUIPPED, goal: 'a-bridge' },
    deposits: [dep('v1', ages[0]), dep('v2', ages[1]), dep('v3', ages[2])].slice(0, n),
  });
}
const repo = () => new FirestoreRepo(kidDb(env), FAM);

describe('a kid with 23 items, 5 heroes, 3 equipped slots and 3 active deposits: every write type is accepted', () => {
  beforeEach(async () => {
    await seedFull();
  });
  it('seed: 22 items, 5 heroes, 3 active deposits', async () => {
    expect(ITEMS).toHaveLength(23);
    const d = await stored(env);
    expect((d.inventory as { items: string[] }).items).toHaveLength(22);
    expect(d.game.heroes).toHaveLength(5);
    expect(d.vault).toEqual({ active: 3, lastId: 'v3' });
  });
  it('(1) an old-shape run write (game only)', async () => {
    const { updateDoc } = await import('firebase/firestore');
    const { kidRef } = await import('./vaultHelpers');
    await assertSucceeds(updateDoc(kidRef(kidDb(env)), { game: { ...FULL_GAME, xp: 520, gems: 307 } }));
  });
  it('(2) a new-bundle run write through the repo', async () => {
    await assertSucceeds(repo().applyGameDelta(KID, { xp: 60, gems: 5, bestCombo: 9, playedAt: Date.now() }));
  });
  it('(3) a hero equip', async () => {
    await assertSucceeds(repo().applyGameDelta(KID, { equip: 'dragon' }));
  });
  it('(4) the 23rd item buy, with its purchases doc', async () => {
    await assertSucceeds(repo().applyGameDelta(KID, { purchase: BUYABLE }));
    expect(((await stored(env)).inventory as { items: string[] }).items).toHaveLength(23);
  });
  it('(5) an item equip', async () => {
    await assertSucceeds(repo().applyGameDelta(KID, { equip: 'w-sword' }));
  });
  it('(6) a goal pin', async () => {
    await assertSucceeds(repo().applyGameDelta(KID, { goal: null }));
  });
  it('(7) a payout chunk that closes a deposit (first chunk, collect after the term)', async () => {
    await seedFull([4, 0.5, 0.5]);
    await assertSucceeds(payChunk(kidDb(env), 'v1', { gemsBefore: 300, chunk: 10, close: 'collecting', activeBefore: 3, lastId: 'v3' }, { game: { ...FULL_GAME, gems: 310 } }));
  });
  it('(8) a payout chunk that closes a deposit (first chunk, break) through the repo', async () => {
    const r = await repo().vaultPay(KID, 'v2', 'break');
    expect(r.paid).toBe(10);
    expect((await storedDeposit(env, 'v2'))!.status).toBe('breaking');
  });
  it('(9) a continuation chunk', async () => {
    await seedFull([4, 0.5, 0.5]);
    const r1 = await repo().vaultPay(KID, 'v1', 'collect');
    expect(r1.done).toBe(false);
    const r2 = await repo().vaultPay(KID, 'v1', 'collect');
    expect(r2.paid).toBe(10);
  });
  it('(10) the third deposit, with 2 active before', async () => {
    await seedFull([0.5, 0.5, 0.5], 2);
    await assertSucceeds(deposit(kidDb(env), { id: 'v3', amount: 50, termDays: 14 }, { activeBefore: 2, gemsBefore: 300, game: { ...FULL_GAME, gems: 250 } }));
  });
  it('(11) the third deposit through the repo', async () => {
    await seedFull([0.5, 0.5, 0.5], 2);
    await assertSucceeds(repo().vaultDeposit(KID, 40, 7));
    expect((await stored(env)).vault!.active).toBe(3);
  });
  it('a closed deposit that has paid in full leaves the vault map at 2 active and the next deposit is accepted', async () => {
    await seedFull([4, 0.5, 0.5]);
    let r = await repo().vaultPay(KID, 'v1', 'collect');
    while (!r.done) r = await repo().vaultPay(KID, 'v1', 'collect');
    expect((await stored(env)).vault).toMatchObject({ active: 2, closedId: 'v1' });
    await assertSucceeds(repo().vaultDeposit(KID, 10, 3));
  });
  it('writes the deposit for an old-shape check last: the seeded matured doc exists', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `families/${FAM}/kids/${KID}/vault/old`), { id: 'old', amount: 10, status: 'collected', paidOut: 11, createdAt: Timestamp.fromMillis(0) });
    });
    expect((await storedDeposit(env, 'old'))!.paidOut).toBe(11);
    expect(vaultRef).toBeDefined();
  });
});
