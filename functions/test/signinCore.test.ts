import { createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Counts every scrypt call core.ts makes, so a test can say "one scrypt" without timing anything.
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
  LIMITS,
  LOCKED_MESSAGE,
  MAX_PARENTS,
  MISMATCH_MESSAGE,
  USERNAME_INVALID_MESSAGE,
  USERNAME_RESERVED_MESSAGE,
  USERNAME_TAKEN_MESSAGE,
  claimUsername,
  deviceLabel,
  kidLockStatus,
  kidSignIn,
  lockMsFor,
  parentPinHash,
  registerParent,
  setKidPicturePin,
  setKidPin,
  unlockKidSignIn,
  type AuthContext,
  type Deps,
} from '../src/core.js';
import { reservedReason } from '../src/reserved.js';
import { TEST_PEPPER } from './testPepper.js';

// L1a, the sign-in server core: the usernames index, kidSignIn v2 with the legacy fallback, the 4 lock buckets, pepper v2
// hashes, device records, and the parent cap in config. Every name, id, address and passcode below is made up.
const FAM = 'fam-uid-1';
const FAM2 = 'fam-uid-2';
const PARENT: AuthContext = { uid: FAM, email: 'parent-one@example.com', emailVerified: true, provider: 'google.com' };
const PARENT2: AuthContext = { uid: FAM2, email: 'parent-two@example.com', emailVerified: true, provider: 'google.com' };
const PIN = '7305';
const PIN_B = '2946';
const MIN = 60_000;
const DEV_A = 'devA-0123456789abcdef';
const DEV_B = 'devB-0123456789abcdef';
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

let db: Firestore;
/** Stamps the Grown-up PIN as typed just now, the way a right checkParentPin does. */
const verifyParent = () => db.doc(`parentPins/${FAM}`).set({ verifiedAt: clock });

let clock = 1_700_000_000_000;
let logs: Record<string, unknown>[] = [];

const deps = (): Deps => ({
  db,
  pepper: TEST_PEPPER,
  now: () => clock,
  log: (e) => void logs.push(e),
  auth: { createCustomToken: async (uid, claims) => JSON.stringify({ uid, claims }) },
});

type SignInArgs = { username?: string; name?: string; pin?: string; picturePin?: string; deviceId?: unknown; ip?: string; userAgent?: string; app?: 'valid' | 'missing' };
const signIn = (a: SignInArgs) => kidSignIn(deps(), { pin: PIN, ip: '10.0.0.1', ...a });
const claimsOf = (r: { token: string }) => JSON.parse(r.token) as { uid: string; claims: Record<string, string> };

async function fail(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { code: string; message: string };
  }
  throw new Error('expected a failure');
}

async function seedKid(fam: string, id: string, name: string) {
  await db.doc(`families/${fam}/kids/${id}`).set({ id, name, createdAt: 1, settings: {}, game: {} });
}

async function clearAll() {
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'parentPins', 'nameKeys', 'usernames', 'config']) await db.recursiveDelete(db.collection(col));
}

/** Seeds a kid with a PIN and, with a username, a claimed username. */
async function player(fam: string, parent: AuthContext, id: string, name: string, pin: string, username?: string) {
  await seedKid(fam, id, name);
  await setKidPin(deps(), parent, { kidId: id, pin });
  if (username) await claimUsername(deps(), fam, id, username);
}

/** The pinIndex counter docs, by prefix. */
async function counters(prefix: string) {
  const snap = await db.collection('pinIndex/_global/attempts').get();
  return snap.docs.filter((x) => x.id.startsWith(prefix));
}

beforeAll(() => {
  if (!getApps().length) initializeApp({ projectId: 'demo-mathquest' });
  db = getFirestore();
});

afterAll(async () => {
  // Leave no usernames or counters behind: the other test files share this emulator.
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'parentPins', 'nameKeys', 'usernames', 'config']) await db.recursiveDelete(db.collection(col));
});

beforeEach(async () => {
  await clearAll();
  clock = 1_700_000_000_000;
  logs = [];
  await db.doc(`parents/${FAM}`).set({ email: 'parent-one@example.com', createdAt: 1 });
  await db.doc(`parents/${FAM2}`).set({ email: 'parent-two@example.com', createdAt: 1 });
  await db.doc('meta/parentCount').set({ count: 2 });
  await db.doc(`families/${FAM}`).set({ pinHash: parentPinHash(FAM, '4821'), createdAt: 1 });
  // The parent typed the Grown-up PIN a moment ago (setKidPin and setKidPicturePin need that). Tests that move the clock call verifyParent().
  await verifyParent();
  await player(FAM, PARENT, 'kid-pip', 'Pip', PIN, 'pip_runner');
  await player(FAM, PARENT, 'kid-maya', 'Maya', PIN_B); // no username yet: a legacy player
});

