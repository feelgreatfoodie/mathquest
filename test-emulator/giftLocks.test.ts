import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Gift locks (item-powers PDR, sections 3 and 4; follow-up to the sell-back PR). A gift writes a lock doc
// kids/{receiver}/giftLocks/{item} = { itemId, giftId, at } in the same batch, and a sale reads it. The lock is a separate doc, so a
// kid save that strips giftFrom and giftAt from the inventory (which giftFromKept lets through) cannot clear it.
// Every name, id and number is made up. RULES_FILE runs the suite against another rules file (the red-first run uses main's,
// and each mutation run removes one clause).
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const OTHER_FAM = 'fam-other-uid';
const KID = 'kidaaaa'; // the receiver, who sells
const SIB = 'kidbbbb'; // the giver
const FOREIGN = 'kidzzzz';
const DAY = 24 * 60 * 60 * 1000;

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = (kidId = KID, familyUid = FAM) => env.authenticatedContext(`kid_${kidId}`, { role: 'kid', familyUid, kidId }).firestore();
type Db = ReturnType<typeof parentDb>;
const kidRef = (db: Db, kidId: string, fam = FAM) => doc(db, `families/${fam}/kids/${kidId}`);
const purchaseRef = (db: Db, kidId: string, id: string) => doc(db, `families/${FAM}/kids/${kidId}/purchases/${id}`);
const giftRef = (db: Db, kidId: string, id: string) => doc(db, `families/${FAM}/kids/${kidId}/gifts/${id}`);
const lockRef = (db: Db, kidId: string, item: string) => doc(db, `families/${FAM}/kids/${kidId}/giftLocks/${item}`);
const ts = (msAgo: number) => Timestamp.fromMillis(Date.now() - msAgo);

const game = (gems: number, extra: Record<string, unknown> = {}) => ({ lastPlayedDay: '2026-11-17', xp: 467, gems, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1, ...extra });
const kidDoc = (id: string, gems: number, inventory?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, name: 'Testkid', createdAt: 1, hasPin: true,
  settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
  game: game(gems, extra),
  ...(inventory ? { inventory } : {}),
});

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-giftlocks', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());

