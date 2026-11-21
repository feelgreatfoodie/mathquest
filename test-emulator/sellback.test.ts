import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Selling back (item-powers PDR, section 4). A kid sells an owned shop item for half its catalog price, rounded down. One batch writes two
// docs: the kid doc (gems rise by the refund, lastPurchaseId names the record, inventory.items loses the sold item) and the purchases doc
// { id, kind: 'sale', itemId, refund, at }. Every name, id and number is made up. RULES_FILE runs the suite against another rules file
// (the red-first run uses main's, and each mutation run removes one clause).
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const OTHER_FAM = 'fam-other-uid';
const KID = 'kidaaaa';
const SIB = 'kidbbbb';
const FOREIGN = 'kidzzzz';
const DAY = 24 * 60 * 60 * 1000;

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = (kidId = KID, familyUid = FAM) => env.authenticatedContext(`kid_${kidId}`, { role: 'kid', familyUid, kidId }).firestore();
type Db = ReturnType<typeof parentDb>;
const kidRef = (db: Db, kidId: string, fam = FAM) => doc(db, `families/${fam}/kids/${kidId}`);
const purchaseRef = (db: Db, kidId: string, id: string, fam = FAM) => doc(db, `families/${fam}/kids/${kidId}/purchases/${id}`);

const game = (gems: number, extra: Record<string, unknown> = {}) => ({ lastPlayedDay: '2026-11-17', xp: 467, gems, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1, ...extra });
const kidDoc = (id: string, gems: number, inventory?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, name: 'Testkid', createdAt: 1, hasPin: true,
  settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
  game: game(gems, extra),
  ...(inventory ? { inventory } : {}),
});

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-sellback', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());