describe('username sign-in', () => {
  it('signs in by username, case-insensitively, and returns the token and remember: true', async () => {
    const r = await signIn({ username: 'Pip_Runner' });
    expect(claimsOf(r)).toEqual({ uid: 'kid_kid-pip', claims: { role: 'kid', familyUid: FAM, kidId: 'kid-pip' } });
    expect(r.remember).toBe(true);
  });

  it('accepts a picture passcode as pin or as picturePin', async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: 'abcd' });
    expect(claimsOf(await signIn({ username: 'pip_runner', pin: 'abcd' })).claims.kidId).toBe('kid-pip');
    expect(claimsOf(await signIn({ username: 'pip_runner', pin: undefined, picturePin: 'abcd' })).claims.kidId).toBe('kid-pip');
  });

  it('refuses a wrong passcode with the generic message', async () => {
    const e = await fail(signIn({ username: 'pip_runner', pin: '0000' }));
    expect({ code: e.code, message: e.message }).toEqual({ code: 'permission-denied', message: MISMATCH_MESSAGE });
    expect(MISMATCH_MESSAGE).toBe("That username and passcode didn't match.");
  });

  it('refuses a username whose kid doc is gone, like an unknown name', async () => {
    await db.doc(`families/${FAM}/kids/kid-pip`).delete();
    expect((await fail(signIn({ username: 'pip_runner' }))).message).toBe(MISMATCH_MESSAGE);
  });

  it('refuses a username whose family is no longer registered', async () => {
    await db.doc(`parents/${FAM}`).delete();
    expect((await fail(signIn({ username: 'pip_runner' }))).message).toBe(MISMATCH_MESSAGE);
  });
});

