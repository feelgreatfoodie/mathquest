import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Gifting (item-powers PDR, section 3). A kid buys a catalog item for a sibling. One batch writes four docs: the giver's kid doc
// (gems drop), the giver's purchases doc (kind 'gift'), the receiver's kid doc (the item and giftFrom) and the receiver's gifts doc.
// Every name, id and number is made up. RULES_FILE runs the suite against another rules file (the red-first run uses main's).
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const OTHER_FAM = 'fam-other-uid';
const GIVER = 'kidaaaa';
const RCV = 'kidbbbb';
const THIRD = 'kidcccc';
const FOREIGN = 'kidzzzz';

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = (kidId = GIVER, familyUid = FAM) => env.authenticatedContext(`kid_${kidId}`, { role: 'kid', familyUid, kidId }).firestore();
type Db = ReturnType<typeof parentDb>;
const kidRef = (db: Db, kidId: string, fam = FAM) => doc(db, `families/${fam}/kids/${kidId}`);
const purchaseRef = (db: Db, kidId: string, id: string) => doc(db, `families/${FAM}/kids/${kidId}/purchases/${id}`);
const giftRef = (db: Db, kidId: string, id: string) => doc(db, `families/${FAM}/kids/${kidId}/gifts/${id}`);

const game = (gems: number, extra: Record<string, unknown> = {}) => ({ lastPlayedDay: '2026-11-17', xp: 467, gems, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1, ...extra });
const kidDoc = (id: string, gems: number, inventory?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, name: 'Testkid', createdAt: 1, hasPin: true,
  settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
  game: game(gems, extra),
  ...(inventory ? { inventory } : {}),
});

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-gifting', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());

