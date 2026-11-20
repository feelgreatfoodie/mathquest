import { randomBytes } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Counts every scrypt call core.ts makes, so a test can say "at most 5 verified guesses" without timing anything.
const scryptCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('node:crypto', async (orig) => {
  const real = await orig<typeof import('node:crypto')>();
  return {
    ...real,
    scrypt: (...args: Parameters<typeof real.scrypt>) => {
      scryptCalls.n += 1;
      return real.scrypt(...args);
    },
  };
});

import {
  LOCKED_PARENT_MESSAGE,
  PARENT_STALE_MESSAGE,
  checkParentPin,
  claimUsername,
  parentPinHash,
  setKidPicturePin,
  setKidPin,
  setParentPin,
  unlockKidSignIn,
  type AuthContext,
  type Deps,
} from '../src/core.js';
import { TEST_PEPPER } from './testPepper.js';

// L1b, the grown-up PIN as a callable: checkParentPin, setParentPin, the parentPins v2 row, the lockout per parent uid and the
// SHA-256 migration. Every uid, email and PIN below is made up.
const A = 'parent-uid-a';
const B = 'parent-uid-b';
const C = 'parent-uid-c';
const authOf = (uid: string, extra: Partial<AuthContext> = {}): AuthContext => ({ uid, email: `${uid}@example.com`, emailVerified: true, provider: 'google.com', ...extra });
const PIN = '4821';
const OTHER = '9034';
const MIN = 60_000;

let db: Firestore;
let clock = 1_700_000_000_000;
const deps = (pepper = TEST_PEPPER): Deps => ({
  db,
  pepper,
  now: () => clock,
  log: () => undefined,
  auth: { createCustomToken: async (uid, claims) => JSON.stringify({ uid, claims }) },
});

async function fail(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { code: string; message: string };
  }
  throw new Error('expected a failure');
}

async function clearAll() {
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'nameKeys', 'usernames', 'config', 'parentPins']) await db.recursiveDelete(db.collection(col));
}

/** A parent who set a v2 PIN through setParentPin. */
async function withRow(uid: string, pin = PIN) {
  await setParentPin(deps(), authOf(uid), { pin });
}
/** A parent whose PIN is still the browser-made SHA-256 in the family doc. */
async function withLegacy(uid: string, pin = PIN) {
  await db.doc(`families/${uid}`).set({ pinHash: parentPinHash(uid, pin), createdAt: 1 });
}
const row = async (uid: string) => (await db.doc(`parentPins/${uid}`).get()).data();
const family = async (uid: string) => (await db.doc(`families/${uid}`).get()).data();
const bucketDocs = async () => (await db.collection('pinIndex/_global/attempts').get()).docs.filter((x) => x.id.startsWith('par_'));

beforeAll(() => {
  if (!getApps().length) initializeApp({ projectId: 'demo-mathquest' });
  db = getFirestore();
});
afterAll(async () => {
  await clearAll();
});
beforeEach(async () => {
  await clearAll();
  clock = 1_700_000_000_000;
  for (const uid of [A, B, C]) await db.doc(`parents/${uid}`).set({ email: `${uid}@example.com`, createdAt: 1 });
});

describe('checkParentPin and setParentPin: who may call', () => {
  it('both refuse a caller who is signed out, unverified or not a registered parent', async () => {
    for (const call of [(a?: AuthContext) => checkParentPin(deps(), a, { pin: PIN }), (a?: AuthContext) => setParentPin(deps(), a, { pin: PIN })]) {
      expect((await fail(call(undefined))).code).toBe('unauthenticated');
      expect((await fail(call(authOf(A, { emailVerified: false })))).code).toBe('permission-denied');
      expect((await fail(call(authOf('stranger-uid'))))).toMatchObject({ code: 'permission-denied' });
    }
  });

  it('both refuse a PIN that is not 4 digits and count nothing', async () => {
    for (const pin of ['123', '12345', 'abcd', '', 1234, null, undefined]) {
      expect((await fail(checkParentPin(deps(), authOf(A), { pin })))).toMatchObject({ code: 'invalid-argument' });
      expect((await fail(setParentPin(deps(), authOf(A), { pin })))).toMatchObject({ code: 'invalid-argument' });
    }
    expect(await bucketDocs()).toHaveLength(0);
  });
});

