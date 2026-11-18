import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { ITEMS } from '../src/game/shop/catalog';

// Worst case for the Firestore rules expression cap (1000 per request). List checks cost about one expression per
// entry, so the ceiling is the catalog: a kid can only add an item that is in itemPrices and not owned, so the list
// never passes ITEMS.length (23) entries. This kid owns 22 of the 23, all 5 heroes, and weapon, gear and pet
// equipped; buying the 23rd item reaches the ceiling. Each of the five write shapes must be accepted as a kid token,
// and at the ceiling a 24th entry (an owned item again, an item outside the catalog) must be refused.
// Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidaaaa';

let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidRef = (db: ReturnType<typeof kidDb>) => doc(db, `families/${FAM}/kids/${KID}`);

const HEROES = ['knight', 'wizard', 'ranger', 'robot', 'dragon'];
const BUYABLE = 'c-fire'; // 55 gems, the one catalog item left out of the seeded list so it can be bought
const owned = () => ITEMS.map((i) => i.id).filter((id) => id !== BUYABLE);
const GAME = { lastPlayedDay: '2026-11-17', xp: 467, gems: 200, heroes: HEROES, bestCombo: 16, hero: 'knight', streakDays: 1 };
const EQUIPPED = { weapon: 'w-bow', gear: 'g-helm', pet: 'p-owl' };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-worst', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await seed(owned());
});
async function seed(items: string[]) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), {
      id: KID, name: 'Testkid', createdAt: 1, hasPin: true,
      settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
      game: GAME,
      inventory: { items, equipped: EQUIPPED, goal: 'a-bridge' },
    });
  });
}


const stored = async () => (await getDoc(kidRef(parentDb()))).data() as { game: Record<string, unknown>; inventory: { items: string[]; equipped: Record<string, string>; goal?: string } };

describe('a kid with 22 of 23 catalog items, 5 heroes and 3 equipped slots', () => {
  it('seed: the catalog has 23 items, the kid owns 22, 5 heroes, 3 equipped', async () => {
    expect(ITEMS).toHaveLength(23);
    const d = await stored();
    expect(d.inventory.items).toHaveLength(22);
    expect(d.game.heroes).toHaveLength(5);
    expect(Object.keys(d.inventory.equipped)).toHaveLength(3);
  });
  it('(1) an old-shape run write (game only, no inventory key) is accepted', async () => {
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: { ...GAME, xp: 520, gems: 207, bestCombo: 20 } }));
    expect((await stored()).inventory.items).toHaveLength(22);
  });
  it('(2) a new-bundle run write (through the repo) is accepted', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    await assertSucceeds(repo.applyGameDelta(KID, { xp: 60, gems: 5, bestCombo: 9, playedAt: Date.now() }));
    const d = await stored();
    expect(d.game.xp).toBe(527);
    expect(d.inventory.items).toHaveLength(22);
  });
  it('(3) a hero-path write (equip another owned hero) is accepted', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    await assertSucceeds(repo.applyGameDelta(KID, { equip: 'dragon' }));
    expect((await stored()).game.hero).toBe('dragon');
  });
  it('(4) an item buy at catalog price with one purchases doc is accepted, and it is the 23rd entry', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    await assertSucceeds(repo.applyGameDelta(KID, { purchase: BUYABLE }));
    const d = await stored();
    expect(d.game.gems).toBe(145);
    expect(d.inventory.items).toHaveLength(23);
    expect(d.inventory.items).toContain(BUYABLE);
  });
  it('(5) an equip change is accepted', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    await assertSucceeds(repo.applyGameDelta(KID, { equip: 'w-sword' }));
    expect((await stored()).inventory.equipped).toEqual({ ...EQUIPPED, weapon: 'w-sword' });
  });
});

describe('at the ceiling (all 23 owned) no 24th entry can be added', () => {
  const writeBuy = (items: string[], id: string, cost: number, itemId: string) => {
    const db = kidDb();
    const b = writeBatch(db);
    b.update(kidRef(db), { game: { ...GAME, gems: GAME.gems - cost, lastPurchaseId: id }, inventory: { items, equipped: EQUIPPED, goal: 'a-bridge' } });
    b.set(doc(db, `families/${FAM}/kids/${KID}/purchases/${id}`), { id, itemId, cost, at: 1000 });
    return b.commit();
  };
  const all = () => [...owned(), BUYABLE];
  beforeEach(async () => {
    await seed(all());
  });
  it('an owned item bought again (a duplicate entry at the right price) is refused', async () => {
    await assertFails(writeBuy([...all(), 'w-bow'], 'p1', 55, 'w-bow'));
  });
  it('an owned item bought again through the repo is refused by the client and the doc stays at 23', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    await expect(repo.applyGameDelta(KID, { purchase: 'w-bow' })).rejects.toBeTruthy();
    expect((await stored()).inventory.items).toHaveLength(23);
  });
  it('an item outside the catalog is refused whatever the price', async () => {
    await assertFails(writeBuy([...all(), 'x-extra'], 'p1', 10, 'x-extra'));
  });
  it('a 24th entry with no purchase and no gem drop is refused', async () => {
    const db = kidDb();
    await assertFails(updateDoc(kidRef(db), { game: GAME, inventory: { items: [...all(), 'w-bow'], equipped: EQUIPPED } }));
  });
});
