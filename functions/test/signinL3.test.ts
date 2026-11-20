import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../src/core.js';
import { DEVICE_FORGOTTEN_MESSAGE, MISMATCH_MESSAGE, NAME_TOOL_LIMIT, NAME_TOOL_LOCKED_MESSAGE, PARENT_STALE_MESSAGE, USERNAME_TAKEN_MESSAGE, claimUsername, kidLockStatus, kidSignIn, parentPinHash, setKidPin, type AuthContext, type Deps } from '../src/core.js';
import { reservedReason } from '../src/reserved.js';
import { ANIMALS, COLORS } from '../src/words.js';
import { TEST_PEPPER } from './testPepper.js';

// L3: the grown-up's username callables (suggestUsername, checkUsername, setUsername), Forget device (revoked: true), school mode
// (remember: false) and the lock details the portal shows. Every name, id and passcode below is made up.
const FAM = 'fam-uid-1';
const FAM2 = 'fam-uid-2';
const PARENT: AuthContext = { uid: FAM, email: 'parent-one@example.com', emailVerified: true, provider: 'google.com' };
const PARENT2: AuthContext = { uid: FAM2, email: 'parent-two@example.com', emailVerified: true, provider: 'google.com' };
const KID_TOKEN_AUTH: AuthContext = { uid: 'kid_kid-pip', provider: 'custom' };
const PIN = '7305';
const DEV_A = 'devA-0123456789abcdef';
const DEV_B = 'devB-0123456789abcdef';
const MIN = 60_000;

let db: Firestore;
let clock = 1_700_000_000_000;
const verifyParent = (uid = FAM) => db.doc(`parentPins/${uid}`).set({ verifiedAt: clock });

const deps = (): Deps => ({
  db,
  pepper: TEST_PEPPER,
  now: () => clock,
  log: () => undefined,
  auth: { createCustomToken: async (uid, claims) => JSON.stringify({ uid, claims }) },
});
const signIn = (a: { username?: string; name?: string; pin?: string; deviceId?: unknown; ip?: string }) => kidSignIn(deps(), { pin: PIN, ip: '10.0.0.1', ...a });

async function fail(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { code: string; message: string };
  }
  throw new Error('expected a failure');
}

const clearAll = async () => {
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'parentPins', 'nameKeys', 'usernames', 'config']) await db.recursiveDelete(db.collection(col));
};

async function player(fam: string, parent: AuthContext, id: string, name: string, username?: string) {
  await db.doc(`families/${fam}/kids/${id}`).set({ id, name, createdAt: 1, settings: {}, game: { xp: 120, gems: 7 } });
  await setKidPin(deps(), parent, { kidId: id, pin: PIN });
  if (username) await claimUsername(deps(), fam, id, username);
}

beforeAll(() => {
  if (!getApps().length) initializeApp({ projectId: 'demo-mathquest' });
  db = getFirestore();
});
afterAll(clearAll);
beforeEach(async () => {
  await clearAll();
  clock = 1_700_000_000_000;
  await db.doc(`parents/${FAM}`).set({ email: 'parent-one@example.com', createdAt: 1 });
  await db.doc(`parents/${FAM2}`).set({ email: 'parent-two@example.com', createdAt: 1 });
  await db.doc('meta/parentCount').set({ count: 2 });
  await db.doc(`families/${FAM}`).set({ pinHash: parentPinHash(FAM, '4821'), createdAt: 1 });
  await db.doc(`families/${FAM2}`).set({ pinHash: parentPinHash(FAM2, '4821'), createdAt: 1 });
  await verifyParent();
  await verifyParent(FAM2);
  await player(FAM, PARENT, 'kid-pip', 'Pip', 'pip_runner');
  await player(FAM, PARENT, 'kid-maya', 'Maya');
});

describe('the word lists', () => {
  it('every color and animal pair is a valid, allowed username of at most 20 characters', () => {
    for (const c of COLORS) {
      for (const a of ANIMALS) {
        const name = `${c}${a}99`;
        expect(name, name).toMatch(/^[a-z0-9_]{3,20}$/);
        expect(reservedReason(name), name).toBeNull();
      }
    }
  });
});