describe('setParentPin writes the server-only v2 row', () => {
  it('writes parentPins/{uid} with a pepper-keyed scrypt hash, a fresh salt, v: 2, and marks the family doc hasPin', async () => {
    await setParentPin(deps(), authOf(A), { pin: PIN });
    const r = await row(A);
    expect(r).toMatchObject({ v: 2 });
    expect(r!.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(r!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r)).not.toContain(PIN);
    expect(await family(A)).toMatchObject({ hasPin: true });
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    // Another pepper cannot verify it: the hash is keyed.
    expect(await checkParentPin(deps('another-pepper-0123456789abcdef-xx'), authOf(A), { pin: PIN })).toEqual({ ok: false });
  });

  it('a call without a pepper refuses instead of writing an unkeyed hash', async () => {
    expect((await fail(setParentPin(deps(''), authOf(A), { pin: PIN }))).code).toBe('internal');
    expect(await row(A)).toBeUndefined();
  });

  it('changing an existing PIN needs a check of the old one within 30 minutes', async () => {
    await withRow(A);
    // setParentPin on a first PIN stamps no proof. A stranger at the device (a kid with devtools) has not checked the PIN.
    await db.doc(`parentPins/${A}`).update({ verifiedAt: 0 });
    expect((await fail(setParentPin(deps(), authOf(A), { pin: OTHER }))).code).toBe('failed-precondition');
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    clock += 29 * MIN;
    await setParentPin(deps(), authOf(A), { pin: OTHER });
    expect(await checkParentPin(deps(), authOf(A), { pin: OTHER })).toEqual({ ok: true });
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: false });
    clock += 31 * MIN;
    await db.doc(`parentPins/${A}`).update({ verifiedAt: 0 });
    expect((await fail(setParentPin(deps(), authOf(A), { pin: PIN }))).code).toBe('failed-precondition');
  });

  it('a parent who still has only the legacy hash cannot replace it without checking it first, and a check migrates it', async () => {
    await withLegacy(A);
    expect((await fail(setParentPin(deps(), authOf(A), { pin: OTHER }))).code).toBe('failed-precondition');
    expect(await row(A)).toBeUndefined();
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    await setParentPin(deps(), authOf(A), { pin: OTHER });
    expect(await checkParentPin(deps(), authOf(A), { pin: OTHER })).toEqual({ ok: true });
  });

  it('setKidPin refuses a kid PIN equal to the parent PIN after a recent check, whether the parent PIN is a v2 row or a legacy hash', async () => {
    await db.doc(`families/${A}/kids/kid-one`).set({ id: 'kid-one', name: 'Pip', createdAt: 1, settings: {}, game: {} });
    await withRow(A);
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    expect((await fail(setKidPin(deps(), authOf(A), { kidId: 'kid-one', pin: PIN }))).code).toBe('invalid-argument');
    await setKidPin(deps(), authOf(A), { kidId: 'kid-one', pin: OTHER });
    await withLegacy(B);
    await db.doc(`families/${B}/kids/kid-two`).set({ id: 'kid-two', name: 'Maya', createdAt: 1, settings: {}, game: {} });
    expect(await checkParentPin(deps(), authOf(B), { pin: PIN })).toEqual({ ok: true });
    expect((await fail(setKidPin(deps(), authOf(B), { kidId: 'kid-two', pin: PIN }))).code).toBe('invalid-argument');
  });
});

