import { readFileSync } from 'node:fs';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { GameDeltaError } from '../src/engine/game';
import { gemChangeLabel, gemHistory } from '../src/engine/gemHistory';

// FirestoreRepo.sellItem and the gift stamp against the real rules, signed in as kid tokens and as the grown-up. The repo's transaction is
// the writer, so a rules change that the app's own writes no longer satisfy fails here. Made-up names and ids.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const A = 'kidaaaa';
const B = 'kidbbbb';
const DAY = 24 * 60 * 60 * 1000;
let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = (kidId: string) => env.authenticatedContext(`kid_${kidId}`, { role: 'kid', familyUid: FAM, kidId }).firestore();
const kidDoc = (id: string, gems: number, inventory?: Record<string, unknown>, gameExtra: Record<string, unknown> = {}) => ({
  id, name: id === A ? 'Ada' : 'Bo', createdAt: id === A ? 1 : 2, hasPin: true,
  settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
  game: { lastPlayedDay: '2026-11-17', xp: 467, gems, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1, ...gameExtra },
  ...(inventory ? { inventory } : {}),
});
const stored = async (id: string) => (await getDoc(doc(parentDb(), `families/${FAM}/kids/${id}`))).data()!;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-sellrepo', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
async function seed(a: Record<string, unknown>, aGame: Record<string, unknown> = {}, family: Record<string, unknown> = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { createdAt: 1, hasPin: true, ...family });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${A}`), kidDoc(A, 100, a, aGame));
    await setDoc(doc(db, `families/${FAM}/kids/${B}`), kidDoc(B, 10, { items: ['c-flag'] }));
  });
}
beforeEach(async () => seed({ items: ['w-sword', 'w-bow'], equipped: { weapon: 'w-bow' }, goal: 'p-owl' }));

describe('FirestoreRepo.sellItem under the rules', () => {
  it('a kid sells the equipped bow: gems +27, the item and its slot go, the goal stays, a sale record exists', async () => {
    const game = await new FirestoreRepo(kidDb(A), FAM).sellItem(A, 'w-bow');
    expect(game.gems).toBe(127);
    const a = await stored(A);
    expect(a.game).toMatchObject({ gems: 127, xp: 467, heroes: ['knight'] });
    expect(a.game.lastPurchaseId).toBeTruthy();
    expect(a.inventory).toEqual({ items: ['w-sword'], goal: 'p-owl', equipped: {} });
    const logs = await new FirestoreRepo(parentDb(), FAM).listPurchases(A, 5);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({ id: a.game.lastPurchaseId, kind: 'sale', itemId: 'w-bow', refund: 27, at: expect.any(Number) });
    expect(gemChangeLabel(gemHistory([], logs)[0]!, 'Bow')).toBe('Sold: Bow (+27 gems)');
  });
  it('a game field this build does not know is left alone by the sale', async () => {
    await seed({ items: ['w-sword', 'w-bow'] }, { futureField: 7, gemsEarnedToday: 4, gemsDay: '2026-11-17' });
    await new FirestoreRepo(kidDb(A), FAM).sellItem(A, 'w-sword');
    expect((await stored(A)).game).toMatchObject({ futureField: 7, gemsEarnedToday: 4, gemsDay: '2026-11-17', gems: 110 });
  });
  it('the parent device playing as the kid sells through the same path', async () => {
    await new FirestoreRepo(parentDb(), FAM).sellItem(A, 'w-sword');
    expect((await stored(A)).game.gems).toBe(110);
  });
  it('a re-buy after the sale goes through the normal buy path', async () => {
    const r = new FirestoreRepo(kidDb(A), FAM);
    await r.sellItem(A, 'w-bow');
    const g = await r.applyGameDelta(A, { purchase: 'w-bow' });
    expect(g.gems).toBe(72);
    expect((await stored(A)).inventory.items).toEqual(['w-sword', 'w-bow']);
  });
  it('a legendary item and an item not owned are refused by the repo before any write', async () => {
    await seed({ items: ['g-goldarmor'] });
    const r = new FirestoreRepo(kidDb(A), FAM);
    await expect(r.sellItem(A, 'g-goldarmor')).rejects.toThrow(GameDeltaError);
    await expect(r.sellItem(A, 'w-bow')).rejects.toThrow(/do not have/);
    expect((await stored(A)).game.gems).toBe(100);
  });
  it('selling off: the rules refuse the kid and the parent device, getSelling tells a parent session, and Sell comes back when it is on again', async () => {
    const parent = new FirestoreRepo(parentDb(), FAM);
    await parent.setSelling(false);
    expect(await parent.getSelling()).toBe(false);
    expect(await new FirestoreRepo(kidDb(A), FAM).getSelling()).toBe(true);
    await expect(new FirestoreRepo(kidDb(A), FAM).sellItem(A, 'w-bow')).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(parent.sellItem(A, 'w-bow')).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await stored(A)).game.gems).toBe(100);
    await parent.setSelling(true);
    await new FirestoreRepo(kidDb(A), FAM).sellItem(A, 'w-bow');
    expect((await stored(A)).game.gems).toBe(127);
  });
  it('a kid cannot flip the family switch', async () => {
    await assertFails(updateDoc(doc(kidDb(A), `families/${FAM}`), { selling: false }));
  });
});

describe('gifted items through the repo', () => {
  it('a gift is stamped with the server time, and the lock holds: the receiver cannot sell it for 7 days, then can', async () => {
    await new FirestoreRepo(kidDb(A), FAM).giftItem(A, B, 'w-hammer');
    const rb = new FirestoreRepo(kidDb(B), FAM);
    const b = await stored(B);
    expect(b.inventory.giftAt['w-hammer']).toBeInstanceOf(Timestamp);
    expect(Math.abs(b.inventory.giftAt['w-hammer'].toMillis() - Date.now())).toBeLessThan(60_000);
    await expect(rb.sellItem(B, 'w-hammer')).rejects.toThrow(/You can sell this in 7 days/);
    // 8 days later (the stored stamp moves back, as the clock would move forward).
    await env.withSecurityRulesDisabled(async (ctx) => updateDoc(doc(ctx.firestore(), `families/${FAM}/kids/${B}`), { 'inventory.giftAt.w-hammer': Timestamp.fromMillis(Date.now() - 8 * DAY) }));
    const g = await rb.sellItem(B, 'w-hammer');
    expect(g.gems).toBe(45);
    const after = await stored(B);
    expect(after.inventory.items).toEqual(['c-flag']);
    expect(after.inventory.giftFrom ?? {}).toEqual({});
    expect(after.inventory.giftAt ?? {}).toEqual({});
  });
  it('an ordinary save after the gift keeps giftFrom and giftAt (the inventory is written by path)', async () => {
    await new FirestoreRepo(kidDb(A), FAM).giftItem(A, B, 'w-hammer');
    const before = (await stored(B)).inventory.giftAt['w-hammer'] as Timestamp;
    const rb = new FirestoreRepo(kidDb(B), FAM);
    await rb.applyGameDelta(B, { equip: 'w-hammer' });
    await rb.applyGameDelta(B, { goal: 'p-owl' });
    await rb.applyGameDelta(B, { unequip: 'weapon' });
    const after = (await stored(B)).inventory;
    expect(after.giftFrom).toEqual({ 'w-hammer': A });
    expect((after.giftAt['w-hammer'] as Timestamp).isEqual(before)).toBe(true);
    expect(after.goal).toBe('p-owl');
    expect(after.equipped ?? {}).toEqual({});
  });
  it('a second gift keeps the first gift stamp', async () => {
    await new FirestoreRepo(kidDb(A), FAM).giftItem(A, B, 'w-hammer');
    const first = (await stored(B)).inventory.giftAt['w-hammer'] as Timestamp;
    await new FirestoreRepo(kidDb(A), FAM).giftItem(A, B, 'g-cape');
    const inv = (await stored(B)).inventory;
    expect((inv.giftAt['w-hammer'] as Timestamp).isEqual(first)).toBe(true);
    expect(inv.giftAt['g-cape']).toBeInstanceOf(Timestamp);
  });
  it('a gifted item with no giftAt (from before the stamp) is never sellable', async () => {
    await seed({ items: ['w-sword', 'w-bow'], giftFrom: { 'w-bow': B } });
    await expect(new FirestoreRepo(kidDb(A), FAM).sellItem(A, 'w-bow')).rejects.toThrow(/gift cannot be sold/);
  });
});
