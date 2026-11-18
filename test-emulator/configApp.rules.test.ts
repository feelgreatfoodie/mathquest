import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// config/app holds { minVersion }: the oldest build allowed to write. Any signed-in user may read it,
// no client may write it, only the Admin SDK (rules skipped) sets it. All values are made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidaaaa';

let env: RulesTestEnvironment;
const parent = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const unregisteredGoogle = () => env.authenticatedContext('stranger-uid', { email: 'x@example.com', email_verified: true }).firestore();
const kid = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const APP = 'config/app';

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), APP), { minVersion: 1000 });
    await setDoc(doc(ctx.firestore(), 'config/other'), { secret: 1 });
    await setDoc(doc(ctx.firestore(), `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
  });
});

describe('config/app', () => {
  it('a kid token reads it', async () => {
    await assertSucceeds(getDoc(doc(kid(), APP)));
  });
  it('a registered parent reads it', async () => {
    await assertSucceeds(getDoc(doc(parent(), APP)));
  });
  it('any signed-in account reads it, registered or not (it holds one public number)', async () => {
    await assertSucceeds(getDoc(doc(unregisteredGoogle(), APP)));
  });
  it('a signed-out client cannot read it', async () => {
    await assertFails(getDoc(doc(anon(), APP)));
  });
  it('no client writes it: create, set, update or delete, kid or parent', async () => {
    for (const db of [kid(), parent(), unregisteredGoogle(), anon()]) {
      await assertFails(setDoc(doc(db, APP), { minVersion: 1 }));
      await assertFails(updateDoc(doc(db, APP), { minVersion: 1 }));
      await assertFails(deleteDoc(doc(db, APP)));
    }
  });
  it('other config documents stay closed to clients', async () => {
    await assertFails(getDoc(doc(kid(), 'config/other')));
    await assertFails(getDoc(doc(parent(), 'config/other')));
    await assertFails(setDoc(doc(parent(), 'config/new'), { a: 1 }));
  });
  it('the Admin SDK (rules skipped) sets it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), APP), { minVersion: 2000 }));
    await assertSucceeds(getDoc(doc(kid(), APP)));
  });
});