describe('no call answers about the parent PIN before a counted check', () => {
  const kid = (uid: string) => db.doc(`families/${uid}/kids/kid-one`).set({ id: 'kid-one', name: 'Pip', createdAt: 1, settings: {}, game: {} });

  it('without a recent check, setKidPin fails with the stale message for every PIN, equal to the parent PIN or not, and the equality error never appears', async () => {
    await kid(A);
    await withRow(A);
    const answers: string[] = [];
    for (const pin of [PIN, OTHER, '0000', '1111']) answers.push((await fail(setKidPin(deps(), authOf(A), { kidId: 'kid-one', pin }))).message);
    expect(new Set(answers)).toEqual(new Set([PARENT_STALE_MESSAGE]));
    // Same for a parent on the old pinHash.
    await kid(B);
    await withLegacy(B);
    for (const pin of [PIN, OTHER]) expect((await fail(setKidPin(deps(), authOf(B), { kidId: 'kid-one', pin }))).message).toBe(PARENT_STALE_MESSAGE);
    expect(await bucketDocs()).toHaveLength(0);
  });

  it('every guess without a check gets the one same answer, so a sweep of PINs learns nothing', async () => {
    await kid(A);
    await withRow(A);
    const sample = ['0000', PIN, '9999', '1234', '5555'];
    const codes = new Set<string>();
    for (const pin of sample) {
      const e = await fail(setKidPin(deps(), authOf(A), { kidId: 'kid-one', pin }));
      codes.add(`${e.code}:${e.message}`);
    }
    expect(codes.size).toBe(1);
  });

  it('a check older than 30 minutes is stale again, and setKidPicturePin is gated the same way', async () => {
    await kid(A);
    await withRow(A);
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    await setKidPin(deps(), authOf(A), { kidId: 'kid-one', pin: OTHER });
    await setKidPicturePin(deps(), authOf(A), { kidId: 'kid-one', picture: 'abcd' });
    clock += 31 * MIN;
    expect((await fail(setKidPin(deps(), authOf(A), { kidId: 'kid-one', pin: '1357' }))).message).toBe(PARENT_STALE_MESSAGE);
    expect((await fail(setKidPicturePin(deps(), authOf(A), { kidId: 'kid-one', picture: 'efgh' }))).message).toBe(PARENT_STALE_MESSAGE);
  });

  it('a parent with no PIN yet has nothing to guard: setKidPin works', async () => {
    await kid(C);
    await setKidPin(deps(), authOf(C), { kidId: 'kid-one', pin: OTHER });
  });
});

describe('lockout per parent uid', () => {
  it('5 wrong tries lock it, and the right PIN is refused too', async () => {
    await withRow(A);
    for (let i = 0; i < 5; i++) expect(await checkParentPin(deps(), authOf(A), { pin: OTHER })).toEqual({ ok: false });
    const e = await fail(checkParentPin(deps(), authOf(A), { pin: OTHER }));
    expect(e).toMatchObject({ code: 'resource-exhausted', message: LOCKED_PARENT_MESSAGE });
    expect((await fail(checkParentPin(deps(), authOf(A), { pin: PIN }))).code).toBe('resource-exhausted');
  });

  it('unlocks after 5 minutes, and a right PIN resets the count', async () => {
    await withRow(A);
    for (let i = 0; i < 5; i++) await checkParentPin(deps(), authOf(A), { pin: OTHER });
    clock += 5 * MIN - 1;
    expect((await fail(checkParentPin(deps(), authOf(A), { pin: PIN }))).code).toBe('resource-exhausted');
    clock += 2;
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    // 4 wrong, a success, 4 wrong do not lock.
    for (let i = 0; i < 4; i++) await checkParentPin(deps(), authOf(A), { pin: OTHER });
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    for (let i = 0; i < 4; i++) expect(await checkParentPin(deps(), authOf(A), { pin: OTHER })).toEqual({ ok: false });
  });

  it('doubles 5, 10, 20, 40, 60, 60 minutes', async () => {
    await withRow(A);
    for (const minutes of [5, 10, 20, 40, 60, 60]) {
      for (let i = 0; i < 5; i++) expect(await checkParentPin(deps(), authOf(A), { pin: OTHER })).toEqual({ ok: false });
      expect((await fail(checkParentPin(deps(), authOf(A), { pin: OTHER }))).code).toBe('resource-exhausted');
      clock += minutes * MIN - 1;
      expect((await fail(checkParentPin(deps(), authOf(A), { pin: OTHER }))).code).toBe('resource-exhausted');
      clock += 2;
    }
  });

  it('a Google sign-in after the lock opens it: the token auth_time is later than the lock', async () => {
    await withRow(A);
    for (let i = 0; i < 5; i++) await checkParentPin(deps(), authOf(A), { pin: OTHER });
    const lockedAt = clock;
    // A token minted before the lock does not open it.
    expect((await fail(checkParentPin(deps(), authOf(A, { authTime: Math.floor(lockedAt / 1000) - 60 }), { pin: PIN }))).code).toBe('resource-exhausted');
    clock += MIN;
    const fresh = authOf(A, { authTime: Math.floor(clock / 1000) });
    expect(await checkParentPin(deps(), fresh, { pin: PIN })).toEqual({ ok: true });
  });
});