const START_INV = { items: ['c-flag', 'w-bow', 'g-cape'] };
async function seed(opts: { inventory?: Record<string, unknown>; gems?: number; selling?: boolean; gameExtra?: Record<string, unknown> } = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1, ...(opts.selling === undefined ? {} : { selling: opts.selling }) });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db, KID), kidDoc(KID, opts.gems ?? 100, opts.inventory ?? START_INV, opts.gameExtra ?? { lastPurchaseId: 'old1' }));
    await setDoc(kidRef(db, SIB), kidDoc(SIB, 10));
    await setDoc(doc(db, `families/${OTHER_FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(kidRef(db, FOREIGN, OTHER_FAM), kidDoc(FOREIGN, 500, { items: ['w-bow'] }, { lastPurchaseId: 'old1' }));
  });
}
beforeEach(async () => seed());

interface SaleOpts {
  pid?: string;
  itemId?: string;
  refund?: number;
  /** Gems after the write (default: 100 plus the refund). */
  gems?: number;
  /** The game map after the write, merged over the default (gems, lastPurchaseId). */
  gameExtra?: Record<string, unknown>;
  lastPurchaseId?: string;
  entry?: Record<string, unknown> | null;
  /** The inventory after the write (default: the start items without the sold one). */
  inventory?: Record<string, unknown>;
  fam?: string;
  kid?: string;
  /** Write the kid doc but not the sale record. */
  skipKid?: boolean;
}
/** The bow, 55 gems, sold for 27: the kid doc and the sale record, as the app writes them. */
function saleBatch(db: Db, o: SaleOpts = {}) {
  const pid = o.pid ?? 's1';
  const itemId = o.itemId ?? 'w-bow';
  const refund = o.refund ?? 27;
  const fam = o.fam ?? FAM;
  const kid = o.kid ?? KID;
  const b = writeBatch(db);
  if (!o.skipKid) {
    const items = START_INV.items.filter((i) => i !== itemId);
    b.update(kidRef(db, kid, fam), {
      game: game(o.gems ?? 100 + refund, { lastPurchaseId: o.lastPurchaseId ?? pid, ...(o.gameExtra ?? {}) }),
      inventory: o.inventory ?? { items },
    });
  }
  if (o.entry !== null) b.set(purchaseRef(db, kid, pid, fam), o.entry ?? { id: pid, kind: 'sale', itemId, refund, at: 1000 });
  return b.commit();
}
const ts = (msAgo: number) => Timestamp.fromMillis(Date.now() - msAgo);

describe('a correct sale passes', () => {
  it('the bow, price 55 (odd), refunds 27: the kid doc and the sale record', async () => {
    await assertSucceeds(saleBatch(kidDb()));
    const p = parentDb();
    expect((await getDoc(kidRef(p, KID))).data()?.game).toMatchObject({ gems: 127, lastPurchaseId: 's1', xp: 467 });
    expect((await getDoc(kidRef(p, KID))).data()?.inventory).toEqual({ items: ['c-flag', 'g-cape'] });
    expect((await getDoc(purchaseRef(p, KID, 's1'))).data()).toEqual({ id: 's1', kind: 'sale', itemId: 'w-bow', refund: 27, at: 1000 });
  });
  it('a common item: the sword, price 20, refunds 10', async () => {
    await seed({ inventory: { items: ['w-sword', 'c-flag'] } });
    await assertSucceeds(saleBatch(kidDb(), { itemId: 'w-sword', refund: 10, inventory: { items: ['c-flag'] } }));
  });
  it('the last item sold leaves an empty list', async () => {
    await seed({ inventory: { items: ['c-flag'] } });
    await assertSucceeds(saleBatch(kidDb(), { itemId: 'c-flag', refund: 7, inventory: { items: [] } }));
  });
  it('an equipped item: the sale clears its slot in the same write and keeps the others', async () => {
    await seed({ inventory: { items: ['c-flag', 'w-bow', 'g-cape'], equipped: { weapon: 'w-bow', gear: 'g-cape' } } });
    await assertSucceeds(saleBatch(kidDb(), { inventory: { items: ['c-flag', 'g-cape'], equipped: { gear: 'g-cape' } } }));
    expect((await getDoc(kidRef(parentDb(), KID))).data()?.inventory).toEqual({ items: ['c-flag', 'g-cape'], equipped: { gear: 'g-cape' } });
  });
  it('the goal stays through a sale', async () => {
    await seed({ inventory: { items: ['c-flag', 'w-bow'], goal: 'p-owl' } });
    await assertSucceeds(saleBatch(kidDb(), { inventory: { items: ['c-flag'], goal: 'p-owl' } }));
  });
  it('a gifted item 8 days after the gift: the sale removes giftFrom and giftAt of that item only', async () => {
    const cape = ts(DAY);
    await seed({ inventory: { items: ['c-flag', 'w-bow', 'g-cape'], giftFrom: { 'w-bow': SIB, 'g-cape': SIB }, giftAt: { 'w-bow': ts(8 * DAY), 'g-cape': cape } } });
    await assertSucceeds(saleBatch(kidDb(), { inventory: { items: ['c-flag', 'g-cape'], giftFrom: { 'g-cape': SIB }, giftAt: { 'g-cape': cape } } }));
    expect((await getDoc(kidRef(parentDb(), KID))).data()?.inventory).toEqual({ items: ['c-flag', 'g-cape'], giftFrom: { 'g-cape': SIB }, giftAt: { 'g-cape': cape } });
  });
  it('the only gifted item sold leaves empty giftFrom and giftAt maps', async () => {
    await seed({ inventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': SIB }, giftAt: { 'w-bow': ts(30 * DAY) } } });
    await assertSucceeds(saleBatch(kidDb(), { inventory: { items: ['c-flag'], giftFrom: {}, giftAt: {} } }));
  });
  it('the parent device playing as the kid sells through the same path', async () => {
    await assertSucceeds(saleBatch(parentDb()));
  });
  it('a re-buy after the sale uses the normal buy path: the item is not owned, gems drop by the price', async () => {
    await assertSucceeds(saleBatch(kidDb()));
    const db = kidDb();
    const b = writeBatch(db);
    b.update(kidRef(db, KID), { game: game(127 - 55, { lastPurchaseId: 'b1' }), inventory: { items: ['c-flag', 'g-cape', 'w-bow'] } });
    b.set(purchaseRef(db, KID, 'b1'), { id: 'b1', itemId: 'w-bow', cost: 55, at: 2000 });
    await assertSucceeds(b.commit());
  });
  it('a sale does not touch the daily gem throttle fields', async () => {
    await seed({ gameExtra: { lastPurchaseId: 'old1', gemsEarnedToday: 9, gemsDay: '2026-11-17' } });
    await assertSucceeds(saleBatch(kidDb(), { gameExtra: { gemsEarnedToday: 9, gemsDay: '2026-11-17' } }));
  });
});

describe('a sale that is not backed fails', () => {
  it('a refund too high: the kid doc rises by 28 and the record says 28', async () => {
    await assertFails(saleBatch(kidDb(), { refund: 28, gems: 128 }));
  });
  it('a refund too low: 26', async () => {
    await assertFails(saleBatch(kidDb(), { refund: 26, gems: 126 }));
  });
  it('a record that says 27 while gems rise by 40', async () => {
    await assertFails(saleBatch(kidDb(), { gems: 140 }));
  });
  it('a record that says 40 while gems rise by 27', async () => {
    await assertFails(saleBatch(kidDb(), { refund: 40 }));
  });
  it('no sale record at all: gems rise and an item leaves with nothing behind', async () => {
    await assertFails(saleBatch(kidDb(), { entry: null }));
    expect((await getDoc(kidRef(parentDb(), KID))).data()?.game.gems).toBe(100);
  });
  it('a sale record alone, with no kid doc change', async () => {
    await assertFails(saleBatch(kidDb(), { skipKid: true }));
  });
  it('a record of another kind (a buy shape with a refund)', async () => {
    await assertFails(saleBatch(kidDb(), { entry: { id: 's1', kind: 'gift', itemId: 'w-bow', refund: 27, at: 1000 } }));
  });
  it('a record with no kind (a buy shape)', async () => {
    await assertFails(saleBatch(kidDb(), { entry: { id: 's1', itemId: 'w-bow', refund: 27, at: 1000 } }));
  });
  it('a record with an extra field', async () => {
    await assertFails(saleBatch(kidDb(), { entry: { id: 's1', kind: 'sale', itemId: 'w-bow', refund: 27, at: 1000, note: 'x' } }));
  });
  it('a record missing a field (no at)', async () => {
    await assertFails(saleBatch(kidDb(), { entry: { id: 's1', kind: 'sale', itemId: 'w-bow', refund: 27 } }));
  });
  it('a record whose id is not its doc id', async () => {
    await assertFails(saleBatch(kidDb(), { entry: { id: 'other', kind: 'sale', itemId: 'w-bow', refund: 27, at: 1000 } }));
  });
  it('a record that names a different item than the one removed', async () => {
    await assertFails(saleBatch(kidDb(), { entry: { id: 's1', kind: 'sale', itemId: 'g-cape', refund: 7, at: 1000 } }));
  });
  it('a legendary item (the golden armor, 300) cannot be sold', async () => {
    await seed({ inventory: { items: ['c-flag', 'g-goldarmor'] } });
    await assertFails(saleBatch(kidDb(), { itemId: 'g-goldarmor', refund: 150, gems: 250, inventory: { items: ['c-flag'] } }));
  });
  it('a legendary item (the crystal staff, 350) cannot be sold', async () => {
    await seed({ inventory: { items: ['c-flag', 'w-crystalstaff'] } });
    await assertFails(saleBatch(kidDb(), { itemId: 'w-crystalstaff', refund: 175, gems: 275, inventory: { items: ['c-flag'] } }));
  });
  it('a hero cannot be sold: the hero list shrinks and gems rise', async () => {
    await seed({ gameExtra: { lastPurchaseId: 'old1', heroes: ['knight', 'wizard'], hero: 'wizard' } });
    await assertFails(saleBatch(kidDb(), { entry: { id: 's1', kind: 'sale', itemId: 'wizard', refund: 7, at: 1000 }, gems: 107, inventory: START_INV }));
    await assertFails(saleBatch(kidDb(), { entry: { id: 's1', kind: 'sale', heroId: 'wizard', refund: 7, at: 1000 }, gems: 107, inventory: START_INV }));
  });
  it('an item that is not in the catalog', async () => {
    await seed({ inventory: { items: ['c-flag', 'x-fake'] } });
    await assertFails(saleBatch(kidDb(), { itemId: 'x-fake', refund: 50, gems: 150, inventory: { items: ['c-flag'] } }));
  });
  it('an item the kid does not own', async () => {
    await seed({ inventory: { items: ['c-flag'] } });
    await assertFails(saleBatch(kidDb(), { itemId: 'w-bow', inventory: { items: ['c-flag'] } }));
    await assertFails(saleBatch(kidDb(), { itemId: 'w-bow', inventory: { items: [] } }));
  });
  it('the item is not removed: gems rise and the list is unchanged', async () => {
    await assertFails(saleBatch(kidDb(), { inventory: START_INV }));
  });
  it('two items removed in one sale', async () => {
    await assertFails(saleBatch(kidDb(), { inventory: { items: ['c-flag'] } }));
  });
  it('a different item removed than the one sold (the cape leaves, the record says bow)', async () => {
    await assertFails(saleBatch(kidDb(), { inventory: { items: ['c-flag', 'w-bow'] } }));
  });
  it('an item removed and another one added in the same sale', async () => {
    await assertFails(saleBatch(kidDb(), { inventory: { items: ['c-flag', 'g-cape', 'w-sword'] } }));
  });
  it('a gifted item 2 days after the gift is locked', async () => {
    await seed({ inventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': SIB }, giftAt: { 'w-bow': ts(2 * DAY) } } });
    await assertFails(saleBatch(kidDb(), { inventory: { items: ['c-flag'], giftFrom: {}, giftAt: {} } }));
  });
  it('a gifted item 6 days 23 hours after the gift is still locked', async () => {
    await seed({ inventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': SIB }, giftAt: { 'w-bow': ts(7 * DAY - 3600_000) } } });
    await assertFails(saleBatch(kidDb(), { inventory: { items: ['c-flag'], giftFrom: {}, giftAt: {} } }));
  });
  it('a gifted item with no giftAt never sells (fail closed)', async () => {
    await seed({ inventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': SIB } } });
    await assertFails(saleBatch(kidDb(), { inventory: { items: ['c-flag'], giftFrom: {} } }));
  });
  it('a gifted item sold but its giftFrom and giftAt kept', async () => {
    await seed({ inventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': SIB }, giftAt: { 'w-bow': ts(9 * DAY) } } });
    await assertFails(saleBatch(kidDb(), { inventory: { items: ['c-flag'], giftFrom: { 'w-bow': SIB }, giftAt: { 'w-bow': ts(9 * DAY) } } }));
  });
  it('a sale that also removes the giftFrom note of another gifted item', async () => {
    const cape = ts(DAY);
    await seed({ inventory: { items: ['c-flag', 'w-bow', 'g-cape'], giftFrom: { 'g-cape': SIB }, giftAt: { 'g-cape': cape } } });
    await assertFails(saleBatch(kidDb(), { inventory: { items: ['c-flag', 'g-cape'], giftFrom: {}, giftAt: { 'g-cape': cape } } }));
    await assertFails(saleBatch(kidDb(), { inventory: { items: ['c-flag', 'g-cape'], giftFrom: { 'g-cape': SIB }, giftAt: {} } }));
    await assertSucceeds(saleBatch(kidDb(), { inventory: { items: ['c-flag', 'g-cape'], giftFrom: { 'g-cape': SIB }, giftAt: { 'g-cape': cape } } }));
  });
  it('the equipped slot still names the sold item', async () => {
    await seed({ inventory: { items: ['c-flag', 'w-bow'], equipped: { weapon: 'w-bow' } } });
    await assertFails(saleBatch(kidDb(), { inventory: { items: ['c-flag'], equipped: { weapon: 'w-bow' } } }));
  });
  it('an equipped item sold with the slot left out of the write is fine, but a pet slot naming it is not', async () => {
    await seed({ inventory: { items: ['c-flag', 'p-dog'], equipped: { pet: 'p-dog' } } });
    await assertFails(saleBatch(kidDb(), { itemId: 'p-dog', refund: 40, gems: 140, inventory: { items: ['c-flag'], equipped: { pet: 'p-dog' } } }));
    await assertSucceeds(saleBatch(kidDb(), { itemId: 'p-dog', refund: 40, gems: 140, inventory: { items: ['c-flag'] } }));
  });
  it('game xp changed in the sale write', async () => {
    await assertFails(saleBatch(kidDb(), { gameExtra: { xp: 500 } }));
  });
  it('another game field changed in the sale write (streakDays, bestCombo)', async () => {
    await assertFails(saleBatch(kidDb(), { gameExtra: { streakDays: 9 } }));
    await assertFails(saleBatch(kidDb(), { gameExtra: { bestCombo: 20 } }));
  });
  it('the daily throttle fields changed in the sale write', async () => {
    await assertFails(saleBatch(kidDb(), { gameExtra: { gemsEarnedToday: 5, gemsDay: '2026-11-17' } }));
  });
  it('a hero added in the sale write', async () => {
    await assertFails(saleBatch(kidDb(), { gameExtra: { heroes: ['knight', 'wizard'] } }));
  });
  it('a run +10 gems on top of the refund (rise 37)', async () => {
    await assertFails(saleBatch(kidDb(), { gems: 137 }));
  });
  it('a run +10 gems and xp on top of the refund, record says 37', async () => {
    await assertFails(saleBatch(kidDb(), { gems: 137, refund: 37, gameExtra: { xp: 477 } }));
  });
  it('a record with a float refund', async () => {
    await assertFails(saleBatch(kidDb(), { refund: 27.5, gems: 127.5 }));
  });
  it('selling is off for the family', async () => {
    await seed({ selling: false });
    await assertFails(saleBatch(kidDb()));
    await assertFails(saleBatch(parentDb()));
    expect((await getDoc(kidRef(parentDb(), KID))).data()?.game.gems).toBe(100);
  });
  it('selling switched back on works again', async () => {
    await seed({ selling: false });
    await assertSucceeds(updateDoc(doc(parentDb(), `families/${FAM}`), { selling: true }));
    await assertSucceeds(saleBatch(kidDb()));
  });
  it('a kid token of another family cannot sell this kid’s item', async () => {
    await assertFails(saleBatch(kidDb(KID, OTHER_FAM)));
  });
  it('a sibling kid token cannot sell this kid’s item', async () => {
    await assertFails(saleBatch(kidDb(SIB)));
  });
  it('another family’s parent cannot sell', async () => {
    const other = env.authenticatedContext('fam-other-uid', { email: 'other@example.com', email_verified: true }).firestore();
    await assertFails(saleBatch(other));
  });
  it('a kid of another family selling in their own family path still needs a record', async () => {
    await assertFails(saleBatch(kidDb(FOREIGN, OTHER_FAM), { fam: OTHER_FAM, kid: FOREIGN, entry: null, inventory: { items: [] } }));
  });
  it('signed out', async () => {
    await assertFails(saleBatch(env.unauthenticatedContext().firestore()));
  });
  it('a reused lastPurchaseId: the kid doc already names the id', async () => {
    await seed({ gameExtra: { lastPurchaseId: 's1' } });
    await assertFails(saleBatch(kidDb()));
  });
  it('a reused purchases doc id: the record already exists', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(purchaseRef(ctx.firestore(), KID, 's1'), { id: 's1', itemId: 'g-cape', cost: 15, at: 1 }));
    await assertFails(saleBatch(kidDb()));
  });
  it('a lastPurchaseId that names a record the batch does not write', async () => {
    await assertFails(saleBatch(kidDb(), { lastPurchaseId: 'other' }));
  });
  it('a lastPurchaseId with a bad format', async () => {
    await assertFails(saleBatch(kidDb(), { pid: 'bad id!', lastPurchaseId: 'bad id!' }));
  });
  it('a lone sale record cannot be written by the kid, later, as a replay', async () => {
    await assertSucceeds(saleBatch(kidDb()));
    await assertFails(setDoc(purchaseRef(kidDb(), KID, 's2'), { id: 's2', kind: 'sale', itemId: 'g-cape', refund: 7, at: 2000 }));
    await assertFails(setDoc(purchaseRef(kidDb(), KID, 's1'), { id: 's1', kind: 'sale', itemId: 'w-bow', refund: 27, at: 1000 }));
  });
  it('a kid cannot edit or delete a sale record', async () => {
    await assertSucceeds(saleBatch(kidDb()));
    await assertFails(updateDoc(purchaseRef(kidDb(), KID, 's1'), { refund: 999 }));
  });
});

describe('the family selling switch', () => {
  it('a boolean passes, anything else is refused, and a write without it passes', async () => {
    const f = doc(parentDb(), `families/${FAM}`);
    await assertSucceeds(updateDoc(f, { selling: false }));
    await assertSucceeds(updateDoc(f, { selling: true }));
    await assertFails(updateDoc(f, { selling: 'no' }));
    await assertFails(updateDoc(f, { selling: 0 }));
    await assertSucceeds(updateDoc(f, { schoolMode: true }));
  });
  it('a kid cannot write it', async () => {
    await assertFails(updateDoc(doc(kidDb(), `families/${FAM}`), { selling: true }));
  });
});

describe('giftAt on a gift (the 7-day sale lock reads it)', () => {
  // A gift to KID from SIB, as the sibling’s kid token writes it: four docs.
  async function giftBatch(db: Db, giftAt: unknown, o: { inventory?: Record<string, unknown> } = {}) {
    const b = writeBatch(db);
    b.update(kidRef(db, SIB), { game: game(0, { lastPurchaseId: 'g1' }) });
    b.set(purchaseRef(db, SIB, 'g1'), { id: 'g1', kind: 'gift', to: KID, itemId: 'w-sword', cost: 20, at: 1000 });
    b.update(kidRef(db, KID), { inventory: o.inventory ?? { items: [...START_INV.items, 'w-sword'], giftFrom: { 'w-sword': SIB }, giftAt: { 'w-sword': giftAt } } });
    b.set(doc(db, `families/${FAM}/kids/${KID}/gifts/g1`), { id: 'g1', from: SIB, itemId: 'w-sword', at: 1000, seen: false });
    return b.commit();
  }
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(kidRef(ctx.firestore(), SIB), kidDoc(SIB, 20)));
  });
  it('a gift stamped with the server time passes', async () => {
    await assertSucceeds(giftBatch(kidDb(SIB), serverTimestamp()));
  });
  it('a gift with no giftAt fails', async () => {
    await assertFails(giftBatch(kidDb(SIB), null, { inventory: { items: [...START_INV.items, 'w-sword'], giftFrom: { 'w-sword': SIB } } }));
  });
  it('a gift with a client time in the past fails', async () => {
    await assertFails(giftBatch(kidDb(SIB), ts(30 * DAY)));
  });
  it('a gift that stamps another item as well fails', async () => {
    await assertFails(giftBatch(kidDb(SIB), serverTimestamp(), { inventory: { items: [...START_INV.items, 'w-sword'], giftFrom: { 'w-sword': SIB }, giftAt: { 'w-sword': serverTimestamp(), 'w-bow': serverTimestamp() } } }));
  });
});

describe('giftAt through the kid branch', () => {
  it('a kid cannot forge a giftAt for an item they own', async () => {
    await seed({ inventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': SIB }, giftAt: { 'w-bow': ts(DAY) } } });
    await assertFails(updateDoc(kidRef(kidDb(), KID), { inventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': SIB }, giftAt: { 'w-bow': ts(30 * DAY) } } }));
    await assertFails(updateDoc(kidRef(kidDb(), KID), { inventory: { items: ['c-flag', 'w-bow', 'g-cape'], giftAt: { 'g-cape': ts(30 * DAY) } } }));
  });
  it('an old bundle’s save, which strips giftFrom and giftAt, is never blocked', async () => {
    await seed({ inventory: { items: ['c-flag', 'w-bow'], giftFrom: { 'w-bow': SIB }, giftAt: { 'w-bow': ts(DAY) } } });
    await assertSucceeds(updateDoc(kidRef(kidDb(), KID), { game: game(100, { lastPurchaseId: 'old1', xp: 480 }), inventory: { items: ['c-flag', 'w-bow'], equipped: { weapon: 'w-bow' } } }));
  });
  it('a plain run with a +10 gem rise and xp still passes beside the sale rules', async () => {
    await assertSucceeds(updateDoc(kidRef(kidDb(), KID), { game: game(110, { lastPurchaseId: 'old1', xp: 520 }) }));
  });
  it('a +11 gem rise with no sale still fails', async () => {
    await assertFails(updateDoc(kidRef(kidDb(), KID), { game: game(111, { lastPurchaseId: 'old1' }) }));
  });
  it('items cannot shrink without a sale (no record)', async () => {
    await assertFails(updateDoc(kidRef(kidDb(), KID), { inventory: { items: ['c-flag'] } }));
    await assertFails(updateDoc(kidRef(parentDb(), KID), { inventory: { items: ['c-flag'] } }));
  });
});
