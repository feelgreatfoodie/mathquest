import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Test names, ids and addresses are made up. RULES_FILE lets the suite run against another
// rules file (for example the previous release) to prove the tests fail on unfixed rules.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const PARENT_EMAIL = 'parent@example.com'; // made up

const FAM = 'fam-parent-uid';
const OTHER_FAM = 'fam-other-uid';
const STRANGER = 'stranger-uid';
const KID = 'kidaaaa';
const SIBLING = 'kidbbbb';

let env: RulesTestEnvironment;

const parentCtx = () => env.authenticatedContext(FAM, { email: PARENT_EMAIL, email_verified: true });
const kidCtx = (over: Record<string, unknown> = {}) =>
  env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID, ...over });

const kidDoc = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id === KID ? 'Testkid' : 'Sibling',
  createdAt: 1,
  settings: { sessionSize: 30, paceMultiplier: 3 },
  game: { xp: 0, gems: 0 },
  hasPin: true,
  ...extra,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { hasPin: true, createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}`), kidDoc(KID));
    await setDoc(doc(db, `families/${FAM}/kids/${SIBLING}`), kidDoc(SIBLING));
    await setDoc(doc(db, `families/${FAM}/kids/${KID}/cards/mul:2x3`), { id: 'mul:2x3', attempts: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${SIBLING}/cards/mul:2x3`), { id: 'mul:2x3', attempts: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${SIBLING}/sessions/s1`), { id: 's1' });
    await setDoc(doc(db, `families/${OTHER_FAM}/kids/${KID}`), kidDoc(KID));
    await setDoc(doc(db, `pinIndex/${FAM}/kids/${KID}`), { nameKey: 'testkid', salt: 'aa', hash: 'bb' });
    await setDoc(doc(db, `pinIndex/${FAM}/attempts/family`), { entries: [] });
    // The registry: FAM is a registered parent, STRANGER is signed in with Google but never registered.
    await setDoc(doc(db, `parents/${FAM}`), { email: PARENT_EMAIL, createdAt: 1 });
    await setDoc(doc(db, `parents/${OTHER_FAM}`), { email: 'other@example.com', createdAt: 1 });
    await setDoc(doc(db, 'meta/parentCount'), { count: 2 });
    await setDoc(doc(db, 'nameKeys/testkid'), { familyUid: FAM, kidId: KID });
  });
});

describe('kid token', () => {
  it('reads its own kid doc, cards and sessions', async () => {
    const db = kidCtx().firestore();
    await assertSucceeds(getDoc(doc(db, `families/${FAM}/kids/${KID}`)));
    await assertSucceeds(getDocs(collection(db, `families/${FAM}/kids/${KID}/cards`)));
    await assertSucceeds(getDocs(collection(db, `families/${FAM}/kids/${KID}/sessions`)));
  });

  it('writes its own cards and sessions', async () => {
    const db = kidCtx().firestore();
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}/cards/mul:4x5`), { id: 'mul:4x5', attempts: 2 }));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}/cards/mul:2x3`), { id: 'mul:2x3', attempts: 9 }));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}/sessions/s9`), { id: 's9', answered: 30 }));
  });

  it('updates only the game field of its kid doc', async () => {
    const db = kidCtx().firestore();
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}`), kidDoc(KID, { game: { xp: 50, gems: 2 } })));
  });

  it('cannot change settings, pace, name or hasPin on its kid doc', async () => {
    const db = kidCtx().firestore();
    const ref = doc(db, `families/${FAM}/kids/${KID}`);
    await assertFails(updateDoc(ref, { settings: { sessionSize: 30, paceMultiplier: 1 } }));
    await assertFails(updateDoc(ref, { name: 'Renamed' }));
    await assertFails(updateDoc(ref, { hasPin: false }));
    await assertFails(setDoc(ref, kidDoc(KID, { settings: { sessionSize: 30, paceMultiplier: 1 }, game: { xp: 1 } })));
  });

  it('cannot create or delete its kid doc, cards or sessions', async () => {
    const db = kidCtx().firestore();
    await assertFails(setDoc(doc(db, `families/${FAM}/kids/newkid`), kidDoc('newkid')));
    await assertFails(deleteDoc(doc(db, `families/${FAM}/kids/${KID}`)));
    await assertFails(deleteDoc(doc(db, `families/${FAM}/kids/${KID}/cards/mul:2x3`)));
    await assertFails(deleteDoc(doc(db, `families/${FAM}/kids/${SIBLING}/sessions/s1`)));
  });

  it('cannot write a sibling or read a sibling cards; reads the sibling kid doc only while gifting is on (gifting.test.ts holds the off case)', async () => {
    const db = kidCtx().firestore();
    await assertSucceeds(getDoc(doc(db, `families/${FAM}/kids/${SIBLING}`)));
    await assertFails(getDocs(collection(db, `families/${FAM}/kids/${SIBLING}/cards`)));
    await assertSucceeds(getDocs(collection(db, `families/${FAM}/kids`)));
    await assertFails(setDoc(doc(db, `families/${FAM}/kids/${SIBLING}/cards/mul:9x9`), { id: 'mul:9x9' }));
    await assertFails(updateDoc(doc(db, `families/${FAM}/kids/${SIBLING}`), { game: { xp: 9 } }));
  });

  it('cannot read or write the family doc (it holds the parent PIN hash)', async () => {
    const db = kidCtx().firestore();
    await assertFails(getDoc(doc(db, `families/${FAM}`)));
    await assertFails(setDoc(doc(db, `families/${FAM}`), { pinHash: 'evil', createdAt: 1 }));
  });

  it('cannot read or write pinIndex', async () => {
    const db = kidCtx().firestore();
    await assertFails(getDoc(doc(db, `pinIndex/${FAM}/kids/${KID}`)));
    await assertFails(getDocs(collection(db, `pinIndex/${FAM}/kids`)));
    await assertFails(setDoc(doc(db, `pinIndex/${FAM}/kids/${KID}`), { nameKey: 'testkid', salt: 'cc', hash: 'dd' }));
    await assertFails(setDoc(doc(db, `pinIndex/${FAM}/attempts/family`), { entries: [] }));
  });

  it('cannot touch another family, even with the same kid id', async () => {
    const db = kidCtx().firestore();
    await assertFails(getDoc(doc(db, `families/${OTHER_FAM}/kids/${KID}`)));
    await assertFails(setDoc(doc(db, `families/${OTHER_FAM}/kids/${KID}/cards/mul:2x3`), { id: 'mul:2x3' }));
  });

  it('is denied when a claim is wrong or missing', async () => {
    const path = `families/${FAM}/kids/${KID}`;
    await assertFails(getDoc(doc(kidCtx({ role: 'parent' }).firestore(), path)));
    await assertFails(getDoc(doc(kidCtx({ familyUid: OTHER_FAM }).firestore(), path)));
    // A sibling token of the same family reads the kid doc while gifting is on (the gift picker); the write rules never let it in.
    await assertSucceeds(getDoc(doc(kidCtx({ kidId: SIBLING }).firestore(), path)));
    await assertFails(getDoc(doc(env.authenticatedContext('kid_x', { familyUid: FAM, kidId: KID }).firestore(), path)));
  });
});

describe('parent token', () => {
  it('keeps full access to the family tree', async () => {
    const db = parentCtx().firestore();
    await assertSucceeds(getDoc(doc(db, `families/${FAM}`)));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}`), { hasPin: true, createdAt: 2 }));
    await assertSucceeds(getDocs(collection(db, `families/${FAM}/kids`)));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}`), kidDoc(KID, { settings: { paceMultiplier: 1 } })));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/newkid`), kidDoc('newkid')));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}/cards/mul:4x5`), { id: 'mul:4x5' }));
    await assertSucceeds(deleteDoc(doc(db, `families/${FAM}/kids/${KID}/cards/mul:2x3`)));
    await assertSucceeds(deleteDoc(doc(db, `families/${FAM}/kids/${SIBLING}`)));
  });

  it('cannot read or write pinIndex, and cannot read another family', async () => {
    const db = parentCtx().firestore();
    await assertFails(getDoc(doc(db, `pinIndex/${FAM}/kids/${KID}`)));
    await assertFails(setDoc(doc(db, `pinIndex/${FAM}/kids/${KID}`), { nameKey: 'x', salt: 'a', hash: 'b' }));
    await assertFails(getDoc(doc(db, `families/${OTHER_FAM}`)));
  });
});

describe('parent registry', () => {
  const stranger = () => env.authenticatedContext(STRANGER, { email: 'stranger@example.com', email_verified: true });

  it('lets a registered parent into their own family only', async () => {
    const db = parentCtx().firestore();
    await assertSucceeds(getDoc(doc(db, `families/${FAM}`)));
    await assertFails(getDoc(doc(db, `families/${OTHER_FAM}`)));
    await assertFails(setDoc(doc(db, `families/${OTHER_FAM}`), { pinHash: 'y', createdAt: 1 }));
    await assertFails(getDoc(doc(db, `families/${OTHER_FAM}/kids/${KID}`)));
  });

  it('keeps another registered parent out of this family', async () => {
    const db = env.authenticatedContext(OTHER_FAM, { email: 'other@example.com', email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(db, `families/${OTHER_FAM}`)));
    await assertFails(getDoc(doc(db, `families/${FAM}`)));
    await assertFails(getDocs(collection(db, `families/${FAM}/kids`)));
    await assertFails(setDoc(doc(db, `families/${FAM}/kids/${KID}`), kidDoc(KID)));
  });

  it('denies a verified Google account that is not registered, on every family path', async () => {
    const db = stranger().firestore();
    await assertFails(getDoc(doc(db, `families/${STRANGER}`)));
    await assertFails(setDoc(doc(db, `families/${STRANGER}`), { pinHash: 'x', createdAt: 1 }));
    await assertFails(setDoc(doc(db, `families/${STRANGER}/kids/k1`), kidDoc('k1')));
    await assertFails(setDoc(doc(db, `families/${STRANGER}/kids/k1/cards/c1`), { id: 'c1' }));
    await assertFails(getDoc(doc(db, `families/${FAM}`)));
    await assertFails(getDocs(collection(db, `families/${FAM}/kids`)));
  });

  it('denies a registered uid whose email is not verified', async () => {
    const db = env.authenticatedContext(FAM, { email: PARENT_EMAIL, email_verified: false }).firestore();
    await assertFails(getDoc(doc(db, `families/${FAM}`)));
  });

  it('denies registered and unregistered clients any access to parents, meta and nameKeys', async () => {
    for (const db of [parentCtx().firestore(), stranger().firestore(), kidCtx().firestore(), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(db, `parents/${FAM}`)));
      await assertFails(getDocs(collection(db, 'parents')));
      await assertFails(getDoc(doc(db, 'meta/parentCount')));
      await assertFails(getDoc(doc(db, 'nameKeys/testkid')));
    }
    const p = parentCtx().firestore();
    await assertFails(setDoc(doc(p, `parents/${STRANGER}`), { email: 'x@example.com', createdAt: 1 }));
    await assertFails(setDoc(doc(p, `parents/${FAM}`), { email: 'x@example.com', createdAt: 1 }));
    await assertFails(deleteDoc(doc(p, `parents/${FAM}`)));
    await assertFails(setDoc(doc(p, 'meta/parentCount'), { count: 0 }));
    await assertFails(updateDoc(doc(p, 'meta/parentCount'), { count: 0 }));
    await assertFails(setDoc(doc(p, 'nameKeys/someone'), { familyUid: FAM, kidId: 'k' }));
    await assertFails(deleteDoc(doc(p, 'nameKeys/testkid')));
  });

  it('has no email list in the rules file', () => {
    expect(RULES).not.toMatch(/token\.email\s+in\b/);
    expect(RULES).not.toMatch(/@/);
  });
});

describe('other accounts', () => {
  it('denies a signed-out visitor', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `families/${FAM}/kids/${KID}`)));
    await assertFails(getDoc(doc(db, `pinIndex/${FAM}/kids/${KID}`)));
  });
});