describe('legacy display-name sign-in', () => {
  it('still signs in by display name, with name or username sent as the typed string, and logs legacy: true', async () => {
    expect(claimsOf(await signIn({ name: 'Maya', pin: PIN_B })).claims.kidId).toBe('kid-maya');
    expect(claimsOf(await signIn({ username: 'maya', pin: PIN_B })).claims.kidId).toBe('kid-maya');
    expect(logs.map((l) => l.legacy)).toEqual([true, true]);
  });

  it('a kid with a username signs in by username without the legacy flag', async () => {
    await signIn({ username: 'pip_runner' });
    expect(logs[0]).toMatchObject({ event: 'kidSignIn', outcome: 'ok', legacy: false });
  });

  it('the username index wins when a username equals another player\'s display name', async () => {
    // Maya has no username. Pip's family claims "maya" for Pip: typing maya now reaches Pip, not the display name Maya.
    await claimUsername(deps(), FAM, 'kid-pip', 'maya');
    expect(claimsOf(await signIn({ name: 'Maya', pin: PIN })).claims.kidId).toBe('kid-pip');
    expect((await fail(signIn({ name: 'Maya', pin: PIN_B, ip: '10.0.0.2' }))).message).toBe(MISMATCH_MESSAGE);
  });

  it('a legacy sign-in by display name counts against the kid\'s username bucket too, so the name is no way around its lock', async () => {
    // Pip has the username pip_runner and the display name Pip.
    for (let i = 0; i < LIMITS.username.max; i++) await fail(signIn({ name: 'Pip', pin: '0000', ip: `10.1.0.${i}` }));
    expect((await fail(signIn({ username: 'pip_runner', ip: '10.1.0.99' }))).code).toBe('resource-exhausted');
  });

  it('writes no kid name, kid id or username into the log line, only a hash of the family', async () => {
    await signIn({ name: 'Maya', pin: PIN_B });
    const line = JSON.stringify(logs[0]);
    for (const secret of ['Maya', 'maya', 'kid-maya', FAM]) expect(line).not.toContain(secret);
    expect(logs[0]!.fam).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('one generic error and one scrypt on a miss', () => {
  const scryptDuring = async (p: Promise<unknown>) => {
    scryptCalls.n = 0;
    await fail(p);
    return scryptCalls.n;
  };

  it('an unknown name, a wrong passcode on a known username and a wrong passcode on a legacy name each pay exactly one scrypt', async () => {
    expect(await scryptDuring(signIn({ username: 'nobody_here', ip: '10.2.0.1' }))).toBe(1);
    expect(await scryptDuring(signIn({ username: 'pip_runner', pin: '0000', ip: '10.2.0.2' }))).toBe(1);
    expect(await scryptDuring(signIn({ name: 'Maya', pin: '0000', ip: '10.2.0.3' }))).toBe(1);
    expect(await scryptDuring(signIn({ name: 'Not A Username!', ip: '10.2.0.4' }))).toBe(1);
  });

  it('all of them return the same code and message', async () => {
    const errs = [
      await fail(signIn({ username: 'nobody_here', ip: '10.2.1.1' })),
      await fail(signIn({ username: 'pip_runner', pin: '0000', ip: '10.2.1.2' })),
      await fail(signIn({ name: 'Maya', pin: '0000', ip: '10.2.1.3' })),
      await fail(signIn({ name: 'Zzz Qqq', ip: '10.2.1.4' })),
    ];
    for (const e of errs) expect({ code: e.code, message: e.message }).toEqual({ code: 'permission-denied', message: MISMATCH_MESSAGE });
  });
});

describe('the 4 lock buckets', () => {
  it('username: 5 wrong in a row lock it, and the right passcode is refused too', async () => {
    for (let i = 0; i < LIMITS.username.max; i++) expect((await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.3.0.${i}` }))).code).toBe('permission-denied');
    const e = await fail(signIn({ username: 'pip_runner', ip: '10.3.0.99' }));
    expect({ code: e.code, message: e.message }).toEqual({ code: 'resource-exhausted', message: LOCKED_MESSAGE });
    // Another username is not affected.
    expect(claimsOf(await signIn({ name: 'Maya', pin: PIN_B, ip: '10.3.0.98' })).claims.kidId).toBe('kid-maya');
  });

  it('username: it unlocks after 5 minutes and a success resets the count', async () => {
    for (let i = 0; i < 5; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.3.1.${i}` }));
    clock += 5 * MIN - 1;
    expect((await fail(signIn({ username: 'pip_runner', ip: '10.3.1.50' }))).code).toBe('resource-exhausted');
    clock += 2;
    expect(claimsOf(await signIn({ username: 'pip_runner', ip: '10.3.1.51' })).claims.kidId).toBe('kid-pip');
    // The success cleared fails and strikes: 4 wrong again do not lock.
    for (let i = 0; i < 4; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.3.1.${60 + i}` }));
    expect(claimsOf(await signIn({ username: 'pip_runner', ip: '10.3.1.70' })).claims.kidId).toBe('kid-pip');
  });

  it('username: 4 wrong, a success, 4 wrong do not lock ("in a row")', async () => {
    for (let i = 0; i < 4; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.3.2.${i}` }));
    await signIn({ username: 'pip_runner', ip: '10.3.2.10' });
    for (let i = 0; i < 4; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.3.2.${20 + i}` }));
    expect(claimsOf(await signIn({ username: 'pip_runner', ip: '10.3.2.30' })).claims.kidId).toBe('kid-pip');
  });

  it('username: the lock doubles 5, 10, 20, 40, 60, 60 minutes', async () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(lockMsFor).map((ms) => ms / MIN)).toEqual([5, 10, 20, 40, 60, 60, 60]);
    const bucket = async () => (await counters('user_'))[0]!.data();
    const seen: number[] = [];
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 5; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.3.3.${round * 10 + i}` }));
      const b = await bucket();
      seen.push((b.lockedUntil - clock) / MIN);
      expect(b.strikes).toBe(round + 1);
      expect((await fail(signIn({ username: 'pip_runner', ip: '10.3.3.250' }))).code).toBe('resource-exhausted');
      clock += b.lockedUntil - clock + 1;
    }
    expect(seen).toEqual([5, 10, 20, 40, 60, 60]);
  });

  it('username: strikes reset after 24 hours with no lock, and a success resets them at once', async () => {
    for (let i = 0; i < 5; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.3.4.${i}` }));
    clock += 24 * 60 * MIN;
    for (let i = 0; i < 5; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.3.4.${10 + i}` }));
    expect(((await counters('user_'))[0]!.data().lockedUntil - clock) / MIN).toBe(5); // back to 5 minutes, not 10
    clock += 5 * MIN + 1;
    await signIn({ username: 'pip_runner', ip: '10.3.4.30' });
    expect((await counters('user_'))[0]!.data()).toMatchObject({ fails: 0, strikes: 0 });
  });

  it('device: 20 wrong from one deviceId lock that device for 15 minutes, other devices and calls without one are unaffected', async () => {
    for (let i = 0; i < LIMITS.device.max; i++) await fail(signIn({ username: `ghost_${i}`, deviceId: DEV_A, ip: `10.4.0.${i}` }));
    const e = await fail(signIn({ username: 'pip_runner', deviceId: DEV_A, ip: '10.4.1.1' }));
    expect({ code: e.code, message: e.message }).toEqual({ code: 'resource-exhausted', message: LOCKED_MESSAGE });
    expect(claimsOf(await signIn({ username: 'pip_runner', deviceId: DEV_B, ip: '10.4.1.2' })).claims.kidId).toBe('kid-pip');
    expect(claimsOf(await signIn({ username: 'pip_runner', ip: '10.4.1.3' })).claims.kidId).toBe('kid-pip');
    clock += LIMITS.device.windowMs + 1;
    expect(claimsOf(await signIn({ username: 'pip_runner', deviceId: DEV_A, ip: '10.4.1.4' })).claims.kidId).toBe('kid-pip');
  });

  it('device: a missing or malformed deviceId skips the device bucket (no shared "no device" bucket until L4)', async () => {
    for (let i = 0; i < LIMITS.device.max + 5; i++) await fail(signIn({ username: `ghost_${i}`, deviceId: i % 2 ? 'short' : undefined, ip: `10.4.2.${i}` }));
    expect(await counters('dev_')).toHaveLength(0);
    expect(claimsOf(await signIn({ username: 'pip_runner', ip: '10.4.2.200' })).claims.kidId).toBe('kid-pip');
  });

  it('network: 50 wrong from one IP lock it for 15 minutes and keep families[]', async () => {
    await fail(signIn({ username: 'pip_runner', pin: '0000', ip: '10.5.0.1' }));
    for (let i = 1; i < LIMITS.ip.max; i++) await fail(signIn({ username: `ghost_${i}`, ip: '10.5.0.1' }));
    const e = await fail(signIn({ username: 'pip_runner', ip: '10.5.0.1' }));
    expect(e.code).toBe('resource-exhausted');
    expect((await counters('ip_'))[0]!.data().families).toEqual([FAM]);
    clock += LIMITS.ip.windowMs + 1;
    expect(claimsOf(await signIn({ username: 'pip_runner', ip: '10.5.0.1' })).claims.kidId).toBe('kid-pip');
  });

  it('family: 100 wrong in an hour lock the family for an hour and Unlock clears it', async () => {
    // 99 counted failures are seeded (100 real scrypt tries would take a minute); the 100th is a real wrong try.
    const entries = Array.from({ length: LIMITS.family.max - 1 }, (_, i) => ({ id: `seed${i}`, at: clock - 1000 }));
    await db.doc(`pinIndex/${FAM}/attempts/family`).set({ entries, lockedUntil: 0, lockedBy: null, families: [], updatedAt: clock });
    await fail(signIn({ username: 'pip_runner', pin: '0000', ip: '10.6.0.1' }));
    expect((await fail(signIn({ username: 'pip_runner', ip: '10.6.0.2' }))).code).toBe('resource-exhausted');
    expect((await db.doc(`pinIndex/${FAM}/attempts/family`).get()).data()!.lockedUntil - clock).toBe(LIMITS.family.windowMs);
    await unlockKidSignIn(deps(), PARENT);
    expect(claimsOf(await signIn({ username: 'pip_runner', ip: '10.6.0.3' })).claims.kidId).toBe('kid-pip');
  });

  it('an unknown name is counted exactly like a known one: 5 wrong lock it too', async () => {
    for (let i = 0; i < 5; i++) await fail(signIn({ username: 'nobody_here', pin: '0000', ip: `10.7.0.${i}` }));
    const e = await fail(signIn({ username: 'nobody_here', pin: '0000', ip: '10.7.0.99' }));
    expect({ code: e.code, message: e.message }).toEqual({ code: 'resource-exhausted', message: LOCKED_MESSAGE });
  });

  it('a right passcode on the 5th try refunds the lock it would have set', async () => {
    for (let i = 0; i < 4; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.7.1.${i}` }));
    expect(claimsOf(await signIn({ username: 'pip_runner', ip: '10.7.1.10' })).claims.kidId).toBe('kid-pip');
    expect((await counters('user_'))[0]!.data()).toMatchObject({ lockedUntil: 0, fails: 0, strikes: 0 });
  });
});

describe('wrong tries never show whether a display name is real', () => {
  /** The code of each of 6 wrong tries, one distinct IP per try. */
  async function sequence(typed: { username?: string; name?: string }, tag: string) {
    const out: string[] = [];
    for (let i = 0; i < 6; i++) out.push((await fail(signIn({ ...typed, pin: '0000', ip: `10.20.${tag}.${i}` }))).code);
    return out;
  }

  it('an unknown name, a legacy name with no username, a username and a legacy name of a kid with a username give the same 6 answers', async () => {
    await player(FAM, PARENT, 'kid-emma', 'Emma S', PIN); // legacy, display name is not username shaped, no username
    await player(FAM, PARENT, 'kid-nina', 'Nina', PIN, 'nina_n'); // has a username, so a legacy sign-in by display name strikes under it
    const cases = {
      unknownName: await sequence({ name: 'Zora' }, '1'),
      legacyNoUsername: await sequence({ name: 'Maya' }, '2'),
      username: await sequence({ username: 'pip_runner' }, '3'),
      legacyOfKidWithUsername: await sequence({ name: 'Nina' }, '4'),
      unknownNotUsernameShaped: await sequence({ name: 'Zed Qq' }, '5'),
      legacyNotUsernameShaped: await sequence({ name: 'Emma S' }, '6'),
      unknownUsername: await sequence({ username: 'nobody_here' }, '7'),
    };
    const want = ['permission-denied', 'permission-denied', 'permission-denied', 'permission-denied', 'permission-denied', 'resource-exhausted'];
    for (const [k, seq] of Object.entries(cases)) expect(seq, k).toEqual(want);
  });

  it('a legacy name with no username locks on its 5th wrong try, and a grown-up Unlock, a PIN reset and the lock status cover that lock', async () => {
    await sequence({ name: 'Maya' }, '8');
    expect((await fail(signIn({ name: 'Maya', pin: PIN_B, ip: '10.20.9.1' }))).code).toBe('resource-exhausted');
    expect((await kidLockStatus(deps(), PARENT)).lockedPlayers).toEqual(['maya']);
    await unlockKidSignIn(deps(), PARENT);
    expect(claimsOf(await signIn({ name: 'Maya', pin: PIN_B, ip: '10.20.9.2' })).claims.kidId).toBe('kid-maya');

    await sequence({ name: 'Maya' }, '10');
    await setKidPin(deps(), PARENT, { kidId: 'kid-maya', pin: PIN });
    expect(claimsOf(await signIn({ name: 'Maya', pin: PIN, ip: '10.20.9.3' })).claims.kidId).toBe('kid-maya');
  });
});

describe("a family's Unlock and PIN reset never clear another family's username lock", () => {
  async function lockPipRunner() {
    for (let i = 0; i < 5; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.30.0.${i}` }));
    expect((await fail(signIn({ username: 'pip_runner', ip: '10.30.0.50' }))).code).toBe('resource-exhausted');
  }

  it("family 2 has a player whose display name is Pip_Runner: its Unlock leaves family 1's lock on pip_runner in place", async () => {
    await lockPipRunner();
    await player(FAM2, PARENT2, 'kid-twin', 'Pip_Runner', PIN_B); // a display name equal to family 1's username
    await unlockKidSignIn(deps(), PARENT2);
    expect((await fail(signIn({ username: 'pip_runner', ip: '10.30.0.51' }))).code).toBe('resource-exhausted');
  });

  it("the same family 2 player's PIN reset leaves it in place too", async () => {
    await lockPipRunner();
    await player(FAM2, PARENT2, 'kid-twin', 'Pip_Runner', PIN_B);
    await setKidPin(deps(), PARENT2, { kidId: 'kid-twin', pin: PIN });
    expect((await fail(signIn({ username: 'pip_runner', ip: '10.30.0.52' }))).code).toBe('resource-exhausted');
  });

  it("family 1's own Unlock still clears it", async () => {
    await lockPipRunner();
    await unlockKidSignIn(deps(), PARENT);
    expect(claimsOf(await signIn({ username: 'pip_runner', ip: '10.30.0.53' })).claims.kidId).toBe('kid-pip');
  });
});

