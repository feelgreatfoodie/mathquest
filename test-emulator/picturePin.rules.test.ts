import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// Picture PIN and the rules. The hash lives in the server-only pinIndex (Admin SDK), the kid doc holds one parent-only
// flag (hasPicturePin), and a device that has not signed in can read nothing: no kid list, no names, no heroes. An old
// bundle's kid writes stay valid for a kid who has a picture PIN. Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidaaaa';
let env: RulesTestEnvironment;
const anonDb = () => env.unauthenticatedContext().firestore();
const strangerDb = () => env.authenticatedContext('stranger-uid', { email: 'stranger@example.com', email_verified: true }).firestore();
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = (kidId = KID) => env.authenticatedContext(`kid_${kidId}`, { role: 'kid', familyUid: FAM, kidId }).firestore();
const GAME = { lastPlayedDay: '2026-11-17', xp: 467, gems: 200, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1 };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-picpin', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}`), { id: KID, name: 'Testkid', createdAt: 1, hasPin: true, hasPicturePin: true, settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } }, game: GAME });
    await setDoc(doc(db, `pinIndex/${FAM}/kids/${KID}`), { nameKey: 'testkid', salt: 'aa', hash: 'bb', pic: { salt: 'cc', hash: 'dd' }, updatedAt: 1 });
    await setDoc(doc(db, `nameKeys/testkid`), { familyUid: FAM, kidId: KID });
  });
});

describe('the picture hash is server-only', () => {
  it('nobody reads or writes the pinIndex row that holds the picture hash: signed out, stranger, kid, parent', async () => {
    for (const db of [anonDb(), strangerDb(), kidDb(), parentDb()]) {
      await assertFails(getDoc(doc(db, `pinIndex/${FAM}/kids/${KID}`)));
      await assertFails(setDoc(doc(db, `pinIndex/${FAM}/kids/${KID}`), { pic: { salt: 'x', hash: 'y' } }));
      await assertFails(getDocs(collection(db, `pinIndex/${FAM}/kids`)));
    }
  });
  it('nobody reads the name claims either', async () => {
    for (const db of [anonDb(), kidDb(), parentDb()]) await assertFails(getDoc(doc(db, 'nameKeys/testkid')));
  });
});

describe('a signed-out device reads no kid, name or hero', () => {
  it('cannot get the kid doc, list the kids, list the family, or run a collection-group query', async () => {
    const db = anonDb();
    await assertFails(getDoc(doc(db, `families/${FAM}/kids/${KID}`)));
    await assertFails(getDocs(collection(db, `families/${FAM}/kids`)));
    await assertFails(getDoc(doc(db, `families/${FAM}`)));
    await assertFails(getDocs(collectionGroup(db, 'kids')));
  });
  it('a stranger signed in with Google but not a registered parent reads nothing either', async () => {
    const db = strangerDb();
    await assertFails(getDocs(collection(db, `families/${FAM}/kids`)));
    await assertFails(getDocs(collectionGroup(db, 'kids')));
  });
  it('a kid token reads its own kid doc, and a sibling kid doc only while gifting is on (the gift picker)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `families/${FAM}/kids/kidbbbb`), { id: 'kidbbbb', name: 'Other', createdAt: 1, game: GAME });
    });
    await assertSucceeds(getDoc(doc(kidDb(), `families/${FAM}/kids/${KID}`)));
    await assertSucceeds(getDoc(doc(kidDb(), `families/${FAM}/kids/kidbbbb`)));
    await assertSucceeds(getDocs(collection(kidDb(), `families/${FAM}/kids`)));
  });
});

describe('hasPicturePin is a parent-only flag; old-bundle kid writes stay valid', () => {
  it('a kid token cannot set, clear or add hasPicturePin, alone or beside a game write', async () => {
    const ref = doc(kidDb(), `families/${FAM}/kids/${KID}`);
    await assertFails(updateDoc(ref, { hasPicturePin: false }));
    await assertFails(updateDoc(ref, { hasPicturePin: false, game: { ...GAME, xp: 500 } }));
    await assertFails(updateDoc(ref, { hasPicturePin: 'yes', game: { ...GAME, xp: 500 } }));
    await assertFails(updateDoc(ref, { hasPin: false }));
  });
  it('an old-shape game write (no flag key) is accepted for a kid who has a picture PIN, and the flag stays', async () => {
    await assertSucceeds(updateDoc(doc(kidDb(), `families/${FAM}/kids/${KID}`), { game: { ...GAME, xp: 520, gems: 205 } }));
    const snap = await getDoc(doc(parentDb(), `families/${FAM}/kids/${KID}`));
    if (snap.data()?.hasPicturePin !== true) throw new Error('flag was lost');
  });
  it('a parent write that carries the flag along with settings is accepted', async () => {
    await assertSucceeds(updateDoc(doc(parentDb(), `families/${FAM}/kids/${KID}`), { settings: { sessionSize: 20, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } } }));
  });
});
