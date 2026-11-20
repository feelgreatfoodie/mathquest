import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// L1a rules: the username index and the lock counters are server-only, and a family's devices are readable by its grown-ups,
// who may change `label` and nothing else. Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const OTHER_FAM = 'fam-other-uid';
const KID = 'kidaaaa';
const DEVICE = 'devA-0123456789abcdef';

let env: RulesTestEnvironment;
const anonDb = () => env.unauthenticatedContext().firestore();
const strangerDb = () => env.authenticatedContext('stranger-uid', { email: 'stranger@example.com', email_verified: true }).firestore();
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const otherParentDb = () => env.authenticatedContext(OTHER_FAM, { email: 'other@example.com', email_verified: true }).firestore();
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const ALL = () => [anonDb(), strangerDb(), kidDb(), parentDb(), otherParentDb()];

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-signin-core', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(doc(db, `parents/${OTHER_FAM}`), { email: 'other@example.com', createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}`), { createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}`), { id: KID, name: 'Testkid', createdAt: 1, hasPin: true, username: 'test_kid', game: {} });
    await setDoc(doc(db, 'usernames/test_kid'), { familyUid: FAM, kidId: KID, createdAt: 1 });
    await setDoc(doc(db, 'pinIndex/_global/attempts/user_abc'), { entries: [], fails: 2, strikes: 1, strikeAt: 1, lockedUntil: 0, lockedBy: null });
    await setDoc(doc(db, 'pinIndex/_global/attempts/dev_abc'), { entries: [{ id: 'x', at: 1 }], lockedUntil: 0, lockedBy: null });
    await setDoc(doc(db, `families/${FAM}/devices/${DEVICE}`), { firstSeen: 1, lastSeen: 2, kids: [KID], label: 'iPad Safari' });
  });
});

describe('the username index is server-only', () => {
  it('nobody reads, lists, writes, updates or deletes usernames: signed out, stranger, kid, parent, another parent', async () => {
    for (const db of ALL()) {
      await assertFails(getDoc(doc(db, 'usernames/test_kid')));
      await assertFails(getDocs(collection(db, 'usernames')));
      await assertFails(getDocs(collectionGroup(db, 'usernames')));
      await assertFails(setDoc(doc(db, 'usernames/fresh_name'), { familyUid: FAM, kidId: KID, createdAt: 1 }));
      await assertFails(updateDoc(doc(db, 'usernames/test_kid'), { kidId: 'other' }));
      await assertFails(deleteDoc(doc(db, 'usernames/test_kid')));
    }
  });
});

describe('the lock counters are server-only', () => {
  it('nobody reads or writes the username and device counters', async () => {
    for (const db of ALL()) {
      for (const path of ['pinIndex/_global/attempts/user_abc', 'pinIndex/_global/attempts/dev_abc']) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { entries: [], fails: 0, strikes: 0, lockedUntil: 0 }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      await assertFails(getDocs(collection(db, 'pinIndex/_global/attempts')));
    }
  });
});

describe('devices: grown-ups read and rename, nobody creates or deletes', () => {
  const path = `families/${FAM}/devices/${DEVICE}`;

  it('the family\'s parent reads one device and lists them', async () => {
    await assertSucceeds(getDoc(doc(parentDb(), path)));
    await assertSucceeds(getDocs(collection(parentDb(), `families/${FAM}/devices`)));
  });

  it('signed out, a stranger, a kid token and another family\'s parent read nothing', async () => {
    for (const db of [anonDb(), strangerDb(), kidDb(), otherParentDb()]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(getDocs(collection(db, `families/${FAM}/devices`)));
      await assertFails(getDocs(collectionGroup(db, 'devices')));
    }
  });

  it('the parent changes the label to a string of 1 to 40 characters', async () => {
    await assertSucceeds(updateDoc(doc(parentDb(), path), { label: 'Kitchen iPad' }));
    await assertSucceeds(updateDoc(doc(parentDb(), path), { label: 'x'.repeat(40) }));
  });

  it('the parent cannot change any other field, nor add one, nor send a bad label', async () => {
    const db = parentDb();
    for (const patch of [{ kids: ['kid-other'] }, { firstSeen: 5 }, { lastSeen: 5 }, { revoked: true }, { label: 'ok', kids: [] }, { label: '' }, { label: 'x'.repeat(41) }, { label: 7 }, { label: null }]) {
      await assertFails(updateDoc(doc(db, path), patch));
    }
  });

  it('nobody else changes a label', async () => {
    for (const db of [anonDb(), strangerDb(), kidDb(), otherParentDb()]) await assertFails(updateDoc(doc(db, path), { label: 'mine now' }));
  });

  it('nobody creates or deletes a device, the parent included', async () => {
    for (const db of ALL()) {
      await assertFails(setDoc(doc(db, `families/${FAM}/devices/devB-0123456789abcdef`), { firstSeen: 1, lastSeen: 1, kids: [KID], label: 'fake' }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    // A set that would overwrite the existing doc is a write the rules do not allow either.
    await assertFails(setDoc(doc(parentDb(), path), { firstSeen: 1, lastSeen: 2, kids: [], label: 'wiped' }));
  });

  it('a kid token reads its own doc and its own username field, and the doc still shows the username', async () => {
    const snap = await assertSucceeds(getDoc(doc(kidDb(), `families/${FAM}/kids/${KID}`)));
    if (snap.data()?.username !== 'test_kid') throw new Error('kid doc lost its username');
  });
});
