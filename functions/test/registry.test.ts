import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FULL_MESSAGE,
  MAX_PARENTS,
  NAME_TAKEN_MESSAGE,
  kidSignIn,
  registerParent,
  setKidPin,
  type AuthContext,
  type Deps,
} from '../src/core.js';
import { TEST_PEPPER } from './testPepper.js';

// All uids, names, addresses and PINs below are made up for the tests.
let db: Firestore;
const clock = 1_700_000_000_000;

const deps = (): Deps => ({
  db,
  pepper: TEST_PEPPER,
  now: () => clock,
  auth: { createCustomToken: async (uid, claims) => JSON.stringify({ uid, claims }) },
});

const google = (n: number | string): AuthContext => ({
  uid: `uid-${n}`,
  email: `Parent${n}@Example.com`,
  emailVerified: true,
  provider: 'google.com',
});

async function fail(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { code: string; message: string };
  }
  throw new Error('expected a failure');
}

const count = async () => (await db.doc('meta/parentCount').get()).data()?.count;
const parentDocs = async () => (await db.collection('parents').get()).size;

async function seedCount(n: number) {
  await db.doc('meta/parentCount').set({ count: n });
}

beforeAll(() => {
  if (!getApps().length) initializeApp({ projectId: 'demo-mathquest' });
  db = getFirestore();
});

beforeEach(async () => {
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'nameKeys']) await db.recursiveDelete(db.collection(col));
});

