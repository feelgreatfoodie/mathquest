import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LIMITS,
  LOCKED_MESSAGE,
  MISMATCH_MESSAGE,
  NAME_TAKEN_MESSAGE,
  kidLockStatus,
  kidSignIn,
  parentPinHash,
  setKidPicturePin,
  setKidPin,
  unlockKidSignIn,
  type AuthContext,
  type Deps,
} from '../src/core.js';

// All names, ids, addresses and PINs below are made up for the tests.
const FAM = 'fam-uid-1';
const FAM2 = 'fam-uid-2';
const PARENT: AuthContext = { uid: FAM, email: 'parent-one@example.com', emailVerified: true, provider: 'google.com' };
const PARENT2: AuthContext = { uid: FAM2, email: 'parent-two@example.com', emailVerified: true, provider: 'google.com' };
const PARENT_PIN = '4821';
const PIN = '7305';
const PIN_B = '2946';

let db: Firestore;
let clock = 1_700_000_000_000;

function deps(): Deps {
  return {
    db,
    now: () => clock,
    auth: {
      createCustomToken: async (uid, claims) => JSON.stringify({ uid, claims }),
    },
  };
}

async function seedKid(fam: string, id: string, name: string) {
  await db.doc(`families/${fam}/kids/${id}`).set({ id, name, createdAt: 1, settings: {}, game: {} });
}

async function clearAll() {
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'nameKeys']) {
    await db.recursiveDelete(db.collection(col));
  }
}

const signIn = (name: string, pin: string, ip = '10.0.0.1') => kidSignIn(deps(), { name, pin, ip });
const claimsOf = (r: { token: string }) => JSON.parse(r.token) as { uid: string; claims: Record<string, string> };

async function fail(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { code: string; message: string };
  }
  throw new Error('expected a failure');
}

beforeAll(() => {
  if (!getApps().length) initializeApp({ projectId: 'demo-mathquest' });
  db = getFirestore();
});

beforeEach(async () => {
  await clearAll();
  clock = 1_700_000_000_000;
  await db.doc(`parents/${FAM}`).set({ email: 'parent-one@example.com', createdAt: 1 });
  await db.doc(`parents/${FAM2}`).set({ email: 'parent-two@example.com', createdAt: 1 });
  await db.doc('meta/parentCount').set({ count: 2 });
  await db.doc(`families/${FAM}`).set({ pinHash: parentPinHash(FAM, PARENT_PIN), createdAt: 1 });
  await seedKid(FAM, 'kid-pip', 'Pip');
  await seedKid(FAM, 'kid-maya', 'Maya');
  await seedKid(FAM, 'kid-leo', 'Leo');
  await seedKid(FAM, 'kid-zed', 'Zed');
  await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: PIN });
  await setKidPin(deps(), PARENT, { kidId: 'kid-maya', pin: PIN_B });
  await setKidPin(deps(), PARENT, { kidId: 'kid-leo', pin: PIN });
  await setKidPin(deps(), PARENT, { kidId: 'kid-zed', pin: PIN });
});