const lockDoc = (item: string, msAgo: number, giftId = 'g0') => ({ itemId: item, giftId, at: ts(msAgo) });
/** KID owns a flag, the bow (gifted by SIB `giftedMsAgo` ago, with its notes and its lock) and a cape. */
async function seed(opts: { giftedMsAgo?: number | null; notes?: boolean; lock?: boolean; inventory?: Record<string, unknown>; locks?: Record<string, ReturnType<typeof lockDoc>>; sibGems?: number } = {}) {
  await env.clearFirestore();
  const giftedMsAgo = opts.giftedMsAgo === undefined ? DAY : opts.giftedMsAgo;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    const gifted = giftedMsAgo !== null;
    const inv = opts.inventory ?? {
      items: ['c-flag', 'w-bow', 'g-cape'],
      ...(gifted && opts.notes !== false ? { giftFrom: { 'w-bow': SIB }, giftAt: { 'w-bow': ts(giftedMsAgo) } } : {}),
    };
    await setDoc(kidRef(db, KID), kidDoc(KID, 100, inv, { lastPurchaseId: 'old1' }));
    await setDoc(kidRef(db, SIB), kidDoc(SIB, opts.sibGems ?? 200));
    if (gifted && opts.lock !== false) await setDoc(lockRef(db, KID, 'w-bow'), lockDoc('w-bow', giftedMsAgo));
    for (const [item, l] of Object.entries(opts.locks ?? {})) await setDoc(lockRef(db, KID, item), l);
    await setDoc(doc(db, `families/${OTHER_FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(kidRef(db, FOREIGN, OTHER_FAM), kidDoc(FOREIGN, 500, { items: ['w-bow'] }));
  });
}
beforeEach(async () => seed());

/** The bow sold for 27 by KID: the kid doc and the sale record. `inv` is the inventory after the write. */
function saleBatch(db: Db, inv: Record<string, unknown> = { items: ['c-flag', 'g-cape'] }, item = 'w-bow', refund = 27) {
  const b = writeBatch(db);
  b.update(kidRef(db, KID), { game: game(100 + refund, { lastPurchaseId: 's1' }), inventory: inv });
  b.set(purchaseRef(db, KID, 's1'), { id: 's1', kind: 'sale', itemId: item, refund, at: 1000 });
  return b.commit();
}

interface GiftOpts {
  pid?: string;
  itemId?: string;
  /** null leaves the lock out; otherwise the lock doc (default { itemId, giftId: pid, at: server time }). */
  lock?: Record<string, unknown> | null;
  lockId?: string;
  /** The receiver's items before the gift (default: the flag only). */
  rcvItems?: string[];
}
/** SIB gifts the bow (55) to KID, who owns a flag: the four docs plus the lock, as the app writes them. */
function giftBatch(db: Db, o: GiftOpts = {}) {
  const pid = o.pid ?? 'g1';
  const itemId = o.itemId ?? 'w-bow';
  const rcvItems = o.rcvItems ?? ['c-flag'];
  const b = writeBatch(db);
  b.update(kidRef(db, SIB), { game: game(200 - 55, { lastPurchaseId: pid }) });
  b.set(purchaseRef(db, SIB, pid), { id: pid, kind: 'gift', to: KID, itemId, cost: 55, at: 1000 });
  b.update(kidRef(db, KID), { inventory: { items: [...rcvItems, itemId], giftFrom: { [itemId]: SIB }, giftAt: { [itemId]: serverTimestamp() } } });
  b.set(giftRef(db, KID, pid), { id: pid, from: SIB, itemId, at: 1000, seen: false });
  if (o.lock !== null) b.set(lockRef(db, KID, o.lockId ?? itemId), o.lock ?? { itemId, giftId: pid, at: serverTimestamp() });
  return b.commit();
}

describe('strip then sell (the gap)', () => {
  it('a gifted bow (1 day ago, with its lock): the strip save succeeds, then the sale is denied', async () => {
    await assertSucceeds(updateDoc(kidRef(kidDb(), KID), { inventory: { items: ['c-flag', 'w-bow', 'g-cape'] } }));
    expect((await getDoc(kidRef(parentDb(), KID))).data()?.inventory).toEqual({ items: ['c-flag', 'w-bow', 'g-cape'] });
    await assertFails(saleBatch(kidDb()));
  });
  it('the direct sale of the unstripped gifted bow stays denied', async () => {
    await assertFails(saleBatch(kidDb(), { items: ['c-flag', 'g-cape'] }));
  });
  it('a stripped bow with a lock older than 7 days sells for 27', async () => {
    await seed({ giftedMsAgo: 8 * DAY, notes: false });
    await assertSucceeds(saleBatch(kidDb()));
  });
  it('the lock stays after the sale', async () => {
    await seed({ giftedMsAgo: 8 * DAY, notes: false });
    await assertSucceeds(saleBatch(kidDb()));
    expect((await getDoc(lockRef(parentDb(), KID, 'w-bow'))).exists()).toBe(true);
  });
  it('a stripped bow whose lock is 6 days old is denied', async () => {
    await seed({ giftedMsAgo: 6 * DAY, notes: false });
    await assertFails(saleBatch(kidDb()));
  });
});

describe('sales that stay allowed', () => {
  it('a gifted bow with notes and a lock, 8 days on, sells and removes its notes', async () => {
    await seed({ giftedMsAgo: 8 * DAY });
    await assertSucceeds(saleBatch(kidDb(), { items: ['c-flag', 'g-cape'], giftFrom: {}, giftAt: {} }));
  });
  it('a bought bow (never gifted, no lock) sells for 27', async () => {
    await seed({ giftedMsAgo: null });
    await assertSucceeds(saleBatch(kidDb()));
  });
  it('a lock on another item does not hold the bow', async () => {
    await seed({ giftedMsAgo: null, locks: { 'g-cape': lockDoc('g-cape', DAY) } });
    await assertSucceeds(saleBatch(kidDb()));
  });
  it('the parent device playing as the kid sells a bought bow', async () => {
    await seed({ giftedMsAgo: null });
    await assertSucceeds(saleBatch(parentDb()));
  });
});

describe('a gift writes its lock', () => {
  beforeEach(async () => seed({ giftedMsAgo: null, inventory: { items: ['c-flag'] } }));
  it('the giver as a kid token: the lock is created with the server time', async () => {
    await assertSucceeds(giftBatch(kidDb(SIB)));
    const d = (await getDoc(lockRef(parentDb(), KID, 'w-bow'))).data();
    expect(d).toMatchObject({ itemId: 'w-bow', giftId: 'g1' });
    expect(Object.keys(d ?? {}).sort()).toEqual(['at', 'giftId', 'itemId']);
  });
  it('the parent device playing as the giver', async () => {
    await assertSucceeds(giftBatch(parentDb()));
  });
  it('a re-gift after a sale updates the lock', async () => {
    // The bow was gifted 30 days ago and sold since: no bow in the items, the old lock stays.
    await seed({ giftedMsAgo: null, inventory: { items: ['c-flag'] }, locks: { 'w-bow': lockDoc('w-bow', 30 * DAY) } });
    await assertSucceeds(giftBatch(kidDb(SIB), { pid: 'g2' }));
    const d = (await getDoc(lockRef(parentDb(), KID, 'w-bow'))).data();
    expect(d?.giftId).toBe('g2');
    expect(d?.at.toMillis()).toBeGreaterThan(Date.now() - 60_000);
  });
  it('after the re-gift the bow is locked again for 7 days', async () => {
    await seed({ giftedMsAgo: null, inventory: { items: ['c-flag'] }, locks: { 'w-bow': lockDoc('w-bow', 30 * DAY) } });
    await assertSucceeds(giftBatch(kidDb(SIB), { pid: 'g2' }));
    await assertSucceeds(updateDoc(kidRef(kidDb(), KID), { inventory: { items: ['c-flag', 'w-bow'] } }));
    await assertFails(saleBatch(kidDb(), { items: ['c-flag'] }));
  });
});

describe('a lock that is not backed fails', () => {
  beforeEach(async () => seed({ giftedMsAgo: null, inventory: { items: ['c-flag'] } }));
  it('a lock created alone, outside a gift batch (kid)', async () => {
    await assertFails(setDoc(lockRef(kidDb(), KID, 'w-bow'), { itemId: 'w-bow', giftId: 'g1', at: serverTimestamp() }));
  });
  it('a lock created alone, outside a gift batch (parent)', async () => {
    await assertFails(setDoc(lockRef(parentDb(), KID, 'w-bow'), { itemId: 'w-bow', giftId: 'g1', at: serverTimestamp() }));
  });
  it('a lock created alone naming a gift doc that already exists', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(giftRef(ctx.firestore(), KID, 'g0'), { id: 'g0', from: SIB, itemId: 'w-bow', at: 1, seen: true }));
    await assertFails(setDoc(lockRef(kidDb(), KID, 'w-bow'), { itemId: 'w-bow', giftId: 'g0', at: serverTimestamp() }));
  });
  it('a lock in a gift batch with at set to a past time', async () => {
    await assertFails(giftBatch(kidDb(SIB), { lock: { itemId: 'w-bow', giftId: 'g1', at: ts(30 * DAY) } }));
  });
  it('a lock in a gift batch with at set to a future time', async () => {
    await assertFails(giftBatch(kidDb(SIB), { lock: { itemId: 'w-bow', giftId: 'g1', at: Timestamp.fromMillis(Date.now() + 30 * DAY) } }));
  });
  it('a lock whose itemId field names another item than its doc id', async () => {
    await assertFails(giftBatch(kidDb(SIB), { lock: { itemId: 'g-cape', giftId: 'g1', at: serverTimestamp() } }));
  });
  it('a lock stored under another item id than the gifted item', async () => {
    await assertFails(giftBatch(kidDb(SIB), { lockId: 'g-cape', lock: { itemId: 'g-cape', giftId: 'g1', at: serverTimestamp() } }));
  });
  it('a lock whose giftId names a gift doc for another item', async () => {
    await assertFails(giftBatch(kidDb(SIB), { lockId: 'g-cape', lock: { itemId: 'g-cape', giftId: 'g1', at: serverTimestamp() } }));
  });
  it('a lock with an extra field', async () => {
    await assertFails(giftBatch(kidDb(SIB), { lock: { itemId: 'w-bow', giftId: 'g1', at: serverTimestamp(), note: 'x' } }));
  });
  it('a lock missing giftId', async () => {
    await assertFails(giftBatch(kidDb(SIB), { lock: { itemId: 'w-bow', at: serverTimestamp() } }));
  });
  it('a lock whose giftId names no gift doc of the batch', async () => {
    await assertFails(giftBatch(kidDb(SIB), { lock: { itemId: 'w-bow', giftId: 'nope', at: serverTimestamp() } }));
  });
  // The parent device skips giftReceiveOk (the kid branch), so only giftLockOk holds the lock it writes.
  it('parent: a lock with at in the past is denied', async () => {
    await assertFails(giftBatch(parentDb(), { lock: { itemId: 'w-bow', giftId: 'g1', at: ts(30 * DAY) } }));
  });
  it('parent: a lock whose itemId field names another item than its doc id is denied', async () => {
    await assertFails(giftBatch(parentDb(), { lock: { itemId: 'g-cape', giftId: 'g1', at: serverTimestamp() } }));
  });
  it('parent: a lock for the cape that names the bow gift doc is denied', async () => {
    await assertFails(giftBatch(parentDb(), { lockId: 'g-cape', lock: { itemId: 'g-cape', giftId: 'g1', at: serverTimestamp() } }));
  });
  it('parent: a lock with an extra field is denied', async () => {
    await assertFails(giftBatch(parentDb(), { lock: { itemId: 'w-bow', giftId: 'g1', at: serverTimestamp(), note: 'x' } }));
  });
  it('parent: a lock created alone for a gift doc outside the batch is denied', async () => {
    await assertFails(setDoc(lockRef(parentDb(), KID, 'w-bow'), { itemId: 'w-bow', giftId: 'g1', at: serverTimestamp() }));
  });
  it('a re-gift that leaves the stale lock in place (no lock write in the batch) is denied', async () => {
    await seed({ giftedMsAgo: null, inventory: { items: ['c-flag'] }, locks: { 'w-bow': lockDoc('w-bow', 30 * DAY) } });
    await assertFails(giftBatch(kidDb(SIB), { lock: null, pid: 'g2' }));
  });
  it('a gift batch with no lock is denied', async () => {
    await assertFails(giftBatch(kidDb(SIB), { lock: null }));
  });
  it('a gift batch whose only lock is for another item is denied', async () => {
    await assertFails(giftBatch(kidDb(SIB), { lockId: 'g-cape', lock: { itemId: 'g-cape', giftId: 'g1', at: serverTimestamp() } }));
  });
  it('a kid of another family cannot write the lock', async () => {
    await assertFails(setDoc(lockRef(kidDb(FOREIGN, OTHER_FAM), KID, 'w-bow'), { itemId: 'w-bow', giftId: 'g1', at: serverTimestamp() }));
    await assertFails(giftBatch(kidDb(FOREIGN, OTHER_FAM)));
  });
  it('a signed-out client cannot write or read a lock', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(lockRef(db, KID, 'w-bow'), { itemId: 'w-bow', giftId: 'g1', at: serverTimestamp() }));
    await assertFails(getDoc(lockRef(db, KID, 'w-bow')));
  });
});

describe('a lock cannot be changed or removed', () => {
  beforeEach(async () => seed({ giftedMsAgo: 8 * DAY }));
  it('delete: denied for the kid and the parent', async () => {
    await assertFails(deleteDoc(lockRef(kidDb(), KID, 'w-bow')));
    await assertFails(deleteDoc(lockRef(parentDb(), KID, 'w-bow')));
    expect((await getDoc(lockRef(parentDb(), KID, 'w-bow'))).exists()).toBe(true);
  });
  it('update outside a gift batch: denied (a kid cannot move at forward or back)', async () => {
    await assertFails(updateDoc(lockRef(kidDb(), KID, 'w-bow'), { at: serverTimestamp() }));
    await assertFails(updateDoc(lockRef(parentDb(), KID, 'w-bow'), { at: ts(30 * DAY) }));
  });
  it('the kid and the parent read it, a sibling does not', async () => {
    await assertSucceeds(getDoc(lockRef(kidDb(), KID, 'w-bow')));
    await assertSucceeds(getDoc(lockRef(parentDb(), KID, 'w-bow')));
    await assertFails(getDoc(lockRef(kidDb(SIB), KID, 'w-bow')));
  });
});

describe('budget: 60 items, 20 gifted, a gifted item sold past 7 days', () => {
  // The cap is 60 entries (inventoryCap). 23 are catalog ids; the rest are ids an older or newer build stored (the sale keeps them).
  const junk = Array.from({ length: 48 }, (_, i) => `x-extra-${i}`);
  const items = ['c-flag', 'w-bow', 'g-cape', 'w-sword', 'w-hammer', 'g-helm', 'p-owl', 'c-fire', 'w-wand', 'g-shield', ...junk, 'a-bridge', 'a-tent'].slice(0, 60);
  const giftedIds = items.slice(0, 20);
  it('seed: 60 items, 20 gifted with notes and locks', () => {
    expect(items).toHaveLength(60);
    expect(giftedIds).toHaveLength(20);
  });
  it('selling a gifted bow, 8 days on, is allowed with 20 locks and 20 notes', async () => {
    const giftFrom = Object.fromEntries(giftedIds.map((i) => [i, SIB]));
    const giftAt = Object.fromEntries(giftedIds.map((i) => [i, ts(8 * DAY)]));
    await seed({ inventory: { items, giftFrom, giftAt }, locks: Object.fromEntries(giftedIds.map((i) => [i, lockDoc(i, 8 * DAY)])) });
    const rest = items.filter((i) => i !== 'w-bow');
    const { 'w-bow': _f, ...gf } = giftFrom;
    const { 'w-bow': _t, ...ga } = giftAt;
    await assertSucceeds(saleBatch(kidDb(), { items: rest, giftFrom: gf, giftAt: ga }));
  });
  it('the same inventory stripped of its notes sells just as well (lock only)', async () => {
    await seed({ inventory: { items }, locks: Object.fromEntries(giftedIds.map((i) => [i, lockDoc(i, 8 * DAY)])) });
    await assertSucceeds(saleBatch(kidDb(), { items: items.filter((i) => i !== 'w-bow') }));
  });
  it('a gift into a 59-item inventory with 20 locks is allowed', async () => {
    const owned = items.slice(0, 59).filter((i) => i !== 'w-bow');
    // 58 owned plus the bow makes 59, one under the cap.
    await seed({ giftedMsAgo: null, inventory: { items: owned }, locks: Object.fromEntries(giftedIds.filter((i) => i !== 'w-bow').map((i) => [i, lockDoc(i, 8 * DAY)])) });
    await assertSucceeds(giftBatch(kidDb(SIB), { rcvItems: owned }));
  });
});