async function seed(opts: { giverGems?: number; rcvInventory?: Record<string, unknown>; gifting?: boolean } = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1, ...(opts.gifting === undefined ? {} : { gifting: opts.gifting }) });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db, GIVER), kidDoc(GIVER, opts.giverGems ?? 200));
    await setDoc(kidRef(db, RCV), kidDoc(RCV, 10, opts.rcvInventory));
    await setDoc(kidRef(db, THIRD), kidDoc(THIRD, 10));
    await setDoc(doc(db, `families/${OTHER_FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(kidRef(db, FOREIGN, OTHER_FAM), kidDoc(FOREIGN, 500));
  });
}
beforeEach(async () => seed());

const RCV_INV = { items: ['c-flag'] };
interface GiftOpts {
  pid?: string;
  to?: string;
  itemId?: string;
  price?: number;
  /** Gems the giver ends with (default: 200 minus the price). */
  giverGems?: number;
  /** The giver kid doc's lastPurchaseId (default: the purchase id). */
  lastPurchaseId?: string;
  entry?: Record<string, unknown> | null;
  gift?: Record<string, unknown> | null;
  /** The receiver's inventory after the write. */
  rcvInventory?: Record<string, unknown> | null;
  /** Extra fields on the receiver kid doc write. */
  rcvExtra?: Record<string, unknown>;
  giverExtra?: Record<string, unknown>;
  giverInventory?: Record<string, unknown>;
  skipGiver?: boolean;
  skipReceiver?: boolean;
}
/** The bow, 55 gems, from GIVER to RCV (who owns a flag), as the app writes it. */
function giftBatch(db: Db, o: GiftOpts = {}) {
  const pid = o.pid ?? 'g1';
  const to = o.to ?? RCV;
  const itemId = o.itemId ?? 'w-bow';
  const price = o.price ?? 55;
  const b = writeBatch(db);
  if (!o.skipGiver) {
    b.update(kidRef(db, GIVER), {
      game: game(o.giverGems ?? 200 - price, { lastPurchaseId: o.lastPurchaseId ?? pid, ...(o.giverExtra ?? {}) }),
      ...(o.giverInventory ? { inventory: o.giverInventory } : {}),
    });
  }
  if (o.entry !== null) b.set(purchaseRef(db, GIVER, pid), o.entry ?? { id: pid, kind: 'gift', to, itemId, cost: price, at: 1000 });
  if (!o.skipReceiver) {
    const inv = o.rcvInventory === undefined ? { items: [...RCV_INV.items, itemId], giftFrom: { [itemId]: GIVER } } : o.rcvInventory;
    b.update(kidRef(db, to), { ...(inv ? { inventory: inv } : {}), ...(o.rcvExtra ?? {}) });
  }
  if (o.gift !== null) b.set(giftRef(db, to, pid), o.gift ?? { id: pid, from: GIVER, itemId, at: 1000, seen: false });
  return b.commit();
}
const seedRcv = () => seed({ rcvInventory: RCV_INV });

describe('a correct gift passes', () => {
  beforeEach(seedRcv);
  it('kid to sibling: the bow for 55, receiver gets it with giftFrom and a gift doc', async () => {
    await assertSucceeds(giftBatch(kidDb()));
    const p = parentDb();
    expect((await getDoc(kidRef(p, GIVER))).data()?.game).toMatchObject({ gems: 145, lastPurchaseId: 'g1' });
    expect((await getDoc(kidRef(p, RCV))).data()?.inventory).toEqual({ items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': GIVER } });
    expect((await getDoc(purchaseRef(p, GIVER, 'g1'))).data()).toMatchObject({ kind: 'gift', to: RCV, itemId: 'w-bow', cost: 55 });
    expect((await getDoc(giftRef(p, RCV, 'g1'))).data()).toMatchObject({ from: GIVER, itemId: 'w-bow', seen: false });
  });
  it('kid to sibling who owns nothing yet (no inventory map)', async () => {
    await seed();
    await assertSucceeds(giftBatch(kidDb(), { rcvInventory: { items: ['w-bow'], giftFrom: { 'w-bow': GIVER } } }));
  });
  it('a legendary staff for 350', async () => {
    await seed({ giverGems: 400, rcvInventory: RCV_INV });
    await assertSucceeds(giftBatch(kidDb(), { itemId: 'w-crystalstaff', price: 350, giverGems: 50, rcvInventory: { items: ['c-flag', 'w-crystalstaff'], giftFrom: { 'w-crystalstaff': GIVER } } }));
  });
  it('the receiver keeps an equipped item and a goal through the gift', async () => {
    await seed({ rcvInventory: { items: ['c-flag', 'g-cape'], equipped: { gear: 'g-cape' }, goal: 'p-owl' } });
    await assertSucceeds(giftBatch(kidDb(), { rcvInventory: { items: ['c-flag', 'g-cape', 'w-bow'], equipped: { gear: 'g-cape' }, goal: 'p-owl', giftFrom: { 'w-bow': GIVER } } }));
  });
  it('a second gift keeps the first giftFrom entry', async () => {
    await seed({ rcvInventory: { items: ['w-sword'], giftFrom: { 'w-sword': THIRD } } });
    await assertSucceeds(giftBatch(kidDb(), { rcvInventory: { items: ['w-sword', 'w-bow'], giftFrom: { 'w-sword': THIRD, 'w-bow': GIVER } } }));
  });
  it('parent device playing as the giver', async () => {
    await assertSucceeds(giftBatch(parentDb()));
  });
  it('the giver spends the last gems down to 0', async () => {
    await seed({ giverGems: 55, rcvInventory: RCV_INV });
    await assertSucceeds(giftBatch(kidDb(), { giverGems: 0 }));
  });
});

describe('a gift that is not backed fails', () => {
  beforeEach(seedRcv);
  // The 60-item cap (inventoryOk's inventoryCap, shared with giftReceiveOk). Filler ids stand in for owned items.
  const fill = (n: number) => Array.from({ length: n }, (_, i) => `f-${i}`);
  it('a receiver holding 60 items cannot get a 61st by gift', async () => {
    await seed({ rcvInventory: { items: fill(60) } });
    await assertFails(giftBatch(kidDb(), { rcvInventory: { items: [...fill(60), 'w-bow'], giftFrom: { 'w-bow': GIVER } } }));
    expect((await getDoc(kidRef(parentDb(), RCV))).data()?.inventory?.items).toHaveLength(60);
  });
  it('control: a receiver holding 59 items gets the 60th by gift', async () => {
    await seed({ rcvInventory: { items: fill(59) } });
    await assertSucceeds(giftBatch(kidDb(), { rcvInventory: { items: [...fill(59), 'w-bow'], giftFrom: { 'w-bow': GIVER } } }));
    expect((await getDoc(kidRef(parentDb(), RCV))).data()?.inventory?.items).toHaveLength(60);
  });
  it('the receiver already owns the item', async () => {
    await assertFails(giftBatch(kidDb(), { itemId: 'c-flag', price: 15, rcvInventory: { items: ['c-flag', 'c-flag'], giftFrom: { 'c-flag': GIVER } } }));
  });
  it('an item not in the catalog', async () => {
    await assertFails(giftBatch(kidDb(), { itemId: 'w-excalibur', price: 55, rcvInventory: { items: ['c-flag', 'w-excalibur'], giftFrom: { 'w-excalibur': GIVER } } }));
  });
  it('a hero id is not a gift item', async () => {
    await assertFails(giftBatch(kidDb(), { itemId: 'dragon', price: 100, rcvInventory: { items: ['c-flag', 'dragon'], giftFrom: { dragon: GIVER } } }));
  });
  it('no purchase record', async () => {
    await assertFails(giftBatch(kidDb(), { entry: null }));
  });
  it('a purchase record with another price than the catalog (the bow at 5)', async () => {
    await assertFails(giftBatch(kidDb(), { giverGems: 195, entry: { id: 'g1', kind: 'gift', to: RCV, itemId: 'w-bow', cost: 5, at: 1000 } }));
  });
  it('the giver pays less than the price (free for 40)', async () => {
    await assertFails(giftBatch(kidDb(), { giverGems: 160 }));
  });
  it('the giver pays nothing', async () => {
    await assertFails(giftBatch(kidDb(), { giverGems: 200 }));
  });
  it('the purchase record names another receiver than the kid doc written', async () => {
    await assertFails(giftBatch(kidDb(), { entry: { id: 'g1', kind: 'gift', to: THIRD, itemId: 'w-bow', cost: 55, at: 1000 } }));
  });
  it('the purchase record names another item than the one added', async () => {
    await assertFails(giftBatch(kidDb(), { entry: { id: 'g1', kind: 'gift', to: RCV, itemId: 'w-sword', cost: 20, at: 1000 }, giverGems: 180 }));
  });
  it('the giver kid doc does not name the purchase record', async () => {
    await assertFails(giftBatch(kidDb(), { lastPurchaseId: 'other' }));
  });
  it('the gifts doc is missing', async () => {
    await assertFails(giftBatch(kidDb(), { gift: null }));
  });
  it('the gifts doc names another giver', async () => {
    await assertFails(giftBatch(kidDb(), { gift: { id: 'g1', from: THIRD, itemId: 'w-bow', at: 1000, seen: false } }));
  });
  it('the gifts doc is created already seen', async () => {
    await assertFails(giftBatch(kidDb(), { gift: { id: 'g1', from: GIVER, itemId: 'w-bow', at: 1000, seen: true } }));
  });
  it('the gifts doc has an extra field', async () => {
    await assertFails(giftBatch(kidDb(), { gift: { id: 'g1', from: GIVER, itemId: 'w-bow', at: 1000, seen: false, note: 'hi' } }));
  });
  it('the receiver write is left out (the gems burn, nobody gets the item)', async () => {
    await assertFails(giftBatch(kidDb(), { skipReceiver: true }));
  });
  it('the giver write is left out (a free item)', async () => {
    await assertFails(giftBatch(kidDb(), { skipGiver: true }));
  });
  it('the giver gets the item too (a gift that doubles as a buy)', async () => {
    await assertFails(giftBatch(kidDb(), { giverInventory: { items: ['w-bow'] } }));
  });
  it('two items land on the receiver for one price', async () => {
    await assertFails(giftBatch(kidDb(), { rcvInventory: { items: ['c-flag', 'w-bow', 'w-sword'], giftFrom: { 'w-bow': GIVER } } }));
  });
  it('two items land on the receiver with the gifted one last (a free extra sword)', async () => {
    await assertFails(giftBatch(kidDb(), { rcvInventory: { items: ['c-flag', 'w-sword', 'w-bow'], giftFrom: { 'w-bow': GIVER } } }));
  });
  it('the receiver loses an item', async () => {
    await assertFails(giftBatch(kidDb(), { rcvInventory: { items: ['w-bow'], giftFrom: { 'w-bow': GIVER } } }));
  });
  it('giftFrom names someone else than the giver', async () => {
    await assertFails(giftBatch(kidDb(), { rcvInventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': THIRD } } }));
  });
  it('giftFrom rewrites an older entry', async () => {
    await seed({ rcvInventory: { items: ['w-sword'], giftFrom: { 'w-sword': THIRD } } });
    await assertFails(giftBatch(kidDb(), { rcvInventory: { items: ['w-sword', 'w-bow'], giftFrom: { 'w-sword': GIVER, 'w-bow': GIVER } } }));
  });
  it('the receiver equipped slot changes', async () => {
    await assertFails(giftBatch(kidDb(), { rcvInventory: { items: ['c-flag', 'w-bow'], equipped: { weapon: 'w-bow' }, giftFrom: { 'w-bow': GIVER } } }));
  });
  it('the receiver kid doc gains gems in the same write', async () => {
    await assertFails(giftBatch(kidDb(), { rcvExtra: { game: game(1000) } }));
  });
  it('the receiver kid doc is renamed in the same write', async () => {
    await assertFails(giftBatch(kidDb(), { rcvExtra: { name: 'Renamed' } }));
  });
  it('a gift to self', async () => {
    await assertFails(giftBatch(kidDb(), { to: GIVER, rcvInventory: { items: ['w-bow'], giftFrom: { 'w-bow': GIVER } } }));
  });
  it('a gift to a kid that does not exist', async () => {
    await assertFails(giftBatch(kidDb(), { to: 'kidnone' }));
  });
  it('a purchases doc with a kind other than gift', async () => {
    await assertFails(giftBatch(kidDb(), { entry: { id: 'g1', kind: 'sale', to: RCV, itemId: 'w-bow', cost: 55, at: 1000 } }));
  });
  it('a gift purchase doc with an extra field', async () => {
    await assertFails(giftBatch(kidDb(), { entry: { id: 'g1', kind: 'gift', to: RCV, itemId: 'w-bow', cost: 55, at: 1000, refund: 10 } }));
  });
});

describe('who may write across kids', () => {
  beforeEach(seedRcv);
  it('a kid of another family cannot gift into this family', async () => {
    const db = kidDb(FOREIGN, OTHER_FAM);
    const b = writeBatch(db);
    b.update(kidRef(db, FOREIGN, OTHER_FAM), { game: game(445, { lastPurchaseId: 'g1' }) });
    b.set(doc(db, `families/${OTHER_FAM}/kids/${FOREIGN}/purchases/g1`), { id: 'g1', kind: 'gift', to: RCV, itemId: 'w-bow', cost: 55, at: 1 });
    b.update(kidRef(db, RCV), { inventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': FOREIGN } } });
    await assertFails(b.commit());
  });
  it('a kid token that names another family in the path is refused', async () => {
    const db = kidDb(GIVER, OTHER_FAM);
    await assertFails(giftBatch(db));
  });
  it('an unsigned client cannot gift', async () => {
    await assertFails(giftBatch(env.unauthenticatedContext().firestore()));
  });
  it('a sibling cannot write the receiver kid doc alone (no purchase record, no gift doc)', async () => {
    await assertFails(updateDoc(kidRef(kidDb(), RCV), { inventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': GIVER } } }));
  });
  it('a sibling cannot raise the receiver gems', async () => {
    await assertFails(updateDoc(kidRef(kidDb(), RCV), { game: game(15) }));
  });
  it('a sibling cannot write the receiver cards or world save', async () => {
    const db = kidDb();
    await assertFails(setDoc(doc(db, `families/${FAM}/kids/${RCV}/cards/c1`), { id: 'c1' }));
    await assertFails(setDoc(doc(db, `families/${FAM}/kids/${RCV}/sessions/s1`), { id: 's1' }));
  });
  it('a sibling cannot delete the receiver kid doc', async () => {
    await assertFails(env.authenticatedContext('x', { role: 'kid', familyUid: FAM, kidId: GIVER }).firestore().doc(`families/${FAM}/kids/${RCV}`).delete());
  });
});

describe('the receiver own writes', () => {
  beforeEach(async () => {
    await seedRcv();
    await giftBatch(kidDb());
  });
  it('the receiver marks the gift seen', async () => {
    await assertSucceeds(updateDoc(giftRef(kidDb(RCV), RCV, 'g1'), { seen: true }));
  });
  it('a grown-up marks the gift seen', async () => {
    await assertSucceeds(updateDoc(giftRef(parentDb(), RCV, 'g1'), { seen: true }));
  });
  it('the giver cannot mark the gift seen', async () => {
    await assertFails(updateDoc(giftRef(kidDb(), RCV, 'g1'), { seen: true }));
  });
  it('seen cannot go back to false', async () => {
    await updateDoc(giftRef(kidDb(RCV), RCV, 'g1'), { seen: true });
    await assertFails(updateDoc(giftRef(kidDb(RCV), RCV, 'g1'), { seen: false }));
  });
  it('the gift itself cannot be edited', async () => {
    await assertFails(updateDoc(giftRef(kidDb(RCV), RCV, 'g1'), { itemId: 'w-sword' }));
    await assertFails(updateDoc(giftRef(kidDb(RCV), RCV, 'g1'), { from: THIRD }));
  });
  it('a gift cannot be deleted', async () => {
    await assertFails(env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore().doc(`families/${FAM}/kids/${RCV}/gifts/g1`).delete());
  });
  it('the receiver and a grown-up read the gift; the giver and a third sibling do not', async () => {
    await assertSucceeds(getDoc(giftRef(kidDb(RCV), RCV, 'g1')));
    await assertSucceeds(getDoc(giftRef(parentDb(), RCV, 'g1')));
    await assertFails(getDoc(giftRef(kidDb(), RCV, 'g1')));
    await assertFails(getDoc(giftRef(kidDb(THIRD), RCV, 'g1')));
  });
  it('the receiver cannot forge a giftFrom on their own doc', async () => {
    await assertFails(updateDoc(kidRef(kidDb(RCV), RCV), { inventory: { items: ['c-flag', 'w-bow', 'p-owl'], giftFrom: { 'w-bow': GIVER, 'p-owl': GIVER } } }));
  });
  it('the receiver cannot rewrite giftFrom without a new item', async () => {
    await assertFails(updateDoc(kidRef(kidDb(RCV), RCV), { inventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': THIRD } } }));
  });
  it('a save from an older bundle, which drops giftFrom, still passes', async () => {
    await assertSucceeds(updateDoc(kidRef(kidDb(RCV), RCV), { inventory: { items: ['c-flag', 'w-bow'], equipped: { weapon: 'w-bow' } } }));
  });
  it('a plain run save with the gifted item passes', async () => {
    await assertSucceeds(updateDoc(kidRef(kidDb(RCV), RCV), { game: game(15, {}) }));
  });
});

describe('a kid cannot forge a gift with their own write', () => {
  beforeEach(seedRcv);
  it('a kid cannot add giftFrom to their own doc without a gift', async () => {
    await assertFails(updateDoc(kidRef(kidDb(RCV), RCV), { inventory: { items: ['c-flag'], giftFrom: { 'c-flag': GIVER } } }));
  });
  it('a kid cannot use a gift purchase record for a hero buy', async () => {
    const db = kidDb();
    const b = writeBatch(db);
    b.update(kidRef(db, GIVER), { game: game(100, { heroes: ['knight', 'dragon'], lastPurchaseId: 'g1' }) });
    b.set(purchaseRef(db, GIVER, 'g1'), { id: 'g1', kind: 'gift', to: RCV, itemId: 'w-bow', cost: 100, at: 1 });
    await assertFails(b.commit());
  });
  it('a gift record cannot back a plain gem drop (no receiver, wrong price)', async () => {
    const db = kidDb();
    const b = writeBatch(db);
    b.update(kidRef(db, GIVER), { game: game(100, { lastPurchaseId: 'g1' }) });
    b.set(purchaseRef(db, GIVER, 'g1'), { id: 'g1', kind: 'gift', to: RCV, itemId: 'w-bow', cost: 100, at: 1 });
    await assertFails(b.commit());
  });
  it('a gift id is not reused', async () => {
    await giftBatch(kidDb());
    await seed({ giverGems: 145, rcvInventory: { items: ['c-flag', 'w-bow'] } });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(purchaseRef(ctx.firestore() as Db, GIVER, 'g1'), { id: 'g1', kind: 'gift', to: RCV, itemId: 'w-bow', cost: 55, at: 1 });
      await updateDoc(kidRef(ctx.firestore() as Db, GIVER), { game: game(145, { lastPurchaseId: 'g1' }) });
    });
    await assertFails(giftBatch(kidDb(), { itemId: 'w-sword', price: 20, giverGems: 125, rcvInventory: { items: ['c-flag', 'w-bow', 'w-sword'], giftFrom: { 'w-sword': GIVER } } }));
  });
});

describe('the family gifting switch', () => {
  it('gifting off: the gift fails', async () => {
    await seed({ gifting: false, rcvInventory: RCV_INV });
    await assertFails(giftBatch(kidDb()));
  });
  it('gifting explicitly on: the gift passes', async () => {
    await seed({ gifting: true, rcvInventory: RCV_INV });
    await assertSucceeds(giftBatch(kidDb()));
  });
  it('no switch stored reads as on', async () => {
    await seed({ rcvInventory: RCV_INV });
    await assertSucceeds(giftBatch(kidDb()));
  });
  it('the grown-up turns gifting off and on', async () => {
    const famRef = doc(parentDb(), `families/${FAM}`);
    await assertSucceeds(updateDoc(famRef, { gifting: false }));
    await assertSucceeds(updateDoc(famRef, { gifting: true }));
  });
  it('the switch must be a boolean', async () => {
    await assertFails(updateDoc(doc(parentDb(), `families/${FAM}`), { gifting: 'no' }));
  });
  it('a kid cannot turn gifting on or off, or read the family doc', async () => {
    await assertFails(updateDoc(doc(kidDb(), `families/${FAM}`), { gifting: true }));
    await assertFails(getDoc(doc(kidDb(), `families/${FAM}`)));
  });
  it('a stranger parent cannot change the switch', async () => {
    const other = env.authenticatedContext('someone-else', { email: 'x@example.com', email_verified: true }).firestore();
    await assertFails(updateDoc(doc(other, `families/${FAM}`), { gifting: false }));
  });
});

describe('a sibling reads the kid doc while gifting is on', () => {
  it('on: a sibling reads the receiver kid doc and lists the family kids', async () => {
    await seedRcv();
    await assertSucceeds(getDoc(kidRef(kidDb(), RCV)));
    const snap = await assertSucceeds(getDocs(collection(kidDb(), `families/${FAM}/kids`)));
    expect(snap.docs.map((d) => d.id).sort()).toEqual([GIVER, RCV, THIRD]);
  });
  it('off: a sibling cannot read the kid doc, but a kid reads their own', async () => {
    await seed({ gifting: false });
    await assertFails(getDoc(kidRef(kidDb(), RCV)));
    await assertSucceeds(getDoc(kidRef(kidDb(), GIVER)));
  });
  it('a kid of another family cannot read this family kid doc', async () => {
    await seedRcv();
    await assertFails(getDoc(kidRef(kidDb(FOREIGN, OTHER_FAM), RCV)));
  });
  it('an unsigned client cannot read a kid doc', async () => {
    await seedRcv();
    await assertFails(getDoc(kidRef(env.unauthenticatedContext().firestore(), RCV)));
  });
  it('a sibling cannot read the cards or purchases of another kid', async () => {
    await seedRcv();
    await assertFails(getDoc(doc(kidDb(), `families/${FAM}/kids/${RCV}/cards/c1`)));
    await assertFails(getDocs(collection(kidDb(), `families/${FAM}/kids/${RCV}/purchases`)));
  });
});

describe('the older rules still hold with the gift branch in', () => {
  beforeEach(seedRcv);
  it('a plain item buy still passes', async () => {
    const db = kidDb();
    const b = writeBatch(db);
    b.update(kidRef(db, GIVER), { game: game(145, { lastPurchaseId: 'p1' }), inventory: { items: ['w-bow'] } });
    b.set(purchaseRef(db, GIVER, 'p1'), { id: 'p1', itemId: 'w-bow', cost: 55, at: 1000 });
    await assertSucceeds(b.commit());
  });
  it('a bare gem drop with no record still fails', async () => {
    await assertFails(updateDoc(kidRef(kidDb(), GIVER), { game: game(100) }));
  });
});