describe('kidSignIn: name and PIN', () => {
  it.each(['Pip', 'pip', ' PIP '])('signs in as %j with the right claims', async (name) => {
    const t = claimsOf(await signIn(name, PIN));
    expect(t.uid).toBe('kid_kid-pip');
    expect(t.claims).toEqual({ role: 'kid', familyUid: FAM, kidId: 'kid-pip' });
  });

  it('treats composed and decomposed accents as one name', async () => {
    await seedKid(FAM, 'kid-rene', 'Renée');
    await setKidPin(deps(), PARENT, { kidId: 'kid-rene', pin: PIN_B });
    expect(claimsOf(await signIn('Renée', PIN_B)).claims.kidId).toBe('kid-rene');
  });

  it('lets two kids share a PIN, because the name tells them apart', async () => {
    expect(claimsOf(await signIn('leo', PIN)).claims.kidId).toBe('kid-leo');
    expect(claimsOf(await signIn('pip', PIN)).claims.kidId).toBe('kid-pip');
  });

  it('returns the same error for a wrong PIN and an unknown name', async () => {
    const wrong = await fail(signIn('Pip', '0000', '10.0.0.2'));
    const unknown = await fail(signIn('Nobody', PIN, '10.0.0.3'));
    expect(wrong.code).toBe('permission-denied');
    expect(wrong.message).toBe(MISMATCH_MESSAGE);
    expect(unknown.code).toBe(wrong.code);
    expect(unknown.message).toBe(wrong.message);
  });

  it("rejects a PIN that isn't 4 digits, and a missing name", async () => {
    expect((await fail(signIn('Pip', '12'))).code).toBe('invalid-argument');
    expect((await fail(signIn('', PIN))).code).toBe('invalid-argument');
    expect((await fail(kidSignIn(deps(), { name: 5, pin: PIN, ip: '1.1.1.1' }))).code).toBe('invalid-argument');
  });

  it('refuses a kid whose doc was deleted', async () => {
    await db.doc(`families/${FAM}/kids/kid-pip`).delete();
    expect((await fail(signIn('Pip', PIN))).message).toBe(MISMATCH_MESSAGE);
  });

  it('refuses a family that is not in the parents registry', async () => {
    await db.doc(`parents/${FAM}`).delete();
    expect((await fail(signIn('Pip', PIN))).message).toBe(MISMATCH_MESSAGE);
  });

  it('finds a kid in any registered family, not only the first', async () => {
    await seedKid(FAM2, 'kid-other', 'Otto');
    await setKidPin(deps(), PARENT2, { kidId: 'kid-other', pin: PIN_B });
    const t = claimsOf(await signIn('otto', PIN_B));
    expect(t.claims).toEqual({ role: 'kid', familyUid: FAM2, kidId: 'kid-other' });
  });

  it('logs a registry lookup failure instead of hiding it (11-17: a swallowed permission error hid the cause)', async () => {
    const errors: unknown[][] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    const d = deps();
    const realDb = d.db;
    d.db = new Proxy(realDb, {
      get(target, prop, recv) {
        if (prop === 'doc') {
          return (path: string) => {
            if (path.startsWith('parents/')) {
              return { get: async () => { throw new Error('PERMISSION_DENIED: datastore.entities.get'); } };
            }
            return target.doc(path);
          };
        }
        const v = Reflect.get(target, prop, recv);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    try {
      expect((await fail(kidSignIn(d, { name: 'Pip', pin: PIN, ip: '10.0.0.9' }))).message).toBe(MISMATCH_MESSAGE);
    } finally {
      console.error = orig;
    }
    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0][0])).toContain('familyRegistered');
    expect(JSON.stringify(errors[0][1])).toContain('PERMISSION_DENIED');
  });
});

describe('setKidPin', () => {
  it('rejects callers who are not registered parents', async () => {
    const d = deps();
    expect((await fail(setKidPin(d, undefined, { kidId: 'kid-zed', pin: PIN }))).code).toBe('unauthenticated');
    expect((await fail(setKidPin(d, { ...PARENT, emailVerified: false }, { kidId: 'kid-zed', pin: PIN }))).code).toBe('permission-denied');
    expect((await fail(setKidPin(d, { uid: 'unregistered-uid', email: 'stranger@example.com', emailVerified: true }, { kidId: 'kid-zed', pin: PIN }))).code).toBe('permission-denied');
    // A kid's own token has no email, so it cannot set PINs either.
    expect((await fail(setKidPin(d, { uid: 'kid_kid-zed' }, { kidId: 'kid-zed', pin: PIN }))).code).toBe('permission-denied');
  });

  it('rejects the parent PIN and bad PIN shapes', async () => {
    const d = deps();
    const e = await fail(setKidPin(d, PARENT, { kidId: 'kid-zed', pin: PARENT_PIN }));
    expect(e.code).toBe('invalid-argument');
    expect(e.message).toMatch(/parent PIN/);
    expect((await fail(setKidPin(d, PARENT, { kidId: 'kid-zed', pin: '12345' }))).code).toBe('invalid-argument');
    expect((await fail(setKidPin(d, PARENT, { kidId: 'kid-zed', pin: 'abcd' }))).code).toBe('invalid-argument');
    expect((await fail(setKidPin(d, PARENT, { kidId: '../x', pin: PIN }))).code).toBe('invalid-argument');
  });

  it('refuses a kid in another family', async () => {
    expect((await fail(setKidPin(deps(), PARENT2, { kidId: 'kid-zed', pin: PIN }))).code).toBe('not-found');
  });

  it('refuses a duplicate name inside the family, in any capitalization', async () => {
    await seedKid(FAM, 'kid-pip2', ' PIP');
    expect((await fail(setKidPin(deps(), PARENT, { kidId: 'kid-pip2', pin: PIN_B }))).code).toBe('already-exists');
  });

  it('refuses a name another family already uses, with the last-initial hint', async () => {
    await seedKid(FAM2, 'other-pip', 'pip');
    const e = await fail(setKidPin(deps(), PARENT2, { kidId: 'other-pip', pin: PIN_B }));
    expect(e.code).toBe('already-exists');
    expect(e.message).toBe(NAME_TAKEN_MESSAGE);
  });

  it('stores a hash and salt server-side, and only hasPin on the kid doc', async () => {
    const row = (await db.doc(`pinIndex/${FAM}/kids/kid-pip`).get()).data()!;
    expect(row.nameKey).toBe('pip');
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain(PIN);
    const kid = (await db.doc(`families/${FAM}/kids/kid-pip`).get()).data()!;
    expect(kid.hasPin).toBe(true);
    expect(JSON.stringify(kid)).not.toContain(row.hash);
    expect(JSON.stringify(kid)).not.toContain(row.salt);
  });

  it('uses a different salt for each kid, so equal PINs hash differently', async () => {
    const a = (await db.doc(`pinIndex/${FAM}/kids/kid-pip`).get()).data()!;
    const b = (await db.doc(`pinIndex/${FAM}/kids/kid-leo`).get()).data()!;
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('replaces the old PIN when a parent sets a new one', async () => {
    await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: PIN_B });
    expect((await fail(signIn('pip', PIN, '10.1.1.1'))).message).toBe(MISMATCH_MESSAGE);
    expect(claimsOf(await signIn('pip', PIN_B, '10.1.1.2')).claims.kidId).toBe('kid-pip');
  });
});