describe('Unlock and a PIN reset with hundreds of device docs', () => {
  async function seedDevices(n: number) {
    for (let from = 0; from < n; from += 400) {
      const batch = db.batch();
      for (let i = from; i < Math.min(n, from + 400); i++) {
        const id = `bulkDevice-${String(i).padStart(6, '0')}-0123456789`;
        batch.set(db.doc(`families/${FAM}/devices/${id}`), { firstSeen: 1, lastSeen: 1, kids: ['kid-pip'], label: 'iPad Safari' });
        batch.set(db.doc(`pinIndex/_global/attempts/dev_${createHash('sha256').update(id).digest('hex').slice(0, 32)}`), { entries: [{ id: 'x', at: clock }], lockedUntil: 0, lockedBy: null, families: [FAM] });
      }
      await batch.commit();
    }
  }

  /** Production refuses a batch of more than 500 writes; the emulator does not, so the test counts deletes per batch. */
  function largestBatch() {
    const proto = Object.getPrototypeOf(db);
    const real = proto.batch;
    const sizes: number[] = [];
    const spy = vi.spyOn(proto, 'batch').mockImplementation(function (this: Firestore) {
      const batch = real.call(this);
      const idx = sizes.push(0) - 1;
      const del = batch.delete.bind(batch);
      batch.delete = (ref: never) => {
        sizes[idx] = (sizes[idx] ?? 0) + 1;
        return del(ref);
      };
      return batch;
    });
    return { sizes, restore: () => spy.mockRestore() };
  }

  it('unlockKidSignIn clears 600 device counters in batches of at most 500 writes', async () => {
    await seedDevices(600);
    expect((await counters('dev_')).length).toBe(600);
    const spy = largestBatch();
    try {
      await unlockKidSignIn(deps(), PARENT);
    } finally {
      spy.restore();
    }
    expect(Math.max(...spy.sizes)).toBeLessThanOrEqual(500);
    expect((await counters('dev_')).length).toBe(0);
  });

  it('setKidPin clears 600 device counters for that kid and still saves the new PIN', async () => {
    await seedDevices(600);
    const spy = largestBatch();
    try {
      await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: PIN_B });
    } finally {
      spy.restore();
    }
    expect(Math.max(...spy.sizes)).toBeLessThanOrEqual(500);
    expect((await counters('dev_')).length).toBe(0);
    expect(claimsOf(await signIn({ username: 'pip_runner', pin: PIN_B })).claims.kidId).toBe('kid-pip');
  });

  it('kidLockStatus reads 600 devices and reports a locked one', async () => {
    await seedDevices(600);
    const id = 'bulkDevice-000417-0123456789';
    await db.doc(`pinIndex/_global/attempts/dev_${createHash('sha256').update(id).digest('hex').slice(0, 32)}`).update({ lockedUntil: clock + MIN });
    expect((await kidLockStatus(deps(), PARENT)).locked).toBe(true);
  });
});