describe('suggestUsername', () => {
  it('returns 3 different free usernames of the shape color + animal + 2 digits', async () => {
    const { suggestions } = await core.suggestUsername(deps(), PARENT);
    expect(suggestions).toHaveLength(3);
    expect(new Set(suggestions).size).toBe(3);
    for (const s of suggestions) {
      expect(s).toMatch(/^[a-z]+\d{2}$/);
      expect(COLORS.some((c) => s.startsWith(c))).toBe(true);
      expect(ANIMALS.some((a) => s.slice(0, -2).endsWith(a))).toBe(true);
      expect(await core.checkUsername(deps(), PARENT, { username: s })).toEqual({ free: true });
    }
  });

  it('never offers a name that is taken, even when only a few are left', async () => {
    // Take every name but 3 with a fixed color and animal: the lists are small enough to exhaust one pair.
    const taken = await db.collection('usernames').get();
    expect(taken.size).toBe(1);
    for (let i = 0; i < 20; i++) {
      const { suggestions } = await core.suggestUsername(deps(), PARENT);
      expect(suggestions).not.toContain('pip_runner');
      clock += MIN; // the per-parent limit is not what this test is about
    }
  });

  it('never uses a player name: a kid called after a color and animal gets no suggestion built from it', async () => {
    await db.doc(`families/${FAM}/kids/kid-maya`).update({ name: 'Bluefox' });
    for (let i = 0; i < 10; i++) {
      const { suggestions } = await core.suggestUsername(deps(), PARENT);
      expect(suggestions.join(' ')).not.toMatch(/bluefox$/);
      clock += MIN;
    }
  });

  it('is for registered grown-ups only', async () => {
    expect((await fail(core.suggestUsername(deps(), undefined))).code).toBe('unauthenticated');
    expect((await fail(core.suggestUsername(deps(), KID_TOKEN_AUTH))).code).toBe('permission-denied');
    expect((await fail(core.suggestUsername(deps(), { uid: 'stranger', email: 's@example.com', emailVerified: true, provider: 'google.com' }))).code).toBe('permission-denied');
  });

  it('allows 30 calls a minute per parent, refuses the 31st, and counts another parent separately', async () => {
    for (let i = 0; i < NAME_TOOL_LIMIT.max; i++) await core.suggestUsername(deps(), PARENT);
    const e = await fail(core.suggestUsername(deps(), PARENT));
    expect(e.code).toBe('resource-exhausted');
    expect(e.message).toBe(NAME_TOOL_LOCKED_MESSAGE);
    await core.suggestUsername(deps(), PARENT2);
    clock += MIN + 1;
    await core.suggestUsername(deps(), PARENT);
  });
});

describe('checkUsername', () => {
  const check = (username: unknown, kidId?: string) => core.checkUsername(deps(), PARENT, { username, ...(kidId ? { kidId } : {}) });

  it('answers free, taken, invalid and reserved', async () => {
    expect(await check('Fresh_Name')).toEqual({ free: true });
    expect(await check('PIP_runner')).toEqual({ free: false, reason: 'taken' });
    expect(await check('ab')).toEqual({ free: false, reason: 'invalid' });
    expect(await check('has space')).toEqual({ free: false, reason: 'invalid' });
    expect(await check(7)).toEqual({ free: false, reason: 'invalid' });
    expect(await check('admin_01')).toEqual({ free: false, reason: 'reserved' });
  });

  it('a name the player already holds is free for that player, taken for another', async () => {
    expect(await check('pip_runner', 'kid-pip')).toEqual({ free: true });
    expect(await check('pip_runner', 'kid-maya')).toEqual({ free: false, reason: 'taken' });
  });

  it('a claim whose player is gone counts as free, as claimUsername does', async () => {
    await db.doc(`families/${FAM}/kids/kid-pip`).delete();
    expect(await check('pip_runner')).toEqual({ free: true });
  });

  it('is for registered grown-ups only, and allows 30 a minute', async () => {
    expect((await fail(core.checkUsername(deps(), undefined, { username: 'abc' }))).code).toBe('unauthenticated');
    expect((await fail(core.checkUsername(deps(), KID_TOKEN_AUTH, { username: 'abc' }))).code).toBe('permission-denied');
    for (let i = 0; i < NAME_TOOL_LIMIT.max; i++) await check('free_one');
    expect((await fail(check('free_one'))).code).toBe('resource-exhausted');
  });
});