describe('brute-force limits', () => {
  const wrong = (name: string, ip: string) => fail(signIn(name, '0000', ip));

  it('refuses the 6th failure from one IP, even with the right PIN', async () => {
    for (let i = 0; i < LIMITS.ip.max; i++) expect((await wrong('Pip', '9.9.9.9')).code).toBe('permission-denied');
    const e = await fail(signIn('Pip', PIN, '9.9.9.9'));
    expect(e.code).toBe('resource-exhausted');
    expect(e.message).toBe(LOCKED_MESSAGE);
    // The 6th is refused for a different name from that IP too, and a clean IP still works.
    expect((await fail(signIn('Maya', PIN_B, '9.9.9.9'))).code).toBe('resource-exhausted');
    expect(claimsOf(await signIn('Pip', PIN, '9.9.9.10')).claims.kidId).toBe('kid-pip');
  });

  it('lets the IP back in after 15 minutes', async () => {
    for (let i = 0; i < LIMITS.ip.max; i++) await wrong('Pip', '9.9.9.9');
    expect((await fail(signIn('Pip', PIN, '9.9.9.9'))).code).toBe('resource-exhausted');
    clock += 15 * 60_000 + 1;
    expect(claimsOf(await signIn('Pip', PIN, '9.9.9.9')).claims.kidId).toBe('kid-pip');
  });

  it('counts unknown names against the IP too', async () => {
    for (let i = 0; i < LIMITS.ip.max; i++) await wrong(`Ghost${i}`, '8.8.8.8');
    expect((await fail(signIn('Pip', PIN, '8.8.8.8'))).code).toBe('resource-exhausted');
  });

  it('locks a name after 10 failures from different IPs for an hour', async () => {
    for (let i = 0; i < LIMITS.name.max; i++) await wrong('Pip', `7.7.7.${i}`);
    expect((await fail(signIn('pip', PIN, '7.7.7.200'))).code).toBe('resource-exhausted');
    // Another kid is not affected by that name lock.
    expect(claimsOf(await signIn('Maya', PIN_B, '7.7.7.201')).claims.kidId).toBe('kid-maya');
    clock += 60 * 60_000 + 1;
    expect(claimsOf(await signIn('pip', PIN, '7.7.7.200')).claims.kidId).toBe('kid-pip');
  });

  it('locks a name that does not exist exactly like one that does', async () => {
    for (let i = 0; i < LIMITS.name.max; i++) await wrong('Ghost', `6.6.6.${i}`);
    const e = await fail(signIn('Ghost', PIN, '6.6.6.200'));
    expect(e.code).toBe('resource-exhausted');
    expect(e.message).toBe(LOCKED_MESSAGE);
  });

  it('locks the family after 20 failures, so the 21st is refused even with a right PIN', async () => {
    // 7 + 7 + 6 failures across three names and 20 different IPs: no IP or name limit is reached.
    const names = ['Pip', 'Maya', 'Leo'];
    let n = 0;
    for (const [i, name] of names.entries()) {
      for (let j = 0; j < (i === 2 ? 6 : 7); j++) expect((await wrong(name, `5.5.5.${n++}`)).code).toBe('permission-denied');
    }
    expect(n).toBe(LIMITS.family.max);
    const e = await fail(signIn('Zed', PIN, '5.5.5.250'));
    expect(e.code).toBe('resource-exhausted');
    expect(e.message).toBe(LOCKED_MESSAGE);
    const row = (await db.doc(`pinIndex/${FAM}/attempts/family`).get()).data()!;
    expect(row.entries).toHaveLength(LIMITS.family.max);
    expect(row.lockedUntil).toBeGreaterThan(clock);
  });

  it('does not reset the counters on a success', async () => {
    for (let i = 0; i < 4; i++) await wrong('Pip', '4.4.4.4');
    expect(claimsOf(await signIn('Pip', PIN, '4.4.4.4')).claims.kidId).toBe('kid-pip');
    expect((await wrong('Pip', '4.4.4.4')).code).toBe('permission-denied'); // the 5th failure
    expect((await fail(signIn('Pip', PIN, '4.4.4.4'))).code).toBe('resource-exhausted');
  });

  it('counts parallel guesses, so a burst cannot skip the limit', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => signIn('Pip', '0000', '3.3.3.3')));
    const codes = results.map((r) => (r.status === 'rejected' ? (r.reason as { code: string }).code : 'ok'));
    expect(codes.filter((c) => c === 'permission-denied')).toHaveLength(LIMITS.ip.max);
    expect(codes.filter((c) => c === 'resource-exhausted')).toHaveLength(8 - LIMITS.ip.max);
  });
});

