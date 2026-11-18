import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';

// shop-2: owned and equipped items. A gem drop is legal only with one same-write purchases doc whose cost equals the
// catalog price of the one item (or hero) added. An equipped item must be owned and fit its slot. Owned items never
// leave. Every name, id and number is made up. RULES_FILE runs the suite against another rules file.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidaaaa';

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
type Db = ReturnType<typeof parentDb>;
const kidRef = (db: Db) => doc(db, `families/${FAM}/kids/${KID}`);
const purchaseRef = (db: Db, id: string) => doc(db, `families/${FAM}/kids/${KID}/purchases/${id}`);

const GAME = { lastPlayedDay: '2026-11-17', xp: 467, gems: 200, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1 };
const kidDoc = (game: Record<string, unknown> = {}) => ({
  id: KID, name: 'Testkid', createdAt: 1, hasPin: true,
  settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
  game: { ...GAME, ...game },
});
const entry = (id: string, itemId: string, cost: number) => ({ id, itemId, cost, at: 1000 });
const heroEntry = (id: string, heroId: string, cost: number) => ({ id, heroId, cost, at: 1000 });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-items', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seed(GAME);
});
async function seed(game: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), kidDoc(game));
  });
}

type Entry = { id: string; cost: number; at: number } & Record<string, unknown>;
function batch(db: Db, game: Record<string, unknown>, entries: Entry[] = []) {
  const b = writeBatch(db);
  b.update(kidRef(db), { game: { ...GAME, ...game } });
  for (const e of entries) b.set(purchaseRef(db, e.id), e);
  return b.commit();
}
/** The bow, 55 gems. */
const buyBow = (db: Db, over: { game?: Record<string, unknown>; entries?: Entry[] } = {}) =>
  batch(db, { gems: 145, items: ['w-bow'], equipped: { weapon: 'w-bow' }, lastPurchaseId: 'p1', ...(over.game ?? {}) }, over.entries ?? [entry('p1', 'w-bow', 55)]);

describe('a correct buy passes', () => {
  it('kid: the bow for 55, equipped in the same write', async () => {
    await assertSucceeds(buyBow(kidDb()));
    expect((await getDoc(purchaseRef(parentDb(), 'p1'))).data()).toMatchObject({ itemId: 'w-bow', cost: 55 });
  });
  it('parent device playing as the kid: the bow for 55', async () => {
    await assertSucceeds(buyBow(parentDb()));
  });
  it('a camp flag for 15 (no slot, nothing to equip)', async () => {
    await assertSucceeds(batch(kidDb(), { gems: 185, items: ['c-flag'], lastPurchaseId: 'p1' }, [entry('p1', 'c-flag', 15)]));
  });
  it('a legendary staff for 350', async () => {
    await seed({ gems: 400 });
    await assertSucceeds(batch(kidDb(), { gems: 50, items: ['w-crystalstaff'], equipped: { weapon: 'w-crystalstaff' }, lastPurchaseId: 'p1' }, [entry('p1', 'w-crystalstaff', 350)]));
  });
  it('a second item needs a new id', async () => {
    await assertSucceeds(buyBow(kidDb()));
    await assertSucceeds(batch(kidDb(), { gems: 120, items: ['w-bow', 'g-helm'], equipped: { weapon: 'w-bow', gear: 'g-helm' }, lastPurchaseId: 'p2' }, [entry('p2', 'g-helm', 25)]));
  });
  it('a hero buy still passes with an items list already on the doc', async () => {
    await seed({ gems: 200, items: ['w-bow'], equipped: { weapon: 'w-bow' } });
    await assertSucceeds(batch(kidDb(), { gems: 185, items: ['w-bow'], equipped: { weapon: 'w-bow' }, heroes: ['knight', 'wizard'], hero: 'wizard', lastPurchaseId: 'p1' }, [heroEntry('p1', 'wizard', 15)]));
  });
  it('a run, a goal pin and an unequip pass with no purchase', async () => {
    await seed({ items: ['w-bow'], equipped: { weapon: 'w-bow' } });
    await assertSucceeds(batch(kidDb(), { xp: 500, gems: 208, items: ['w-bow'], equipped: { weapon: 'w-bow' }, goal: 'p-owl' }));
    await assertSucceeds(batch(kidDb(), { xp: 500, gems: 208, items: ['w-bow'], equipped: {}, goal: 'p-owl' }));
  });
});

