import { readFileSync } from 'node:fs';
import { scryptSync } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../src/core.js';
import { createHmac } from 'node:crypto';
import { LIMITS, LOCKED_MESSAGE, MISMATCH_MESSAGE, kidSignIn, parentPinHash, setKidPin, type AuthContext, type Deps } from '../src/core.js';
import { TEST_PEPPER } from './testPepper.js';

// Picture PIN (UX item 10): 4 of 9 icons, repeats allowed, one letter a to i per icon. Hashed with scrypt exactly like the
// digit PIN, stored beside it in the same server-only row, and signed in through the same kidSignIn, so the per-IP,
// per-name and per-family limits are the same counters. No new unauthenticated endpoint. Names, ids and PINs are made up.
// setKidPicturePin is looked up on the module object so this file loads (and its tests fail one by one) on a build that lacks it.
const setKidPicturePin = (d: Deps, a: AuthContext | undefined, data: { kidId?: unknown; picture?: unknown }) =>
  (core as unknown as { setKidPicturePin: (d: Deps, a: AuthContext | undefined, data: object) => Promise<{ ok: true }> }).setKidPicturePin(d, a, data);

const FAM = 'fam-uid-1';
const FAM2 = 'fam-uid-2';
const PARENT: AuthContext = { uid: FAM, email: 'parent-one@example.com', emailVerified: true, provider: 'google.com' };
const PARENT2: AuthContext = { uid: FAM2, email: 'parent-two@example.com', emailVerified: true, provider: 'google.com' };
const PARENT_PIN = '4821';
const PIN = '7305';
const PIC = 'adgb';
const PIC_B = 'hhei';

let db: Firestore;
let clock = 1_700_000_000_000;
const deps = (): Deps => ({ db, pepper: TEST_PEPPER, now: () => clock, auth: { createCustomToken: async (uid, claims) => JSON.stringify({ uid, claims }) } });
const seedKid = (fam: string, id: string, name: string) => db.doc(`families/${fam}/kids/${id}`).set({ id, name, createdAt: 1, settings: {}, game: {} });
async function clearAll() {
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'nameKeys', 'usernames', 'config']) await db.recursiveDelete(db.collection(col));
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
  await seedKid(FAM, 'kid-zed', 'Zed');
  await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: PIN });
  await setKidPin(deps(), PARENT, { kidId: 'kid-maya', pin: PIN });
  await setKidPin(deps(), PARENT, { kidId: 'kid-zed', pin: PIN });
});