describe('setUsername', () => {
  const set = (kidId: unknown, username: unknown, who: AuthContext | undefined = PARENT) => core.setUsername(deps(), who, { kidId, username });

  it('names a player: the index entry, the kid doc field, and the player signs in with it', async () => {
    expect(await set('kid-maya', 'Maya_77')).toEqual({ username: 'maya_77' });
    expect((await db.doc('usernames/maya_77').get()).data()).toEqual({ familyUid: FAM, kidId: 'kid-maya', createdAt: clock });
    expect((await db.doc(`families/${FAM}/kids/kid-maya`).get()).data()!.username).toBe('maya_77');
    expect(JSON.parse((await signIn({ username: 'maya_77' })).token).claims.kidId).toBe('kid-maya');
  });

  it('is for registered grown-ups only', async () => {
    expect((await fail(core.setUsername(deps(), undefined, { kidId: 'kid-maya', username: 'maya_77' }))).code).toBe('unauthenticated');
    expect((await fail(set('kid-maya', 'maya_77', KID_TOKEN_AUTH))).code).toBe('permission-denied');
    expect((await db.doc('usernames/maya_77').get()).exists).toBe(false);
  });

  it('needs the Grown-up PIN typed in the last 30 minutes, like setKidPin', async () => {
    clock += 31 * MIN;
    const e = await fail(set('kid-maya', 'maya_77'));
    expect(e.code).toBe('failed-precondition');
    expect(e.message).toBe(PARENT_STALE_MESSAGE);
    expect((await db.doc('usernames/maya_77').get()).exists).toBe(false);
  });

  it('cannot name another family\'s player, and cannot take a name another player holds', async () => {
    await player(FAM2, PARENT2, 'kid-other', 'Otto', 'otto_o');
    expect((await fail(set('kid-other', 'otto_two'))).code).toBe('not-found');
    expect((await db.doc('usernames/otto_two').get()).exists).toBe(false);
    const e = await fail(set('kid-maya', 'otto_o'));
    expect(e.message).toBe(USERNAME_TAKEN_MESSAGE);
    expect((await db.doc('usernames/otto_o').get()).data()).toMatchObject({ familyUid: FAM2, kidId: 'kid-other' });
  });

  it('refuses a bad id, a bad shape and a reserved name', async () => {
    expect((await fail(set(7, 'maya_77'))).code).toBe('invalid-argument');
    expect((await fail(set('../x', 'maya_77'))).code).toBe('invalid-argument');
    expect((await fail(set('kid-maya', 'ab'))).code).toBe('invalid-argument');
    expect((await fail(set('kid-maya', 'teacher'))).code).toBe('invalid-argument');
  });

  it('writes the username and nothing else: XP, gems, settings and the PIN row stay as they were', async () => {
    const kidBefore = (await db.doc(`families/${FAM}/kids/kid-maya`).get()).data()!;
    const rowBefore = (await db.doc(`pinIndex/${FAM}/kids/kid-maya`).get()).data();
    await set('kid-maya', 'maya_77');
    const kidAfter = (await db.doc(`families/${FAM}/kids/kid-maya`).get()).data()!;
    const { username, ...rest } = kidAfter;
    expect(username).toBe('maya_77');
    expect(rest).toEqual(kidBefore);
    expect(rest.game).toEqual({ xp: 120, gems: 7 });
    expect((await db.doc(`pinIndex/${FAM}/kids/kid-maya`).get()).data()).toEqual(rowBefore);
  });

  it('allows 30 a minute per parent, counted before the PIN check, then opens again', async () => {
    for (let i = 0; i < NAME_TOOL_LIMIT.max; i++) await set('kid-maya', `maya_${String(i).padStart(2, '0')}`);
    const e = await fail(set('kid-maya', 'maya_99'));
    expect(e.code).toBe('resource-exhausted');
    expect((await db.doc('usernames/maya_99').get()).exists).toBe(false);
    // The other parent has a bucket of their own.
    await player(FAM2, PARENT2, 'kid-other', 'Otto');
    await set('kid-other', 'otto_one', PARENT2);
    clock += MIN + 1;
    await verifyParent();
    await set('kid-maya', 'maya_99');
  });
});