describe('a buy below the price is refused', () => {
  it('the bow (55) with a drop of 20 and an entry for 20', async () => {
    await assertFails(buyBow(kidDb(), { game: { gems: 180 }, entries: [entry('p1', 'w-bow', 20)] }));
  });
  it('the bow with the right drop and an entry for 20 (the entry is under the catalog price)', async () => {
    await assertFails(buyBow(kidDb(), { entries: [entry('p1', 'w-bow', 20)] }));
  });
  it('the bow with a drop of 20 and an entry for 55 (the gems fall short of the price)', async () => {
    await assertFails(buyBow(kidDb(), { game: { gems: 180 } }));
  });
  it('the bow for free: items grow, gems stay', async () => {
    await assertFails(buyBow(kidDb(), { game: { gems: 200 }, entries: [entry('p1', 'w-bow', 55)] }));
  });
  it('an item added with a gem rise and no purchase', async () => {
    await assertFails(batch(kidDb(), { gems: 205, items: ['w-bow'], equipped: { weapon: 'w-bow' } }));
  });
  it('an item with a price of 0 in the entry', async () => {
    await assertFails(buyBow(kidDb(), { game: { gems: 200 }, entries: [entry('p1', 'w-bow', 0)] }));
  });
});

describe('an unowned or wrong-slot equip is refused', () => {
  it('equipping a weapon the kid does not own', async () => {
    await assertFails(batch(kidDb(), { equipped: { weapon: 'w-hammer' } }));
  });
  it('equipping an item that is not in the catalog', async () => {
    await assertFails(batch(kidDb(), { items: ['w-nope'], equipped: { weapon: 'w-nope' } }));
  });
  it('equipping an owned gear piece in the weapon slot', async () => {
    await seed({ items: ['g-helm'] });
    await assertFails(batch(kidDb(), { items: ['g-helm'], equipped: { weapon: 'g-helm' } }));
  });
  it('equipping an owned camp flag (it has no slot)', async () => {
    await seed({ items: ['c-flag'] });
    await assertFails(batch(kidDb(), { items: ['c-flag'], equipped: { pet: 'c-flag' } }));
  });
  it('an unknown equip slot', async () => {
    await seed({ items: ['w-bow'] });
    await assertFails(batch(kidDb(), { items: ['w-bow'], equipped: { cape: 'w-bow' } }));
  });
  it('the parent device is held to the same rule', async () => {
    await assertFails(batch(parentDb(), { equipped: { weapon: 'w-hammer' } }));
  });
  it('equipping an owned weapon passes', async () => {
    await seed({ items: ['w-bow', 'w-sword'], equipped: { weapon: 'w-bow' } });
    await assertSucceeds(batch(kidDb(), { items: ['w-bow', 'w-sword'], equipped: { weapon: 'w-sword' } }));
  });
});

describe('two entries or two items in one buy are refused', () => {
  it('two valid-looking purchases docs for one item', async () => {
    await assertFails(buyBow(kidDb(), { entries: [entry('p1', 'w-bow', 55), entry('p2', 'w-bow', 55)] }));
  });
  it('two items added in one write, one entry for the sum', async () => {
    await assertFails(batch(kidDb(), { gems: 125, items: ['w-bow', 'g-helm'], lastPurchaseId: 'p1' }, [entry('p1', 'w-bow', 75)]));
  });
  it('two items added in one write, two entries', async () => {
    await assertFails(batch(kidDb(), { gems: 120, items: ['w-bow', 'g-helm'], lastPurchaseId: 'p1' }, [entry('p1', 'w-bow', 55), entry('p2', 'g-helm', 25)]));
  });
  it('a hero and an item in one write', async () => {
    await assertFails(batch(kidDb(), { gems: 130, heroes: ['knight', 'wizard'], hero: 'wizard', items: ['w-bow'], lastPurchaseId: 'p1' }, [entry('p1', 'w-bow', 55), heroEntry('p2', 'wizard', 15)]));
  });
  it('one entry that names both a hero and an item', async () => {
    await assertFails(buyBow(kidDb(), { entries: [{ id: 'p1', itemId: 'w-bow', heroId: 'wizard', cost: 55, at: 1000 }] }));
  });
  it('an entry with neither a hero nor an item', async () => {
    await assertFails(buyBow(kidDb(), { entries: [{ id: 'p1', cost: 55, at: 1000 }] }));
  });
  it('the entry names another item than the one added', async () => {
    await assertFails(buyBow(kidDb(), { entries: [entry('p1', 'w-hammer', 55)] }));
  });
  it('a lone purchases entry with no kid doc change', async () => {
    const db = kidDb();
    const b = writeBatch(db);
    b.set(purchaseRef(db, 'p1'), entry('p1', 'w-bow', 55));
    await assertFails(b.commit());
  });
});

