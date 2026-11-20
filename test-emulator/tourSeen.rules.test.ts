import { readFileSync } from 'node:fs';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';

// tourSeen lives on the parent's own family doc (families/{uid}). The current rules already let the parent write that doc, so the
// tour needs no rules change. This pins it: the parent writes the one field, a PIN change keeps it, and nobody else can write it.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-tour-uid';
const OTHER = 'fam-other-uid';
let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = () => env.authenticatedContext('kid_kidtour000001', { role: 'kid', familyUid: FAM, kidId: 'kidtour000001' }).firestore();
const strangerDb = () => env.authenticatedContext(OTHER, { email: 'other@example.com', email_verified: true }).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-tour', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { hasPin: true, createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
  });
});

describe('tourSeen on the family doc', () => {
  it('the parent writes the one field and hasPin stays', async () => {
    const repo = new FirestoreRepo(parentDb(), FAM);
    expect((await repo.getFamily())?.tourSeen).toBeUndefined();
    await repo.markTourSeen();
    expect(await repo.getFamily()).toEqual({ hasPin: true, createdAt: 1, tourSeen: true });
  });
  it('changing the PIN keeps tourSeen', async () => {
    const repo = new FirestoreRepo(parentDb(), FAM);
    await repo.markTourSeen();
    // A browser never writes a PIN hash: saveFamily drops pinHash, and the doc keeps hasPin and tourSeen.
    await repo.saveFamily({ pinHash: 'new', createdAt: 2 });
    expect(await repo.getFamily()).toEqual({ hasPin: true, createdAt: 2, tourSeen: true });
  });
  it('a kid token cannot write it', async () => {
    await assertFails(new FirestoreRepo(kidDb(), FAM).markTourSeen());
  });
  it("another account cannot write it on this family's doc", async () => {
    await assertFails(new FirestoreRepo(strangerDb(), FAM).markTourSeen());
  });
  it('the stored doc is unchanged after the refused writes', async () => {
    await assertFails(new FirestoreRepo(kidDb(), FAM).markTourSeen());
    const snap = await getDoc(doc(parentDb(), `families/${FAM}`));
    expect(snap.data()).toEqual({ hasPin: true, createdAt: 1 });
  });
});