describe('setKidPicturePin', () => {
  it('rejects callers who are not registered parents', async () => {
    expect((await fail(setKidPicturePin(deps(), undefined, { kidId: 'kid-pip', picture: PIC }))).code).toBe('unauthenticated');
    expect((await fail(setKidPicturePin(deps(), { uid: 'stranger', email: 's@example.com', emailVerified: true }, { kidId: 'kid-pip', picture: PIC }))).code).toBe('permission-denied');
    expect((await fail(setKidPicturePin(deps(), { ...PARENT, emailVerified: false }, { kidId: 'kid-pip', picture: PIC }))).code).toBe('permission-denied');
  });
  it('accepts exactly 4 icons from a to i, repeats allowed, and refuses every other shape', async () => {
    await expect(setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: 'aaaa' })).resolves.toEqual({ ok: true });
    await expect(setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: 'iabi' })).resolves.toEqual({ ok: true });
    for (const bad of ['abc', 'abcde', 'abcj', 'ABCD', '1234', 'ab d', '', 'abc\n', 5, null, undefined, ['a', 'b', 'c', 'd']]) {
      expect((await fail(setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: bad }))).code, JSON.stringify(bad)).toBe('invalid-argument');
    }
  });
  it('refuses a kid in another family, a missing kid, and a kid with no PIN yet', async () => {
    await seedKid(FAM2, 'kid-other', 'Otto');
    expect((await fail(setKidPicturePin(deps(), PARENT, { kidId: 'kid-other', picture: PIC }))).code).toBe('not-found');
    expect((await fail(setKidPicturePin(deps(), PARENT2, { kidId: 'kid-pip', picture: PIC }))).code).toBe('not-found');
    expect((await fail(setKidPicturePin(deps(), PARENT, { kidId: 'nobody', picture: PIC }))).code).toBe('not-found');
    await seedKid(FAM, 'kid-new', 'Nova');
    expect((await fail(setKidPicturePin(deps(), PARENT, { kidId: 'kid-new', picture: PIC }))).code).toBe('failed-precondition');
  });
  it('stores a scrypt hash with a 16-byte salt, derived exactly like the digit PIN, and never the picture itself', async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: PIC });
    const row = (await db.doc('pinIndex/fam-uid-1/kids/kid-pip').get()).data()!;
    const pic = row.pic as { salt: string; hash: string };
    expect(Buffer.from(pic.salt, 'hex')).toHaveLength(16);
    // v2: scrypt over HMAC-SHA256(pepper, passcode). The digit PIN row fields are untouched and use the same derivation.
    const v2 = (p: string, salt: string) => scryptSync(createHmac('sha256', TEST_PEPPER).update(p).digest(), Buffer.from(salt, 'hex'), 32).toString('hex');
    expect(pic.hash).toBe(v2(PIC, pic.salt));
    expect((pic as { v?: number }).v).toBe(2);
    expect(row.hash).toBe(v2(PIN, String(row.salt)));
    expect(row.v).toBe(2);
    const everything = JSON.stringify([(await db.doc('pinIndex/fam-uid-1/kids/kid-pip').get()).data(), (await db.doc('families/fam-uid-1/kids/kid-pip').get()).data(), (await db.doc('nameKeys/pip').get()).data()]);
    expect(everything).not.toContain(PIC);
  });
  it('uses a new salt per kid and per set, so equal pictures hash differently', async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: PIC });
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-maya', picture: PIC });
    const a = (await db.doc('pinIndex/fam-uid-1/kids/kid-pip').get()).data()!.pic;
    const b = (await db.doc('pinIndex/fam-uid-1/kids/kid-maya').get()).data()!.pic;
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: PIC });
    expect((await db.doc('pinIndex/fam-uid-1/kids/kid-pip').get()).data()!.pic.salt).not.toBe(a.salt);
  });
  it('puts only a flag on the kid doc: hasPicturePin true, no hash, no salt, no picture', async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: PIC });
    const kid = (await db.doc('families/fam-uid-1/kids/kid-pip').get()).data()!;
    expect(kid.hasPicturePin).toBe(true);
    expect(kid.hasPin).toBe(true);
    expect(JSON.stringify(kid)).not.toMatch(/hash|salt|adgb/);
  });
  it('keeps the picture when the parent sets a new digit PIN, and keeps the digit PIN when a picture is set', async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: PIC });
    await setKidPin(deps(), PARENT, { kidId: 'kid-pip', pin: '1357' });
    expect(claimsOf(await signIn('Pip', PIC)).claims.kidId).toBe('kid-pip');
    expect(claimsOf(await signIn('Pip', '1357')).claims.kidId).toBe('kid-pip');
    await expect(signIn('Pip', PIN)).rejects.toBeTruthy();
  });
});

describe('kidSignIn with a picture PIN', () => {
  beforeEach(async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: PIC });
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-maya', picture: PIC_B });
  });
  it('a correct picture returns a token for that kid only, with the same claims as a digit sign-in', async () => {
    const t = claimsOf(await signIn('Pip', PIC));
    expect(t.uid).toBe('kid_kid-pip');
    expect(t.claims).toEqual({ role: 'kid', familyUid: FAM, kidId: 'kid-pip' });
  });
  it('the picture opens only the kid it belongs to: Maya\'s picture under Pip\'s name is refused, and the reverse', async () => {
    expect((await fail(signIn('Pip', PIC_B, '10.0.0.2'))).message).toBe(MISMATCH_MESSAGE);
    expect((await fail(signIn('Maya', PIC, '10.0.0.3'))).message).toBe(MISMATCH_MESSAGE);
  });
  it('two kids may share a picture, because the name tells them apart', async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-maya', picture: PIC });
    expect(claimsOf(await signIn('Pip', PIC)).claims.kidId).toBe('kid-pip');
    expect(claimsOf(await signIn('Maya', PIC)).claims.kidId).toBe('kid-maya');
  });
  it('the digit PIN keeps working for a kid who has a picture PIN', async () => {
    expect(claimsOf(await signIn('Pip', PIN)).claims.kidId).toBe('kid-pip');
  });
  it('is off until a parent sets one: a picture under a kid with no picture PIN is refused with the same error as a wrong one', async () => {
    const noPic = await fail(signIn('Zed', PIC, '10.0.0.4'));
    const wrong = await fail(signIn('Pip', 'iiii', '10.0.0.5'));
    const unknown = await fail(signIn('Nobody', PIC, '10.0.0.6'));
    expect(noPic.code).toBe('permission-denied');
    expect(noPic.message).toBe(MISMATCH_MESSAGE);
    expect({ code: wrong.code, message: wrong.message }).toEqual({ code: noPic.code, message: noPic.message });
    expect({ code: unknown.code, message: unknown.message }).toEqual({ code: noPic.code, message: noPic.message });
  });
  it('a pin that is neither 4 digits nor 4 icons is refused as a bad argument', async () => {
    for (const bad of ['abcj', 'abc', 'a1b2', 'ABCD', '12345']) expect((await fail(signIn('Pip', bad))).code, bad).toBe('invalid-argument');
  });
});