describe('pepper v2 hashes and the lazy migration from v1', () => {
  const v1 = (pin: string, salt: Buffer) => scryptSync(pin, salt, 32);
  const v2 = (pin: string, salt: Buffer) => scryptSync(createHmac('sha256', TEST_PEPPER).update(pin).digest(), salt, 32);
  const rowRef = () => db.doc(`pinIndex/${FAM}/kids/kid-pip`);

  /** Rewrites Pip's row as a v1 row: no `v`, scrypt(pin, salt). Digit PIN and a picture PIN. */
  async function makeV1() {
    const salt = randomBytes(16);
    const psalt = randomBytes(16);
    await rowRef().set({ nameKey: 'pip', salt: salt.toString('hex'), hash: v1(PIN, salt).toString('hex'), updatedAt: 1, pic: { salt: psalt.toString('hex'), hash: v1('abcd', psalt).toString('hex'), updatedAt: 1 } });
    return { salt, psalt };
  }

  it('setKidPin and setKidPicturePin write v2 rows keyed with the pepper', async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: 'efgh' });
    const row = (await rowRef().get()).data()!;
    expect(row.v).toBe(2);
    expect(row.hash).toBe(v2(PIN, Buffer.from(row.salt, 'hex')).toString('hex'));
    expect(row.pic.v).toBe(2);
    expect(row.pic.hash).toBe(v2('efgh', Buffer.from(row.pic.salt, 'hex')).toString('hex'));
  });

  it('a v2 row does not verify without the pepper: another pepper refuses the right passcode', async () => {
    const other: Deps = { ...deps(), pepper: 'a-different-pepper-0123456789' };
    expect((await fail(kidSignIn(other, { username: 'pip_runner', pin: PIN, ip: '10.8.0.1' }))).message).toBe(MISMATCH_MESSAGE);
  });

  it('a call without a pepper cannot hash: it refuses instead of writing an unkeyed hash', async () => {
    const none: Deps = { ...deps(), pepper: '' };
    expect((await fail(setKidPin(none, PARENT, { kidId: 'kid-pip', pin: PIN_B }))).code).toBe('internal');
    expect((await rowRef().get()).data()!.hash).toBe(v2(PIN, Buffer.from((await rowRef().get()).data()!.salt, 'hex')).toString('hex'));
  });

  it('a v1 row signs in with the right passcode and becomes v2 in the same call', async () => {
    const { salt } = await makeV1();
    expect(claimsOf(await signIn({ username: 'pip_runner' })).claims.kidId).toBe('kid-pip');
    const row = (await rowRef().get()).data()!;
    expect(row.v).toBe(2);
    expect(row.salt).not.toBe(salt.toString('hex'));
    expect(row.hash).toBe(v2(PIN, Buffer.from(row.salt, 'hex')).toString('hex'));
    // The picture half was not touched by a digit sign-in.
    expect(row.pic.v).toBeUndefined();
    // And the migrated row keeps working.
    expect(claimsOf(await signIn({ username: 'pip_runner', ip: '10.8.1.2' })).claims.kidId).toBe('kid-pip');
  });

  it('a wrong passcode never rewrites a v1 row', async () => {
    await makeV1();
    const before = (await rowRef().get()).data();
    for (let i = 0; i < 4; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.8.2.${i}` }));
    await fail(signIn({ name: 'Pip', pin: 'iiii', ip: '10.8.2.10' }));
    expect((await rowRef().get()).data()).toEqual(before);
  });

  it('a v1 picture passcode migrates its own half only', async () => {
    await makeV1();
    expect(claimsOf(await signIn({ username: 'pip_runner', pin: 'abcd' })).claims.kidId).toBe('kid-pip');
    const row = (await rowRef().get()).data()!;
    expect(row.pic.v).toBe(2);
    expect(row.pic.hash).toBe(v2('abcd', Buffer.from(row.pic.salt, 'hex')).toString('hex'));
    expect(row.v).toBeUndefined();
    expect(row.hash).toBe(v1(PIN, Buffer.from(row.salt, 'hex')).toString('hex'));
  });

  it('the legacy display-name path migrates a v1 row too', async () => {
    await makeV1();
    await signIn({ name: 'Pip' });
    expect((await rowRef().get()).data()!.v).toBe(2);
  });

  it('does not overwrite a PIN a parent reset between the check and the migration', async () => {
    await makeV1();
    // Sign-in verifies the v1 row, then (before the refund transaction) the parent sets a new PIN: the migration sees a different hash and skips.
    // The first transaction in a sign-in is reserve(), the second is refund(): the reset lands right before the second.
    const realRun = Object.getPrototypeOf(db).runTransaction;
    let n = 0;
    let reset = false;
    const spy = vi.spyOn(Object.getPrototypeOf(db), 'runTransaction').mockImplementation(async function (this: Firestore, fn: never, opts: never) {
      n += 1;
      if (n === 2 && !reset) {
        reset = true;
        await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: PIN_B });
      }
      return realRun.call(this, fn, opts);
    });
    try {
      await signIn({ username: 'pip_runner', ip: '10.8.3.1' });
    } finally {
      spy.mockRestore();
    }
    expect(reset).toBe(true);
    const row = (await rowRef().get()).data()!;
    expect(row.hash).toBe(v2(PIN_B, Buffer.from(row.salt, 'hex')).toString('hex'));
  });
});

describe('a parent PIN reset (#67) clears the username and device buckets', () => {
  it('clears the kid\'s username bucket and the buckets of the devices recorded for that kid, and keeps other kids\' device buckets', async () => {
    await player(FAM, PARENT, 'kid-leo', 'Leo', PIN, 'leo_l');
    await signIn({ username: 'pip_runner', deviceId: DEV_A, ip: '10.9.0.1' }); // DEV_A is recorded for Pip
    await signIn({ username: 'leo_l', deviceId: DEV_B, ip: '10.9.0.2' }); // DEV_B is recorded for Leo
    for (let i = 0; i < 5; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', deviceId: DEV_A, ip: `10.9.1.${i}` }));
    await fail(signIn({ username: 'leo_l', pin: '0000', deviceId: DEV_B, ip: '10.9.1.50' }));
    expect(await counters('user_')).toHaveLength(2);
    expect(await counters('dev_')).toHaveLength(2);
    expect((await fail(signIn({ username: 'pip_runner', deviceId: DEV_A, ip: '10.9.2.1' }))).code).toBe('resource-exhausted');

    await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: PIN_B });
    // Pip's username bucket and DEV_A's bucket are gone; Leo's username bucket and DEV_B's bucket stay.
    expect(await counters('user_')).toHaveLength(1);
    expect(await counters('dev_')).toHaveLength(1);
    expect((await counters('dev_'))[0]!.data().entries).toHaveLength(1);
    expect(claimsOf(await signIn({ username: 'pip_runner', pin: PIN_B, deviceId: DEV_A, ip: '10.9.2.2' })).claims.kidId).toBe('kid-pip');
  });

  it('a picture PIN reset clears them too', async () => {
    for (let i = 0; i < 5; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', ip: `10.9.3.${i}` }));
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: 'abcd' });
    expect(claimsOf(await signIn({ username: 'pip_runner', ip: '10.9.3.50' })).claims.kidId).toBe('kid-pip');
  });

  it('the portal Unlock clears username and device buckets and kidLockStatus names the player locked by username', async () => {
    await signIn({ username: 'pip_runner', deviceId: DEV_A, ip: '10.9.4.1' });
    for (let i = 0; i < 5; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', deviceId: DEV_A, ip: `10.9.4.${10 + i}` }));
    const s = await kidLockStatus(deps(), PARENT);
    expect(s.locked).toBe(true);
    expect(s.lockedPlayers).toEqual(['pip']);
    await unlockKidSignIn(deps(), PARENT);
    expect((await kidLockStatus(deps(), PARENT)).locked).toBe(false);
    expect(await counters('user_')).toHaveLength(0);
    expect(await counters('dev_')).toHaveLength(0);
  });

  it('Unlock in one family never clears another family\'s username bucket', async () => {
    await player(FAM2, PARENT2, 'kid-other', 'Otto', PIN_B, 'otto_o');
    for (let i = 0; i < 5; i++) await fail(signIn({ username: 'otto_o', pin: '0000', ip: `10.9.5.${i}` }));
    await unlockKidSignIn(deps(), PARENT);
    expect((await fail(signIn({ username: 'otto_o', pin: PIN_B, ip: '10.9.5.50' }))).code).toBe('resource-exhausted');
  });

  it('a kid doc that claims another family\'s username gives its parent no way to clear that lock', async () => {
    await player(FAM2, PARENT2, 'kid-other', 'Otto', PIN_B, 'otto_o');
    for (let i = 0; i < 5; i++) await fail(signIn({ username: 'otto_o', pin: '0000', ip: `10.9.6.${i}` }));
    // A parent can write any field on their own kid doc. The lock paths read the index, never this field.
    await db.doc(`families/${FAM}/kids/kid-pip`).update({ username: 'otto_o' });
    await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: PIN_B });
    await unlockKidSignIn(deps(), PARENT);
    expect((await fail(signIn({ username: 'otto_o', pin: PIN_B, ip: '10.9.6.50' }))).code).toBe('resource-exhausted');
  });
});

describe('device records', () => {
  it('writes families/{uid}/devices/{deviceId} on a good sign-in: firstSeen once, lastSeen and kids every time, label from the user agent', async () => {
    await signIn({ username: 'pip_runner', deviceId: DEV_A, userAgent: UA_IPAD, ip: '10.10.0.1' });
    const first = (await db.doc(`families/${FAM}/devices/${DEV_A}`).get()).data()!;
    expect(first).toEqual({ firstSeen: clock, lastSeen: clock, kids: ['kid-pip'], label: 'iPad Safari' });
    clock += 10 * MIN;
    await signIn({ username: 'pip_runner', deviceId: DEV_A, userAgent: 'something else', ip: '10.10.0.2' });
    await signIn({ name: 'Maya', pin: PIN_B, deviceId: DEV_A, ip: '10.10.0.3' });
    const next = (await db.doc(`families/${FAM}/devices/${DEV_A}`).get()).data()!;
    expect(next.firstSeen).toBe(first.firstSeen);
    expect(next.lastSeen).toBe(clock);
    expect([...next.kids].sort()).toEqual(['kid-maya', 'kid-pip']);
    expect(next.label).toBe('iPad Safari'); // set once: a grown-up's rename survives
  });

  it('writes nothing for a failed sign-in, a missing deviceId or a malformed one', async () => {
    await fail(signIn({ username: 'pip_runner', pin: '0000', deviceId: DEV_A, ip: '10.10.1.1' }));
    await signIn({ username: 'pip_runner', ip: '10.10.1.2' });
    await signIn({ username: 'pip_runner', deviceId: 'bad id!', ip: '10.10.1.3' });
    await signIn({ username: 'pip_runner', deviceId: 'x'.repeat(65), ip: '10.10.1.4' });
    expect((await db.collection(`families/${FAM}/devices`).get()).size).toBe(0);
  });

  it('labels a device by user-agent family, never the raw string', () => {
    expect(deviceLabel(UA_IPAD)).toBe('iPad Safari');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0')).toBe('Windows Edge');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')).toBe('Android Chrome');
    expect(deviceLabel('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36')).toBe('Chromebook Chrome');
    expect(deviceLabel(undefined)).toBe('Browser');
    expect(deviceLabel('curl/8.0')).toBe('Browser');
  });
});

describe('claimUsername', () => {
  it('writes the index entry and the kid doc username, lowercased', async () => {
    await claimUsername(deps(), FAM, 'kid-maya', 'Maya_77');
    expect((await db.doc('usernames/maya_77').get()).data()).toEqual({ familyUid: FAM, kidId: 'kid-maya', createdAt: clock });
    expect((await db.doc(`families/${FAM}/kids/kid-maya`).get()).data()!.username).toBe('maya_77');
  });

  it('refuses a bad shape: under 3, over 20, spaces, dashes, accents, not a string', async () => {
    for (const bad of ['ab', 'a'.repeat(21), 'has space', 'dash-ed', 'émile', '', '   ', 7, null]) {
      expect((await fail(claimUsername(deps(), FAM, 'kid-maya', bad))).message, String(bad)).toBe(USERNAME_INVALID_MESSAGE);
    }
    expect((await db.collection('usernames').get()).docs.map((x) => x.id)).toEqual(['pip_runner']);
    await claimUsername(deps(), FAM, 'kid-maya', 'abc');
    await claimUsername(deps(), FAM, 'kid-maya', 'a'.repeat(20));
  });

  it('refuses reserved and offensive names, including digit look-alikes and underscores', async () => {
    for (const bad of ['admin', 'Teacher', 'grownup', 'parent', 'mathquest', 'admin_01', 'teacher7', 'xmathquestx', 'f_u_c_k', 'sh1t', 'b1tch99']) {
      expect((await fail(claimUsername(deps(), FAM, 'kid-maya', bad))).message, bad).toBe(USERNAME_RESERVED_MESSAGE);
    }
    expect(reservedReason('pip_runner')).toBeNull();
    expect(reservedReason('moon_cat_42')).toBeNull();
    expect(reservedReason('admin')).toBe('impersonation');
  });

  it('refuses a name another kid owns, in the same family or another, and treats a claim whose kid is gone as free', async () => {
    await player(FAM2, PARENT2, 'kid-other', 'Otto', PIN_B);
    expect((await fail(claimUsername(deps(), FAM2, 'kid-other', 'PIP_runner'))).message).toBe(USERNAME_TAKEN_MESSAGE);
    expect((await fail(claimUsername(deps(), FAM, 'kid-maya', 'pip_runner'))).code).toBe('already-exists');
    await db.doc(`families/${FAM}/kids/kid-pip`).delete();
    await claimUsername(deps(), FAM2, 'kid-other', 'pip_runner');
    expect((await db.doc('usernames/pip_runner').get()).data()).toMatchObject({ familyUid: FAM2, kidId: 'kid-other' });
  });

  it('is idempotent for the owner and releases the old name when a kid takes a new one', async () => {
    await claimUsername(deps(), FAM, 'kid-pip', 'pip_runner');
    expect((await db.doc('usernames/pip_runner').get()).data()!.createdAt).toBe(clock);
    await claimUsername(deps(), FAM, 'kid-pip', 'pip_two');
    expect((await db.doc('usernames/pip_runner').get()).exists).toBe(false);
    expect((await db.doc('usernames/pip_two').get()).exists).toBe(true);
    await claimUsername(deps(), FAM, 'kid-maya', 'pip_runner'); // free again
  });

  it('refuses a kid that does not exist', async () => {
    expect((await fail(claimUsername(deps(), FAM, 'kid-ghost', 'ghosty'))).code).toBe('not-found');
  });

  it('two kids claiming one name at once: exactly one wins', async () => {
    const results = await Promise.allSettled([claimUsername(deps(), FAM, 'kid-maya', 'race_me'), claimUsername(deps(), FAM, 'kid-pip', 'race_me')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const owner = (await db.doc('usernames/race_me').get()).data()!.kidId;
    expect(['kid-maya', 'kid-pip']).toContain(owner);
  });
});

describe('MAX_PARENTS comes from config/app.maxParents', () => {
  const g = (n: number): AuthContext => ({ uid: `uid-cap-${n}`, email: `cap${n}@example.com`, emailVerified: true, provider: 'google.com' });

  it('defaults to 20 with no config', async () => {
    expect(MAX_PARENTS).toBe(20);
    await db.doc('meta/parentCount').set({ count: 19 });
    await registerParent(deps(), g(1));
    expect((await fail(registerParent(deps(), g(2)))).code).toBe('resource-exhausted');
  });

  it('reads the cap from config/app.maxParents', async () => {
    await db.doc('config/app').set({ minVersion: 1, maxParents: 25 });
    await db.doc('meta/parentCount').set({ count: 24 });
    await registerParent(deps(), g(1));
    expect((await fail(registerParent(deps(), g(2)))).code).toBe('resource-exhausted');
    expect((await db.doc('meta/parentCount').get()).data()!.count).toBe(25);
  });

  it('ignores a bad value and falls back to 20', async () => {
    await db.doc('meta/parentCount').set({ count: 20 });
    for (const bad of ['500', 0, -3, 2.5, null]) {
      await db.doc('config/app').set({ maxParents: bad });
      expect((await fail(registerParent(deps(), g(9)))).code, String(bad)).toBe('resource-exhausted');
    }
  });
});