describe('registerParent', () => {
  it('registers a verified Google account and counts it', async () => {
    expect(await registerParent(deps(), google(1))).toEqual({ ok: true });
    const doc = (await db.doc('parents/uid-1').get()).data()!;
    expect(doc.email).toBe('parent1@example.com');
    expect(typeof doc.createdAt).toBe('number');
    expect(await count()).toBe(1);
  });

  it('is idempotent per uid and does not count twice', async () => {
    await registerParent(deps(), google(1));
    await registerParent(deps(), google(1));
    expect(await count()).toBe(1);
    expect(await parentDocs()).toBe(1);
  });

  it('keeps an existing parent in when the registry is full', async () => {
    await registerParent(deps(), google(1));
    await seedCount(MAX_PARENTS);
    expect(await registerParent(deps(), google(1))).toEqual({ ok: true });
    expect(await count()).toBe(MAX_PARENTS);
  });

  it('lets in 20 parents and refuses the 21st with the full message', async () => {
    expect(MAX_PARENTS).toBe(20);
    for (let i = 1; i <= MAX_PARENTS; i++) await registerParent(deps(), google(i));
    expect(await count()).toBe(20);
    const e = await fail(registerParent(deps(), google(21)));
    expect(e.code).toBe('resource-exhausted');
    expect(e.message).toBe(FULL_MESSAGE);
    expect(FULL_MESSAGE).toBe('Math Quest is full right now.');
    expect(await count()).toBe(20);
    expect((await db.doc('parents/uid-21').get()).exists).toBe(false);
  });

  it('lets in exactly one of 2 concurrent calls at count 19', async () => {
    await seedCount(MAX_PARENTS - 1);
    const results = await Promise.allSettled([registerParent(deps(), google('a')), registerParent(deps(), google('b'))]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason.code).toBe('resource-exhausted');
    expect(await count()).toBe(MAX_PARENTS);
    expect(await parentDocs()).toBe(1);
  });

  it('never goes past the cap when 6 calls arrive at count 17', async () => {
    await seedCount(MAX_PARENTS - 3);
    const results = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((n) => registerParent(deps(), google(`c${n}`))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(await count()).toBe(MAX_PARENTS);
    expect(await parentDocs()).toBe(3);
  });

  it('refuses an unverified email, a missing email, no sign-in and a non-Google token', async () => {
    expect((await fail(registerParent(deps(), { ...google(1), emailVerified: false }))).code).toBe('permission-denied');
    expect((await fail(registerParent(deps(), { ...google(1), email: undefined }))).code).toBe('permission-denied');
    expect((await fail(registerParent(deps(), undefined))).code).toBe('unauthenticated');
    expect((await fail(registerParent(deps(), { ...google(1), provider: 'custom' }))).code).toBe('permission-denied');
    expect((await fail(registerParent(deps(), { uid: 'kid_x' }))).code).toBe('permission-denied');
    expect(await parentDocs()).toBe(0);
    expect(await count()).toBeUndefined();
  });
});

describe('kid names are unique across families', () => {
  const A = google('fam-a');
  const B = google('fam-b');
  const PIN = '7305';
  const PIN_B = '2946';

  beforeEach(async () => {
    await registerParent(deps(), A);
    await registerParent(deps(), B);
  });

  const seed = (fam: string, id: string, name: string) =>
    db.doc(`families/${fam}/kids/${id}`).set({ id, name, createdAt: 1, settings: {}, game: {} });

  it('refuses the same name in a second family, in any case, with the hint', async () => {
    await seed(A.uid, 'ka', 'Emma');
    await seed(B.uid, 'kb', ' EMMA ');
    await setKidPin(deps(), A, { kidId: 'ka', pin: PIN });
    const e = await fail(setKidPin(deps(), B, { kidId: 'kb', pin: PIN_B }));
    expect(e.code).toBe('already-exists');
    expect(e.message).toBe(NAME_TAKEN_MESSAGE);
    expect(NAME_TAKEN_MESSAGE).toBe('That name is taken. Try adding a last initial, like EmmaS.');
    expect((await db.doc(`pinIndex/${B.uid}/kids/kb`).get()).exists).toBe(false);
    expect((await db.doc('nameKeys/emma').get()).data()).toEqual({ familyUid: A.uid, kidId: 'ka' });
  });

  it('accepts the suggested spelling', async () => {
    await seed(A.uid, 'ka', 'Emma');
    await seed(B.uid, 'kb', 'EmmaS');
    await setKidPin(deps(), A, { kidId: 'ka', pin: PIN });
    await setKidPin(deps(), B, { kidId: 'kb', pin: PIN_B });
    const t = JSON.parse((await kidSignIn(deps(), { name: 'emmas', pin: PIN_B, ip: '1.1.1.1' })).token);
    expect(t.claims.familyUid).toBe(B.uid);
  });

  it('lets exactly one of 2 concurrent claims of one name win', async () => {
    await seed(A.uid, 'ka', 'Noor');
    await seed(B.uid, 'kb', 'Noor');
    const results = await Promise.allSettled([
      setKidPin(deps(), A, { kidId: 'ka', pin: PIN }),
      setKidPin(deps(), B, { kidId: 'kb', pin: PIN_B }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason.code).toBe('already-exists');
    const rows = (await db.collection('pinIndex').listDocuments()).length;
    expect(rows).toBe(1);
  });

  it('lets the same kid set a new PIN on its own name', async () => {
    await seed(A.uid, 'ka', 'Emma');
    await setKidPin(deps(), A, { kidId: 'ka', pin: PIN });
    await setKidPin(deps(), A, { kidId: 'ka', pin: PIN_B });
    expect(JSON.parse((await kidSignIn(deps(), { name: 'emma', pin: PIN_B, ip: '1.1.1.2' })).token).claims.kidId).toBe('ka');
  });

  it('frees a name when its kid was deleted', async () => {
    await seed(A.uid, 'ka', 'Emma');
    await setKidPin(deps(), A, { kidId: 'ka', pin: PIN });
    await db.doc(`families/${A.uid}/kids/ka`).delete();
    await seed(B.uid, 'kb', 'Emma');
    await setKidPin(deps(), B, { kidId: 'kb', pin: PIN_B });
    expect((await db.doc('nameKeys/emma').get()).data()).toEqual({ familyUid: B.uid, kidId: 'kb' });
  });

  it('releases the old name when a kid is renamed and gets a new PIN', async () => {
    await seed(A.uid, 'ka', 'Emma');
    await setKidPin(deps(), A, { kidId: 'ka', pin: PIN });
    await db.doc(`families/${A.uid}/kids/ka`).update({ name: 'EmmaS' });
    await setKidPin(deps(), A, { kidId: 'ka', pin: PIN });
    expect((await db.doc('nameKeys/emma').get()).exists).toBe(false);
    await seed(B.uid, 'kb', 'Emma');
    await setKidPin(deps(), B, { kidId: 'kb', pin: PIN_B });
  });

  it('refuses setKidPin from a signed-in account that never registered', async () => {
    const stranger = google('stranger');
    await seed(stranger.uid, 'ks', 'Zoe');
    expect((await fail(setKidPin(deps(), stranger, { kidId: 'ks', pin: PIN }))).code).toBe('permission-denied');
  });
});