describe('strikes survive a right PIN', () => {
  const lockIt = async () => {
    for (let i = 0; i < 7; i++) {
      try {
        await checkParentPin(deps(), authOf(A), { pin: OTHER });
      } catch (e) {
        expect((e as { code: string }).code).toBe('resource-exhausted');
        return;
      }
    }
    throw new Error('never locked');
  };
  const lockMs = async () => {
    const doc = (await bucketDocs())[0]!;
    return (doc.data().lockedUntil as number) - clock;
  };

  it('a right PIN after the 3rd lock keeps strikes at 3, so the next lock is the long one (40 min)', async () => {
    await withRow(A);
    for (const minutes of [5, 10, 20]) {
      await lockIt();
      expect(await lockMs()).toBe(minutes * MIN);
      clock += minutes * MIN + 1;
    }
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    expect((await bucketDocs())[0]!.data()).toMatchObject({ strikes: 3, fails: 0 });
    await lockIt();
    expect(await lockMs()).toBe(40 * MIN);
  });

  it('a right 5th try leaves no phantom strike: 4 wrong then right, twice, then 5 real wrong tries lock for 5 minutes and a re-sign-in opens it', async () => {
    await withRow(A);
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 4; i++) await checkParentPin(deps(), authOf(A), { pin: OTHER });
      expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
      expect((await bucketDocs())[0]!.data()).toMatchObject({ strikes: 0, strikeAt: 0, fails: 0, lockedUntil: 0 });
    }
    await lockIt();
    expect(await lockMs()).toBe(5 * MIN);
    clock += 1000;
    expect(await checkParentPin(deps(), authOf(A, { authTime: Math.floor(clock / 1000) + 1 }), { pin: PIN })).toEqual({ ok: true });
  });

  it('a right 5th try after real locks restores the strikes and strikeAt it had before that try', async () => {
    await withRow(A);
    await lockIt();
    const lockedAt = clock;
    clock += 5 * MIN + 1;
    for (let i = 0; i < 4; i++) await checkParentPin(deps(), authOf(A), { pin: OTHER });
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    expect((await bucketDocs())[0]!.data()).toMatchObject({ strikes: 1, strikeAt: lockedAt, fails: 0, lockedUntil: 0 });
  });

  it('a right PIN still clears the wrong-try count', async () => {
    await withRow(A);
    for (let i = 0; i < 4; i++) await checkParentPin(deps(), authOf(A), { pin: OTHER });
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    for (let i = 0; i < 4; i++) expect(await checkParentPin(deps(), authOf(A), { pin: OTHER })).toEqual({ ok: false });
  });

  it('strikes reset after 24 hours with no lock: the next lock is 5 minutes again', async () => {
    await withRow(A);
    await lockIt();
    clock += 5 * MIN + 1;
    await lockIt();
    expect(await lockMs()).toBe(10 * MIN);
    clock += 10 * MIN + 1;
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    clock += 24 * 60 * MIN;
    await lockIt();
    expect(await lockMs()).toBe(5 * MIN);
  });
});

describe('a Google sign-in opens only the first 2 locks', () => {
  it('4 locks with a sign-in after each: the 1st and 2nd open at once, the 3rd and 4th stay locked until the timer ends', async () => {
    await withRow(A);
    const signedInAfter = () => authOf(A, { authTime: Math.floor(clock / 1000) + 1 });
    // Wrong tries until the lock refuses one (5 wrong set it, the 6th is refused).
    const lockIt = async () => {
      for (let i = 0; i < 7; i++) {
        try {
          await checkParentPin(deps(), authOf(A), { pin: OTHER });
        } catch (e) {
          expect((e as { code: string }).code).toBe('resource-exhausted');
          return;
        }
      }
      throw new Error('never locked');
    };
    // Locks 1 and 2: a sign-in after the lock lets the next try through.
    for (const _ of [1, 2]) {
      await lockIt();
      clock += 1000;
      expect(await checkParentPin(deps(), signedInAfter(), { pin: OTHER })).toEqual({ ok: false });
    }
    // Lock 3 (20 min): a sign-in does nothing, the timer does.
    await lockIt();
    clock += 1000;
    expect((await fail(checkParentPin(deps(), signedInAfter(), { pin: PIN }))).code).toBe('resource-exhausted');
    clock += 20 * MIN;
    expect(await checkParentPin(deps(), authOf(A), { pin: OTHER })).toEqual({ ok: false });
    // Lock 4 (40 min): same.
    await lockIt();
    clock += 1000;
    expect((await fail(checkParentPin(deps(), signedInAfter(), { pin: PIN }))).code).toBe('resource-exhausted');
    expect((await fail(checkParentPin(deps(), signedInAfter(), { pin: PIN }))).code).toBe('resource-exhausted');
    clock += 40 * MIN;
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
  });
});

