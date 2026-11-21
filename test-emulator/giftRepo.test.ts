import { readFileSync } from 'node:fs';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { GameDeltaError } from '../src/engine/game';

// FirestoreRepo.giftItem, listSiblings, listGifts and markGiftSeen against the real rules, signed in as kid tokens and as the grown-up.
// The repo's transaction is the writer, so a rules change that the app's own writes no longer satisfy fails here. Made-up names and ids.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const A = 'kidaaaa';
const B = 'kidbbbb';
let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = (kidId: string) => env.authenticatedContext(`kid_${kidId}`, { role: 'kid', familyUid: FAM, kidId }).firestore();
const kidDoc = (id: string, gems: number, inventory?: Record<string, unknown>) => ({
  id, name: id === A ? 'Ada' : 'Bo', createdAt: id === A ? 1 : 2, hasPin: true,
  settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
  game: { lastPlayedDay: '2026-11-17', xp: 467, gems, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1 },
  ...(inventory ? { inventory } : {}),
});

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-giftrepo', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${A}`), kidDoc(A, 200, { items: ['w-sword'], equipped: { weapon: 'w-sword' } }));
    await setDoc(doc(db, `families/${FAM}/kids/${B}`), kidDoc(B, 10, { items: ['c-flag'], goal: 'p-owl' }));
  });
});

describe('FirestoreRepo gifting under the rules', () => {
  it('a kid gifts the bow: gems drop, the receiver gets it with giftFrom, equipped and goal stay, records exist', async () => {
    const game = await new FirestoreRepo(kidDb(A), FAM).giftItem(A, B, 'w-bow');
    expect(game.gems).toBe(145);
    const p = parentDb();
    const a = (await getDoc(doc(p, `families/${FAM}/kids/${A}`))).data()!;
    expect(a.game.gems).toBe(145);
    expect(a.inventory).toEqual({ items: ['w-sword'], equipped: { weapon: 'w-sword' } });
    const b = (await getDoc(doc(p, `families/${FAM}/kids/${B}`))).data()!;
    expect(b.inventory).toEqual({ items: ['c-flag', 'w-bow'], goal: 'p-owl', giftFrom: { 'w-bow': A } });
    expect(b.game.gems).toBe(10);
    const repo = new FirestoreRepo(parentDb(), FAM);
    expect(await repo.listPurchases(A, 5)).toMatchObject([{ kind: 'gift', to: B, itemId: 'w-bow', cost: 55 }]);
    expect(await new FirestoreRepo(kidDb(B), FAM).listGifts(B, 5)).toMatchObject([{ from: A, itemId: 'w-bow', seen: false }]);
  });
  it('the receiver reads the present, marks it seen, and then equips the item in an ordinary save', async () => {
    await new FirestoreRepo(kidDb(A), FAM).giftItem(A, B, 'w-bow');
    const rb = new FirestoreRepo(kidDb(B), FAM);
    const [g] = await rb.listGifts(B, 5);
    await rb.markGiftSeen(B, g!.id);
    expect((await rb.listGifts(B, 5))[0]!.seen).toBe(true);
    await rb.applyGameDelta(B, { equip: 'w-bow' });
    const b = (await getDoc(doc(parentDb(), `families/${FAM}/kids/${B}`))).data()!;
    expect(b.inventory).toMatchObject({ items: ['c-flag', 'w-bow'], equipped: { weapon: 'w-bow' }, giftFrom: { 'w-bow': A } });
  });
  it('a second gift of the same item is refused by the repo before any write', async () => {
    const ra = new FirestoreRepo(kidDb(A), FAM);
    await ra.giftItem(A, B, 'w-bow');
    await expect(ra.giftItem(A, B, 'w-bow')).rejects.toThrow(GameDeltaError);
    expect((await getDoc(doc(parentDb(), `families/${FAM}/kids/${A}`))).data()!.game.gems).toBe(145);
  });
  it('the giver cannot pay: refused, nothing written', async () => {
    await expect(new FirestoreRepo(kidDb(A), FAM).giftItem(A, B, 'w-crystalstaff')).rejects.toThrow(/Not enough gems/);
  });
  it('the parent device playing as the giver gifts too', async () => {
    await new FirestoreRepo(parentDb(), FAM).giftItem(A, B, 'w-bow');
    expect((await getDoc(doc(parentDb(), `families/${FAM}/kids/${B}`))).data()!.inventory.giftFrom).toEqual({ 'w-bow': A });
  });
  it('listSiblings reads the other kid while gifting is on, and fails once the grown-up turns it off', async () => {
    const ra = new FirestoreRepo(kidDb(A), FAM);
    expect((await ra.listSiblings(A)).map((k) => k.id)).toEqual([B]);
    await new FirestoreRepo(parentDb(), FAM).setGifting(false);
    await assertFails(ra.listSiblings(A));
    await expect(ra.giftItem(A, B, 'w-bow')).rejects.toThrow();
    await new FirestoreRepo(parentDb(), FAM).setGifting(true);
    expect((await ra.listSiblings(A)).map((k) => k.id)).toEqual([B]);
  });
  it('a kid cannot flip the family switch, and a bare receiver write without the batch fails', async () => {
    await assertFails(updateDoc(doc(kidDb(A), `families/${FAM}`), { gifting: false }));
    await assertFails(updateDoc(doc(kidDb(A), `families/${FAM}/kids/${B}`), { inventory: { items: ['c-flag', 'w-bow'], goal: 'p-owl', giftFrom: { 'w-bow': A } } }));
  });
});
