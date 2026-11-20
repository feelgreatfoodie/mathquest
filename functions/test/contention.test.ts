import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { kidSignIn, setKidPin, parentPinHash, type AuthContext, type Deps } from '../src/core.js';
import { TEST_PEPPER } from './testPepper.js';

// Transaction contention on the sign-in counters. The Firestore emulator ends a contended transaction with the raw gRPC code 3
// ("Transaction is invalid or closed."), and the real service with code 10 (ABORTED). Both must reach the caller as HttpsError
// 'aborted', and every other error must stay as it is. Names, ids and PINs are made up.
const FAM = 'fam-uid-1';
const PARENT: AuthContext = { uid: FAM, email: 'parent-one@example.com', emailVerified: true, provider: 'google.com' };
const PIN = '7305';
let db: Firestore;
let clock = 1_700_000_000_000;
let txRuns = 0;
let txError: unknown = null;
/** Transactions that run clean before `txError` starts (1 lets reserve pass and fails the refund). */
let cleanRuns = 0;
/** A db whose transactions fail with `txError` while it is set: the counter write is where contention lands. */
const flakyDeps = (): Deps => {
  const flaky = new Proxy(db, {
    get(target, prop, recv) {
      if (prop === 'runTransaction') return async (...a: unknown[]) => { txRuns++; if (txError && txRuns > cleanRuns) throw txError; return (target.runTransaction as (...x: unknown[]) => unknown)(...a); };
      const v = Reflect.get(target, prop, recv);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as Firestore;
  return { db: flaky, pepper: TEST_PEPPER, now: () => clock, auth: { createCustomToken: async (uid, claims) => JSON.stringify({ uid, claims }) } };
};
const realDeps = (): Deps => ({ db, pepper: TEST_PEPPER, now: () => clock, auth: { createCustomToken: async (uid, claims) => JSON.stringify({ uid, claims }) } });
async function fail(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { code: unknown; message: string };
  }
  throw new Error('expected a failure');
}

beforeAll(() => {
  if (!getApps().length) initializeApp({ projectId: 'demo-mathquest' });
  db = getFirestore();
});
beforeEach(async () => {
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'parentPins', 'nameKeys', 'usernames', 'config']) await db.recursiveDelete(db.collection(col));
  clock = 1_700_000_000_000;
  txRuns = 0;
  cleanRuns = 0;
  txError = null;
  await db.doc(`parents/${FAM}`).set({ email: 'parent-one@example.com', createdAt: 1 });
  await db.doc('meta/parentCount').set({ count: 1 });
  await db.doc(`families/${FAM}`).set({ pinHash: parentPinHash(FAM, '4821'), createdAt: 1 });
  await db.doc(`parentPins/${FAM}`).set({ verifiedAt: clock });
  await db.doc(`families/${FAM}/kids/kid-pip`).set({ id: 'kid-pip', name: 'Pip', createdAt: 1, settings: {}, game: {} });
  await setKidPin(realDeps(), PARENT, { kidId: 'kid-pip', pin: PIN });
});

describe('kidSignIn maps counter-transaction contention to aborted', () => {
  const contention = [
    ['gRPC ABORTED 10', Object.assign(new Error('10 ABORTED: Too much contention on these documents. Please try again.'), { code: 10 })],
    ['the emulator code 3', Object.assign(new Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.'), { code: 3, details: 'Transaction is invalid or closed.' })],
  ] as const;
  for (const [label, err] of contention) {
    it(`${label} becomes aborted, for a wrong guess and for the right PIN`, async () => {
      txError = err;
      expect((await fail(kidSignIn(flakyDeps(), { name: 'Pip', pin: '0000', ip: '10.0.0.1' }))).code).toBe('aborted');
      expect((await fail(kidSignIn(flakyDeps(), { name: 'Pip', pin: PIN, ip: '10.0.0.1' }))).code).toBe('aborted');
    });
  }
  it('contention on the refund after a right PIN becomes aborted too', async () => {
    txError = contention[1][1];
    cleanRuns = 1;
    expect((await fail(kidSignIn(flakyDeps(), { name: 'Pip', pin: PIN, ip: '10.0.0.1' }))).code).toBe('aborted');
    expect(txRuns).toBe(2);
  });
  it('every other error stays as it was', async () => {
    const others = [
      Object.assign(new Error('3 INVALID_ARGUMENT: Property foo is too long.'), { code: 3 }),
      Object.assign(new Error('13 INTERNAL: boom'), { code: 13 }),
      Object.assign(new Error('14 UNAVAILABLE: down'), { code: 14 }),
      new Error('plain'),
    ];
    for (const err of others) {
      txError = err;
      expect(await fail(kidSignIn(flakyDeps(), { name: 'Pip', pin: '0000', ip: '10.0.0.1' }))).toBe(err);
    }
  });
  it('a contended wrong guess never reaches the passcode check, and a clean run still answers permission-denied and success', async () => {
    txError = contention[1][1];
    await fail(kidSignIn(flakyDeps(), { name: 'Pip', pin: '0000', ip: '10.0.0.1' }));
    txError = null;
    expect((await fail(kidSignIn(flakyDeps(), { name: 'Pip', pin: '0000', ip: '10.0.0.1' }))).code).toBe('permission-denied');
    expect(JSON.parse((await kidSignIn(flakyDeps(), { name: 'Pip', pin: PIN, ip: '10.0.0.2' })).token).claims.kidId).toBe('kid-pip');
  });
});