describe('picture PINs use the same limits and lockout as digits', () => {
  beforeEach(async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: PIC });
  });
  it('refuses the 51st wrong picture from one IP, even with the right picture', async () => {
    for (let i = 0; i < LIMITS.ip.max; i++) expect((await fail(signIn(`Nobody${i}`, 'iiii'))).message).toBe(MISMATCH_MESSAGE);
    const e = await fail(signIn('Pip', PIC));
    expect(e.code).toBe('resource-exhausted');
    expect(e.message).toBe(LOCKED_MESSAGE);
  });
  it('lets the IP back in after 15 minutes', async () => {
    for (let i = 0; i < LIMITS.ip.max; i++) await fail(signIn(`Nobody${i}`, 'iiii'));
    expect((await fail(signIn('Pip', PIC))).code).toBe('resource-exhausted');
    clock += LIMITS.ip.windowMs + 1;
    expect(claimsOf(await signIn('Pip', PIC)).claims.kidId).toBe('kid-pip');
  });
  it('wrong digits and wrong pictures share one counter: 6 digit failures plus 4 picture failures lock the name', async () => {
    const wrongs = ['0000', '1111', '2222', '3333', '4444', '5555', 'iiii', 'hhhh', 'gggg', 'ffff'];
    for (const [i, p] of wrongs.entries()) await fail(signIn('Pip', p, `10.4.0.${i}`));
    expect((await fail(signIn('Pip', PIC, '10.4.0.99'))).code).toBe('resource-exhausted');
    expect((await fail(signIn('Pip', PIN, '10.4.0.98'))).code).toBe('resource-exhausted');
  });
  it('locks a name after 10 wrong pictures from different IPs for an hour', async () => {
    for (let i = 0; i < LIMITS.name.max; i++) await fail(signIn('Pip', 'iiii', `10.1.0.${i}`));
    const e = await fail(signIn('Pip', PIC, '10.9.9.9'));
    expect(e.code).toBe('resource-exhausted');
    clock += LIMITS.name.windowMs + 1;
    expect(claimsOf(await signIn('Pip', PIC, '10.9.9.9')).claims.kidId).toBe('kid-pip');
  });
  it('locks the family after 100 wrong pictures spread over names and IPs', async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-maya', picture: PIC_B });
    // 99 counted failures are seeded (100 real scrypt tries would take a minute); the 100th is a real wrong picture.
    const entries = Array.from({ length: LIMITS.family.max - 1 }, (_, i) => ({ id: `seed${i}`, at: clock - 1000 }));
    await db.doc(`pinIndex/${FAM}/attempts/family`).set({ entries, lockedUntil: 0, lockedBy: null, families: [], updatedAt: clock });
    await fail(signIn('Pip', 'iiii', '10.2.0.1'));
    expect((await fail(signIn('Maya', PIC_B, '10.77.7.7'))).code).toBe('resource-exhausted');
  });
  it('counts wrong pictures for an unknown name against the IP, like a known name', async () => {
    for (let i = 0; i < LIMITS.ip.max; i++) await fail(signIn(`Nobody${i}`, 'iiii'));
    expect((await fail(signIn('Pip', PIC))).code).toBe('resource-exhausted');
  });
  it('counts parallel picture guesses, so a burst cannot skip the limit', async () => {
    // The property: at most 5 wrong guesses are ever verified (answered permission-denied) and none succeeds. Under contention a
    // call may also end aborted, which verifies nothing, so the count of refusals is not asserted. 12 uncounted guesses would give 12.
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => signIn('Pip', 'iiii')));
    const codes = results.map((r) => (r.status === 'rejected' ? (r.reason as { code: string }).code : 'ok'));
    expect(codes).not.toContain('ok');
    expect(codes.filter((c) => c === 'permission-denied').length).toBeLessThanOrEqual(LIMITS.username.max);
  });
  it('a right picture refunds its own entry, like a right digit PIN', async () => {
    // 2 wrong then a right, 4 times, keeps the 5-in-a-row count low while the name counter reaches 8 wrong. The 9th wrong plus a right
    // picture is the 10th try on that counter: it would lock the name unless the right picture refunded its own entry.
    for (let round = 0; round < 4; round++) {
      await fail(signIn('Pip', 'iiii'));
      await fail(signIn('Pip', 'iiii'));
      expect(claimsOf(await signIn('Pip', PIC)).claims.kidId).toBe('kid-pip');
    }
    await fail(signIn('Pip', 'iiii'));
    expect(claimsOf(await signIn('Pip', PIC)).claims.kidId).toBe('kid-pip');
    expect(claimsOf(await signIn('Pip', PIC)).claims.kidId).toBe('kid-pip');
  });
  it('the parent unlock clears a lock made by picture failures', async () => {
    for (let i = 0; i < LIMITS.ip.max; i++) await fail(signIn('Pip', 'iiii'));
    expect((await fail(signIn('Pip', PIC))).code).toBe('resource-exhausted');
    await core.unlockKidSignIn(deps(), PARENT);
    expect(claimsOf(await signIn('Pip', PIC)).claims.kidId).toBe('kid-pip');
  });
});