describe('owned items never leave and each is bought once', () => {
  it('removing an owned item', async () => {
    await seed({ items: ['w-bow', 'g-helm'] });
    await assertFails(batch(kidDb(), { items: ['w-bow'] }));
  });
  it('emptying the items list', async () => {
    await seed({ items: ['w-bow'] });
    await assertFails(batch(kidDb(), { items: [] }));
  });
  it('swapping one owned item for another (same length)', async () => {
    await seed({ items: ['w-bow'] });
    await assertFails(batch(kidDb(), { items: ['w-hammer'] }));
  });
  it('buying an item already owned', async () => {
    await seed({ items: ['w-bow'] });
    await assertFails(batch(kidDb(), { gems: 90, items: ['w-bow', 'w-bow'], lastPurchaseId: 'p1' }, [entry('p1', 'w-bow', 55)]));
  });
  it('an item that is not in the catalog', async () => {
    await assertFails(batch(kidDb(), { gems: 190, items: ['w-nope'], lastPurchaseId: 'p1' }, [entry('p1', 'w-nope', 10)]));
  });
  it('a hero id in the items list', async () => {
    await assertFails(batch(kidDb(), { gems: 185, items: ['wizard'], lastPurchaseId: 'p1' }, [entry('p1', 'wizard', 15)]));
  });
});

describe('through the repo', () => {
  it('applyGameDelta buys the bow, equips it, logs one entry with its id in lastPurchaseId', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const game = await repo.applyGameDelta(KID, { purchase: 'w-bow' });
    expect(game).toMatchObject({ gems: 145, items: ['w-bow'], equipped: { weapon: 'w-bow' } });
    const stored = (await getDoc(kidRef(parentDb()))).data() as { game: { lastPurchaseId?: string } };
    const docs = await getDocs(collection(parentDb(), `families/${FAM}/kids/${KID}/purchases`));
    expect(docs.size).toBe(1);
    expect(stored.game.lastPurchaseId).toBe(docs.docs[0]!.id);
    expect(docs.docs[0]!.data()).toMatchObject({ itemId: 'w-bow', cost: 55 });
  });
  it('a hero buy, an item buy, an equip, a goal pin and a run in a row all pass', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    await repo.applyGameDelta(KID, { purchase: 'wizard' });
    await repo.applyGameDelta(KID, { purchase: 'g-cape' });
    await repo.applyGameDelta(KID, { purchase: 'w-sword' });
    await repo.applyGameDelta(KID, { equip: 'w-sword' });
    await repo.applyGameDelta(KID, { goal: 'p-owl' });
    await repo.applyGameDelta(KID, { xp: 100, gems: 4, bestCombo: 8, playedAt: Date.now() });
    const stored = (await getDoc(kidRef(parentDb()))).data() as { game: { gems: number; items: string[]; goal: string } };
    expect(stored.game).toMatchObject({ gems: 200 - 15 - 15 - 20 + 4, items: ['g-cape', 'w-sword'], goal: 'p-owl' });
    expect((await getDocs(collection(parentDb(), `families/${FAM}/kids/${KID}/purchases`))).size).toBe(3);
  });
  it('a double confirm buys the item once', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const r = await Promise.allSettled([repo.applyGameDelta(KID, { purchase: 'w-bow' }), repo.applyGameDelta(KID, { purchase: 'w-bow' })]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await getDocs(collection(parentDb(), `families/${FAM}/kids/${KID}/purchases`))).size).toBe(1);
  });
});
