import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, deleteField, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// L1b rules: parentPins is server-only, and a client can neither read a family doc that still holds pinHash nor write
// pinHash or hasPin. Every id and hash below is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const OTHER_FAM = 'fam-other-uid';
const KID = 'kidaaaa';

let env: RulesTestEnvironment;
const anonDb = () => env.unauthenticatedContext().firestore();
const strangerDb = () => env.authenticatedContext('stranger-uid', { email: 'stranger@example.com', email_verified: true }).firestore();
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const otherParentDb = () => env.authenticatedContext(OTHER_FAM, { email: 'other@example.com', email_verified: true }).firestore();
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const ALL = () => [anonDb(), strangerDb(), kidDb(), parentDb(), otherParentDb()];

async function seed(familyDoc: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), familyDoc);
    await setDoc(doc(db, `parentPins/${FAM}`), { salt: 'aa', hash: 'bb', v: 2, updatedAt: 1 });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-parentpin', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(doc(db, `parents/${OTHER_FAM}`), { email: 'other@example.com', createdAt: 1 });
  });
});

describe('parentPins is server-only', () => {
  it('nobody reads, lists, writes, updates or deletes it: signed out, stranger, kid, the parent, another parent', async () => {
    await seed({ createdAt: 1, hasPin: true });
    for (const db of ALL()) {
      await assertFails(getDoc(doc(db, `parentPins/${FAM}`)));
      await assertFails(getDocs(collection(db, 'parentPins')));
      await assertFails(getDocs(collectionGroup(db, 'parentPins')));
      await assertFails(setDoc(doc(db, `parentPins/${FAM}`), { salt: 'x', hash: 'y', v: 2 }));
      await assertFails(setDoc(doc(db, 'parentPins/fresh-uid'), { salt: 'x', hash: 'y', v: 2 }));
      await assertFails(updateDoc(doc(db, `parentPins/${FAM}`), { hash: 'y' }));
      await assertFails(deleteDoc(doc(db, `parentPins/${FAM}`)));
    }
  });
});

describe('pinHash in the family doc', () => {
  it('the parent cannot read a family doc that still holds pinHash, and nobody else can read it either', async () => {
    await seed({ pinHash: 'a'.repeat(64), createdAt: 1 });
    for (const db of [anonDb(), strangerDb(), kidDb(), otherParentDb()]) await assertFails(getDoc(doc(db, `families/${FAM}`)));
    await assertFails(getDoc(doc(parentDb(), `families/${FAM}`)));
  });

  it('the parent reads a family doc that has no pinHash (hasPin, createdAt, tourSeen)', async () => {
    await seed({ hasPin: true, createdAt: 1, tourSeen: true });
    await assertSucceeds(getDoc(doc(parentDb(), `families/${FAM}`)));
  });

  it('a client cannot write pinHash or hasPin: create, merge, update, nor with the key set to a delete', async () => {
    await seed({ hasPin: true, createdAt: 1 });
    const db = parentDb();
    await assertFails(setDoc(doc(db, `families/${FAM}`), { pinHash: 'b'.repeat(64) }, { merge: true }));
    await assertFails(setDoc(doc(db, `families/${FAM}`), { pinHash: 'b'.repeat(64), createdAt: 1 }));
    await assertFails(updateDoc(doc(db, `families/${FAM}`), { pinHash: 'b'.repeat(64) }));
    await assertFails(updateDoc(doc(db, `families/${FAM}`), { hasPin: false }));
    await assertFails(updateDoc(doc(db, `families/${FAM}`), { hasPin: deleteField() }));
    await assertFails(setDoc(doc(db, `families/${OTHER_FAM}`), { pinHash: 'c'.repeat(64), createdAt: 1 }));
    await assertFails(setDoc(doc(otherParentDb(), `families/${OTHER_FAM}`), { pinHash: 'c'.repeat(64), createdAt: 1 }));
    await assertFails(setDoc(doc(otherParentDb(), `families/${OTHER_FAM}`), { hasPin: true, createdAt: 1 }));
  });

  it('a parent with no family doc yet reads a missing doc without an error (the first-PIN screen)', async () => {
    await assertSucceeds(getDoc(doc(otherParentDb(), `families/${OTHER_FAM}`)));
  });

  it('a client can still write the other family fields: tourSeen by merge', async () => {
    await seed({ hasPin: true, createdAt: 1 });
    await assertSucceeds(setDoc(doc(parentDb(), `families/${FAM}`), { tourSeen: true }, { merge: true }));
    await assertSucceeds(setDoc(doc(otherParentDb(), `families/${OTHER_FAM}`), { createdAt: 5, tourSeen: true }));
  });

  it('a client cannot delete the family doc to make the app ask for a first PIN', async () => {
    await seed({ hasPin: true, createdAt: 1 });
    await assertFails(deleteDoc(doc(parentDb(), `families/${FAM}`)));
  });
});