describe('nothing new is exposed without auth', () => {
  it('every core function except kidSignIn refuses an unauthenticated caller, including setKidPicturePin', async () => {
    const fns = core as unknown as Record<string, (d: Deps, a: AuthContext | undefined, data?: object) => Promise<unknown>>;
    for (const name of ['registerParent', 'setKidPin', 'setKidPicturePin', 'kidLockStatus', 'unlockKidSignIn']) {
      expect(typeof fns[name], `${name} exists`).toBe('function');
      expect((await fail(fns[name]!(deps(), undefined, { kidId: 'kid-pip', pin: PIN, picture: PIC }))).code, name).toBe('unauthenticated');
    }
  });
  it('index.ts exports exactly the known callables, and only kidSignIn reads no auth', () => {
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const exported = [...src.matchAll(/export const (\w+) = onCall/g)].map((m) => m[1]).sort();
    expect(exported).toEqual(['kidLockStatus', 'kidSignIn', 'registerParent', 'setKidPicturePin', 'setKidPin', 'unlockKidSignIn']);
    for (const line of src.split('\n').filter((l) => /^export const \w+ = onCall/.test(l))) {
      if (line.includes('kidSignIn')) continue;
      expect(line, line).toContain('authOf(req)');
    }
  });
  it('kidSignIn returns no kid list, name or hero: the only success value is a token, and failures carry one fixed message', async () => {
    await setKidPicturePin(deps(), PARENT, { kidId: 'kid-pip', picture: PIC });
    const ok = await signIn('Pip', PIC);
    expect(Object.keys(ok)).toEqual(['token', 'remember']);
    const e1 = await fail(signIn('Pip', 'iiii', '10.3.0.1'));
    const e2 = await fail(signIn('Nobody', 'iiii', '10.3.0.2'));
    expect(Object.keys(e1).sort()).toEqual(Object.keys(e2).sort());
    expect(JSON.stringify(e1)).not.toMatch(/Pip|Maya|kid-/);
  });
  it('the source adds no function that lists kids without auth (no listDocuments or collection read outside an assertParent path)', () => {
    const src = readFileSync(new URL('../src/core.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/export async function setKidPicturePin[\s\S]{0,400}assertParent/);
  });
});