describe('migration from families/{uid}.pinHash', () => {
  it('a right PIN writes the v2 row, deletes pinHash and sets hasPin, once', async () => {
    await withLegacy(A);
    expect(await row(A)).toBeUndefined();
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    const first = await row(A);
    expect(first).toMatchObject({ v: 2 });
    const fam = await family(A);
    expect(fam).toMatchObject({ hasPin: true, createdAt: 1 });
    expect(fam).not.toHaveProperty('pinHash');
    // The second check verifies against the row and rewrites nothing: same salt, same hash.
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
    const second = await row(A);
    expect(second!.salt).toBe(first!.salt);
    expect(second!.hash).toBe(first!.hash);
  });

  it('two right checks at once leave one consistent v2 row that verifies', async () => {
    await withLegacy(A);
    const out = await Promise.allSettled([checkParentPin(deps(), authOf(A), { pin: PIN }), checkParentPin(deps(), authOf(A), { pin: PIN })]);
    // The property, not the counts: a right PIN never shows as wrong. The loser of the race checks the PIN against the winner's
    // row. A call the emulator ends on contention is not an answer at all, so it may reject, and at least one call is ok.
    for (const o of out) if (o.status === 'fulfilled') expect(o.value.ok).toBe(true);
    expect(out.some((o) => o.status === 'fulfilled')).toBe(true);
    expect(await row(A)).toMatchObject({ v: 2 });
    expect(await family(A)).not.toHaveProperty('pinHash');
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: true });
  });

  it('a wrong PIN never migrates: no row, pinHash untouched', async () => {
    await withLegacy(A);
    for (let i = 0; i < 5; i++) expect(await checkParentPin(deps(), authOf(A), { pin: OTHER })).toEqual({ ok: false });
    expect(await row(A)).toBeUndefined();
    expect((await family(A))!.pinHash).toBe(parentPinHash(A, PIN));
    expect(await family(A)).not.toHaveProperty('hasPin');
  });

  it('a legacy hash made for another uid never verifies', async () => {
    await db.doc(`families/${A}`).set({ pinHash: parentPinHash(B, PIN), createdAt: 1 });
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: false });
    expect(await row(A)).toBeUndefined();
  });

  it('a lingering pinHash next to a v2 row is ignored for checking and removed on a right check', async () => {
    await withRow(A, OTHER);
    await db.doc(`families/${A}`).set({ pinHash: parentPinHash(A, PIN) }, { merge: true });
    expect(await checkParentPin(deps(), authOf(A), { pin: PIN })).toEqual({ ok: false });
    expect(await checkParentPin(deps(), authOf(A), { pin: OTHER })).toEqual({ ok: true });
    expect(await family(A)).not.toHaveProperty('pinHash');
  });
});