describe('parent lock status and unlock', () => {
  async function lockFamily() {
    const names = ['Pip', 'Maya', 'Leo'];
    let n = 0;
    for (const [i, name] of names.entries()) {
      for (let j = 0; j < (i === 2 ? 6 : 7); j++) await fail(signIn(name, '0000', `2.2.2.${n++}`));
    }
  }

  it('shows the lock and the failure count to the parent', async () => {
    await lockFamily();
    const s = await kidLockStatus(deps(), PARENT);
    expect(s.locked).toBe(true);
    expect(s.failures).toBe(20);
  });

  it('clears the lock when the parent unlocks', async () => {
    await lockFamily();
    expect((await fail(signIn('Zed', PIN, '2.2.2.250'))).code).toBe('resource-exhausted');
    await unlockKidSignIn(deps(), PARENT);
    expect(claimsOf(await signIn('Zed', PIN, '2.2.2.250')).claims.kidId).toBe('kid-zed');
    const s = await kidLockStatus(deps(), PARENT);
    expect(s.locked).toBe(false);
    expect(s.failures).toBe(0);
  });

  it('clears an IP lock and a name lock on unlock', async () => {
    for (let i = 0; i < LIMITS.ip.max; i++) await fail(signIn('Pip', '0000', '1.2.3.4'));
    expect((await kidLockStatus(deps(), PARENT)).locked).toBe(true);
    await unlockKidSignIn(deps(), PARENT);
    expect(claimsOf(await signIn('Pip', PIN, '1.2.3.4')).claims.kidId).toBe('kid-pip');
  });

  it('refuses status and unlock for anyone who is not a parent', async () => {
    expect((await fail(unlockKidSignIn(deps(), undefined))).code).toBe('unauthenticated');
    expect((await fail(unlockKidSignIn(deps(), { uid: 'kid_kid-zed' }))).code).toBe('permission-denied');
    expect((await fail(kidLockStatus(deps(), { uid: 'unregistered-uid', email: 'stranger@example.com', emailVerified: true }))).code).toBe('permission-denied');
  });

  it("does not let one family's unlock clear another family's lock", async () => {
    await lockFamily();
    await unlockKidSignIn(deps(), PARENT2);
    expect((await fail(signIn('Zed', PIN, '2.2.2.251'))).code).toBe('resource-exhausted');
  });
});