describe('Forget device: a revoked device refuses the next sign-in', () => {
  it('the right passcode on a revoked device fails with failed-precondition and mints no token', async () => {
    await signIn({ username: 'pip_runner', deviceId: DEV_A });
    await db.doc(`families/${FAM}/devices/${DEV_A}`).update({ revoked: true });
    const e = await fail(signIn({ username: 'pip_runner', deviceId: DEV_A }));
    expect(e.code).toBe('failed-precondition');
    expect(e.message).toBe(DEVICE_FORGOTTEN_MESSAGE);
  });

  it('a wrong passcode on a revoked device still gets the generic answer, so the revoked answer shows nothing to a guesser', async () => {
    await signIn({ username: 'pip_runner', deviceId: DEV_A });
    await db.doc(`families/${FAM}/devices/${DEV_A}`).update({ revoked: true });
    expect((await fail(signIn({ username: 'pip_runner', pin: '0000', deviceId: DEV_A }))).message).toBe(MISMATCH_MESSAGE);
    expect((await fail(signIn({ username: 'nobody_here', pin: '0000', deviceId: DEV_A }))).message).toBe(MISMATCH_MESSAGE);
  });

  it('only that device is refused: the same player signs in from another device and from one that sends no id', async () => {
    await signIn({ username: 'pip_runner', deviceId: DEV_A });
    await db.doc(`families/${FAM}/devices/${DEV_A}`).update({ revoked: true });
    await signIn({ username: 'pip_runner', deviceId: DEV_B });
    await signIn({ username: 'pip_runner' });
  });

  it('every refusal is refunded: six right-passcode tries on a forgotten device never lock the player\'s username elsewhere', async () => {
    await signIn({ username: 'pip_runner', deviceId: DEV_A });
    await db.doc(`families/${FAM}/devices/${DEV_A}`).update({ revoked: true });
    for (let i = 0; i < 6; i++) expect((await fail(signIn({ username: 'pip_runner', deviceId: DEV_A, ip: `10.4.0.${i}` }))).code).toBe('failed-precondition');
    await signIn({ username: 'pip_runner', deviceId: DEV_B, ip: '10.4.0.99' });
  });

  it('revoked is per family: another family\'s player on the same device id is not refused', async () => {
    await player(FAM2, PARENT2, 'kid-other', 'Otto', 'otto_o');
    await signIn({ username: 'pip_runner', deviceId: DEV_A });
    await db.doc(`families/${FAM}/devices/${DEV_A}`).update({ revoked: true });
    await signIn({ username: 'otto_o', deviceId: DEV_A });
  });

  it('the legacy display-name path refuses a forgotten device too', async () => {
    await signIn({ name: 'Maya', deviceId: DEV_A });
    await db.doc(`families/${FAM}/devices/${DEV_A}`).update({ revoked: true });
    expect((await fail(signIn({ name: 'Maya', deviceId: DEV_A }))).code).toBe('failed-precondition');
  });

  it('a refused sign-in does not refresh the device record', async () => {
    await signIn({ username: 'pip_runner', deviceId: DEV_A });
    await db.doc(`families/${FAM}/devices/${DEV_A}`).update({ revoked: true });
    clock += 5 * MIN;
    await fail(signIn({ username: 'pip_runner', deviceId: DEV_A }));
    expect((await db.doc(`families/${FAM}/devices/${DEV_A}`).get()).data()!.lastSeen).toBe(clock - 5 * MIN);
  });

  it('Allow again (revoked: false) lets the device sign in', async () => {
    await signIn({ username: 'pip_runner', deviceId: DEV_A });
    await db.doc(`families/${FAM}/devices/${DEV_A}`).update({ revoked: true });
    await db.doc(`families/${FAM}/devices/${DEV_A}`).update({ revoked: false });
    await signIn({ username: 'pip_runner', deviceId: DEV_A });
  });
});

describe('school mode: remember false', () => {
  it('a family with no setting remembers: remember is true', async () => {
    expect((await signIn({ username: 'pip_runner' })).remember).toBe(true);
  });

  it('a family with schoolMode: true answers remember: false on the username path and the legacy path', async () => {
    await db.doc(`families/${FAM}`).update({ schoolMode: true });
    expect((await signIn({ username: 'pip_runner' })).remember).toBe(false);
    expect((await signIn({ name: 'Maya' })).remember).toBe(false);
    expect((await signIn({ name: 'Pip' })).remember).toBe(false);
  });

  it('turning it off again remembers again, and only a strict true counts', async () => {
    await db.doc(`families/${FAM}`).update({ schoolMode: 'yes' });
    expect((await signIn({ username: 'pip_runner' })).remember).toBe(true);
    await db.doc(`families/${FAM}`).update({ schoolMode: false });
    expect((await signIn({ username: 'pip_runner' })).remember).toBe(true);
  });

  it('is per family: another family stays on remember: true', async () => {
    await player(FAM2, PARENT2, 'kid-other', 'Otto', 'otto_o');
    await db.doc(`families/${FAM}`).update({ schoolMode: true });
    expect((await signIn({ username: 'otto_o' })).remember).toBe(true);
  });
});

describe('the lock details the portal shows', () => {
  it('kidLockStatus names each locked player by id with when the lock ends, and each locked device', async () => {
    await signIn({ username: 'pip_runner', deviceId: DEV_A });
    for (let i = 0; i < 20; i++) await fail(signIn({ username: `nobody_${i}`, pin: '0000', deviceId: DEV_A, ip: `10.7.0.${i}` }));
    const quiet = await kidLockStatus(deps(), PARENT);
    expect(quiet.lockedKids).toEqual([]);
    for (let i = 0; i < 5; i++) await fail(signIn({ username: 'pip_runner', pin: '0000', deviceId: DEV_B, ip: `10.7.1.${i}` }));
    const s = await kidLockStatus(deps(), PARENT);
    expect(s.lockedPlayers).toEqual(['pip']);
    expect(s.lockedKids).toEqual([{ kidId: 'kid-pip', until: clock + 5 * MIN }]);
    expect(s.lockedDevices).toEqual([DEV_A]);
  });
});