describe('every refusal counts the same bucket, so lock timing shows nothing about which accounts exist', () => {
  /** The answer to each of 7 wrong tries: 'ok:false' or the error code. */
  async function answers(uid: string) {
    const out: string[] = [];
    for (let i = 0; i < 7; i++) {
      try {
        out.push(`ok:${(await checkParentPin(deps(), authOf(uid), { pin: OTHER })).ok}`);
      } catch (e) {
        out.push((e as { code: string }).code);
      }
    }
    return out;
  }

  it('a parent with a parentPins row, a parent on the legacy pinHash and a parent with no PIN get the same answers and lock on the same try', async () => {
    await withRow(A);
    await withLegacy(B);
    // C has no PIN at all.
    const [a, b, c] = [await answers(A), await answers(B), await answers(C)];
    expect(a).toEqual(['ok:false', 'ok:false', 'ok:false', 'ok:false', 'ok:false', 'resource-exhausted', 'resource-exhausted']);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('each of them pays exactly one scrypt per counted try, and none after the lock', async () => {
    await withRow(A);
    await withLegacy(B);
    for (const uid of [A, B, C]) {
      const before = scryptCalls.n;
      await answers(uid);
      expect(scryptCalls.n - before).toBe(5);
    }
  });

  it('after the lock, all three buckets hold the same 5 minute lock', async () => {
    await withRow(A);
    await withLegacy(B);
    for (const uid of [A, B, C]) await answers(uid);
    const spans = (await bucketDocs()).map((x) => (x.data().lockedUntil as number) - clock);
    expect(spans).toEqual([5 * MIN, 5 * MIN, 5 * MIN]);
  });
});

describe("one parent's reset or unlock clears only the buckets that parent owns", () => {
  async function lock(uid: string) {
    for (let i = 0; i < 5; i++) await checkParentPin(deps(), authOf(uid), { pin: OTHER });
    expect((await fail(checkParentPin(deps(), authOf(uid), { pin: OTHER }))).code).toBe('resource-exhausted');
  }

  it("parent B's setParentPin, right check, kid-PIN reset and Unlock leave parent A's lock in place", async () => {
    await withRow(A);
    await withRow(B, OTHER);
    await lock(A);
    await db.doc(`families/${B}/kids/kid-b`).set({ id: 'kid-b', name: 'Bee', createdAt: 1, settings: {}, game: {} });
    expect(await checkParentPin(deps(), authOf(B), { pin: OTHER })).toEqual({ ok: true });
    await setParentPin(deps(), authOf(B), { pin: '6612' });
    await setKidPin(deps(), authOf(B), { kidId: 'kid-b', pin: '1357' });
    await claimUsername(deps(), B, 'kid-b', 'bee_runner');
    await unlockKidSignIn(deps(), authOf(B));
    expect((await fail(checkParentPin(deps(), authOf(A), { pin: PIN }))).code).toBe('resource-exhausted');
  });

  it("parent A's own lock is not opened by A's setParentPin, so a locked-out caller cannot reset their way in", async () => {
    await withRow(A);
    await lock(A);
    expect((await fail(setParentPin(deps(), authOf(A), { pin: OTHER }))).code).toBe('resource-exhausted');
    expect((await fail(checkParentPin(deps(), authOf(A), { pin: PIN }))).code).toBe('resource-exhausted');
  });

  it('parent A and parent B have their own buckets: B can still try while A is locked', async () => {
    await withRow(A);
    await withRow(B, OTHER);
    await lock(A);
    expect(await checkParentPin(deps(), authOf(B), { pin: OTHER })).toEqual({ ok: true });
  });
});

describe('parallel guesses', () => {
  it('30 parallel wrong tries give at most 5 verified guesses, no ok, and only allowed codes', async () => {
    await withRow(A);
    const before = scryptCalls.n;
    const out = await Promise.allSettled(Array.from({ length: 30 }, () => checkParentPin(deps(), authOf(A), { pin: randomPin() })));
    const verified = scryptCalls.n - before;
    expect(verified).toBeLessThanOrEqual(5);
    for (const o of out) {
      if (o.status === 'fulfilled') expect(o.value.ok).toBe(false);
      else expect(['resource-exhausted', 'aborted']).toContain((o.reason as { code: string }).code);
    }
    // And the lock holds: the right PIN is refused afterwards.
    expect((await fail(checkParentPin(deps(), authOf(A), { pin: PIN }))).code).toBe('resource-exhausted');
  });

  it('parallel wrong tries on a legacy parent give at most 5 verified guesses and never migrate', async () => {
    await withLegacy(A);
    const before = scryptCalls.n;
    const out = await Promise.allSettled(Array.from({ length: 30 }, () => checkParentPin(deps(), authOf(A), { pin: OTHER })));
    expect(scryptCalls.n - before).toBeLessThanOrEqual(5);
    for (const o of out) if (o.status === 'fulfilled') expect(o.value.ok).toBe(false);
    expect(await row(A)).toBeUndefined();
  });
});

function randomPin(): string {
  let p = String(randomBytes(2).readUInt16BE(0) % 10_000).padStart(4, '0');
  if (p === PIN) p = '0000';
  return p;
}