describe('a parent PIN reset clears the kid sign-in lock', () => {
  const NEW_PIN = '1357';
  const IP = '3.3.3.3';
  const lockByName = async (name: string, ip: string) => {
    for (let i = 0; i < LIMITS.ip.max; i++) await fail(signIn(name, '0000', ip));
  };

  it('lets the kid in with the new PIN after an IP lock, clearing the name, family and ip counters', async () => {
    await lockByName('Pip', IP);
    expect((await fail(signIn('Pip', PIN, IP))).code).toBe('resource-exhausted');
    await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: NEW_PIN }, IP);
    expect(claimsOf(await signIn('Pip', NEW_PIN, IP)).claims.kidId).toBe('kid-pip');
    const s = await kidLockStatus(deps(), PARENT);
    expect(s.locked).toBe(false);
    expect(s.failures).toBe(0);
    expect(s.lockedPlayers).toEqual([]);
  });

  it('clears a name lock reached from many addresses', async () => {
    for (let i = 0; i < LIMITS.name.max; i++) await fail(signIn('Pip', '0000', `4.4.4.${i}`));
    expect((await fail(signIn('Pip', PIN, '4.4.4.200'))).code).toBe('resource-exhausted');
    expect((await kidLockStatus(deps(), PARENT)).lockedPlayers).toEqual(['pip']);
    await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: NEW_PIN }, '4.4.4.201');
    expect(claimsOf(await signIn('Pip', NEW_PIN, '4.4.4.200')).claims.kidId).toBe('kid-pip');
  });

  it('clears a family lock', async () => {
    let n = 0;
    for (const name of ['Pip', 'Maya', 'Leo']) for (let j = 0; j < 7; j++) await fail(signIn(name, '0000', `5.5.5.${n++}`));
    expect((await kidLockStatus(deps(), PARENT)).locked).toBe(true);
    await setKidPin(deps(), PARENT, { kidId: 'kid-zed', pin: NEW_PIN }, '5.5.5.250');
    expect(claimsOf(await signIn('Zed', NEW_PIN, '5.5.5.250')).claims.kidId).toBe('kid-zed');
  });

  it('clears the locks when the parent sets a picture PIN too', async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: 'abcd' }, IP);
    await lockByName('Pip', IP);
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: 'efgh' }, IP);
    expect(claimsOf(await signIn('Pip', 'efgh', IP)).claims.kidId).toBe('kid-pip');
  });

  it('works without a caller address: the name and family counters still clear', async () => {
    for (let i = 0; i < LIMITS.name.max; i++) await fail(signIn('Pip', '0000', `6.6.6.${i}`));
    await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: NEW_PIN });
    expect(claimsOf(await signIn('Pip', NEW_PIN, '6.6.6.250')).claims.kidId).toBe('kid-pip');
  });

  it("keeps another family's kid locked", async () => {
    await seedKid(FAM2, 'kid-other', 'Otto');
    await setKidPin(deps(), PARENT2, { kidId: 'kid-other', pin: PIN_B });
    for (let i = 0; i < LIMITS.name.max; i++) await fail(signIn('Otto', '0000', `7.7.7.${i}`));
    await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: NEW_PIN }, '8.8.8.8');
    expect((await fail(signIn('Otto', PIN_B, '7.7.7.8'))).code).toBe('resource-exhausted');
  });

  it('keeps an ip lock that has counted another family, so a reset cannot wipe the ip limit while guessing at other kids', async () => {
    await seedKid(FAM2, 'kid-other', 'Otto');
    await setKidPin(deps(), PARENT2, { kidId: 'kid-other', pin: PIN_B });
    await lockByName('Otto', '9.9.9.9');
    await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: NEW_PIN }, '9.9.9.9');
    expect((await fail(signIn('Pip', NEW_PIN, '9.9.9.9'))).code).toBe('resource-exhausted');
  });

  it('does not clear anything when the call is refused', async () => {
    await lockByName('Pip', IP);
    await fail(setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: 'abcd' }, IP));
    await fail(setKidPin(deps(), PARENT2, { kidId: 'kid-pip', pin: NEW_PIN }, IP));
    expect((await fail(signIn('Pip', PIN, IP))).code).toBe('resource-exhausted');
  });

  it('tells the kid to ask a grown-up to tap Unlock', () => {
    expect(LOCKED_MESSAGE).toBe('Too many wrong tries. Ask a grown-up to open Grown-ups and tap Unlock.');
  });
});
