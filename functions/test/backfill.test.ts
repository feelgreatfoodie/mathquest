import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no types
import { backfill } from '../../scripts/backfill-parents.mjs';

// Made-up uids and addresses.
let db: Firestore;
const emails: Record<string, string> = { 'fam-1': 'One@Example.com', 'fam-2': 'two@example.com' };
const getEmail = async (uid: string) => emails[uid];

beforeAll(() => {
  if (!getApps().length) initializeApp({ projectId: 'demo-mathquest' });
  db = getFirestore();
});

beforeEach(async () => {
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'nameKeys', 'usernames', 'config']) await db.recursiveDelete(db.collection(col));
  await db.doc('families/fam-1').set({ createdAt: 1 });
  await db.doc('families/fam-1/kids/k1').set({ id: 'k1', name: 'Emma' });
  await db.doc('pinIndex/fam-1/kids/k1').set({ nameKey: 'emma', salt: 'aa', hash: 'bb' });
  await db.doc('pinIndex/fam-1/kids/gone').set({ nameKey: 'ghost', salt: 'aa', hash: 'bb' });
  await db.doc('pinIndex/_global/attempts/ip_x').set({ entries: [] });
});

describe('backfill', () => {
  it('writes nothing on a dry run', async () => {
    const r = await backfill({ db, getEmail, apply: false });
    expect(r.registered).toBe(1);
    expect(r.nameKeys).toBe(1);
    expect((await db.collection('parents').get()).size).toBe(0);
    expect((await db.doc('meta/parentCount').get()).exists).toBe(false);
    expect((await db.collection('nameKeys').get()).size).toBe(0);
  });

  it('registers the family, sets the count and claims names of existing kids only', async () => {
    const r = await backfill({ db, getEmail, apply: true, now: () => 5 });
    expect(r.count).toBe(1);
    expect((await db.doc('parents/fam-1').get()).data()).toEqual({ email: 'one@example.com', createdAt: 5 });
    expect((await db.doc('meta/parentCount').get()).data()).toEqual({ count: 1 });
    expect((await db.doc('nameKeys/emma').get()).data()).toEqual({ familyUid: 'fam-1', kidId: 'k1' });
    expect((await db.doc('nameKeys/ghost').get()).exists).toBe(false);
    expect((await db.doc('parents/_global').get()).exists).toBe(false);
  });

  it('is safe to run twice', async () => {
    await backfill({ db, getEmail, apply: true });
    const r = await backfill({ db, getEmail, apply: true });
    expect(r.alreadyRegistered).toBe(1);
    expect(r.registered).toBe(0);
    expect((await db.doc('meta/parentCount').get()).data()).toEqual({ count: 1 });
  });

  it('reports a family with no verified email instead of registering it', async () => {
    await db.doc('families/fam-3').set({ createdAt: 1 });
    const r = await backfill({ db, getEmail, apply: true });
    expect(r.skippedNoEmail).toEqual(['fam-3']);
    expect((await db.doc('parents/fam-3').get()).exists).toBe(false);
  });

  it('reports a name two families share and keeps the first claim', async () => {
    await db.doc('families/fam-2/kids/k2').set({ id: 'k2', name: 'Emma' });
    await db.doc('pinIndex/fam-2/kids/k2').set({ nameKey: 'emma', salt: 'aa', hash: 'bb' });
    const r = await backfill({ db, getEmail, apply: true });
    expect(r.nameKeyConflicts).toEqual(['emma']);
    expect((await db.doc('nameKeys/emma').get()).data()).toEqual({ familyUid: 'fam-1', kidId: 'k1' });
  });

  it('refuses to exceed the cap', async () => {
    for (let i = 0; i < 21; i++) {
      await db.doc(`families/x${i}`).set({ createdAt: 1 });
      emails[`x${i}`] = `x${i}@example.com`;
    }
    const r = await backfill({ db, getEmail, apply: true });
    expect(r.overCap).toBe(true);
    expect((await db.collection('parents').get()).size).toBe(0);
  });
});
