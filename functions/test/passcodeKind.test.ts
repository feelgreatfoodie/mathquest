import { createHmac } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  KIND_LIMITS,
  KIND_LOCKED_MESSAGE,
  claimUsername,
  kidSignIn,
  parentPinHash,
  passcodeKind,
  resetSigninModeCache,
  setKidPicturePin,
  setKidPin,
  signinMode,
  type AuthContext,
  type Deps,
} from '../src/core.js';
import { TEST_PEPPER } from './testPepper.js';

// L2: passcodeKind (public, rate limited, one answer shape for every name) and signinMode (the first-screen switch).
// Every name, id and passcode below is made up.
const FAM = 'fam-uid-1';
const PARENT: AuthContext = { uid: FAM, email: 'parent-one@example.com', emailVerified: true, provider: 'google.com' };
const DEV = 'devA-0123456789abcdef';
const MIN = 60_000;

let db: Firestore;
let clock = 1_700_000_000_000;
let reads: string[] = [];

/** A Firestore whose doc().get() calls are recorded, so a test can count reads without timing anything. */
function spied(real: Firestore): Firestore {
  return new Proxy(real, {
    get(t, p) {
      if (p === 'doc') {
        return (path: string) => {
          const ref = t.doc(path);
          return new Proxy(ref, {
            get(r, q) {
              if (q === 'get') return () => (reads.push(path), r.get());
              const v = (r as unknown as Record<string | symbol, unknown>)[q];
              return typeof v === 'function' ? v.bind(r) : v;
            },
          });
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

const deps = (spy = false): Deps => ({
  db: spy ? spied(db) : db,
  pepper: TEST_PEPPER,
  now: () => clock,
  log: () => undefined,
  auth: { createCustomToken: async (uid, claims) => JSON.stringify({ uid, claims }) },
});

const kind = (username: unknown, extra: { ip?: string; deviceId?: unknown } = {}) => passcodeKind(deps(), { username, ip: '10.0.0.1', ...extra });

async function fail(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { code: string; message: string };
  }
  throw new Error('expected a failure');
}

async function clearAll() {
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'parentPins', 'nameKeys', 'usernames', 'config']) await db.recursiveDelete(db.collection(col));
}

async function player(id: string, name: string, username: string, picture?: string) {
  await db.doc(`families/${FAM}/kids/${id}`).set({ id, name, createdAt: 1, settings: {}, game: {} });
  await setKidPin(deps(), PARENT, { kidId: id, pin: '7305' });
  if (picture) await setKidPicturePin(deps(), PARENT, { kidId: id, picture });
  await claimUsername(deps(), FAM, id, username);
}

beforeAll(() => {
  if (!getApps().length) initializeApp({ projectId: 'demo-mathquest' });
  db = getFirestore();
});
afterAll(clearAll);
beforeEach(async () => {
  await clearAll();
  clock = 1_700_000_000_000;
  reads = [];
  resetSigninModeCache();
  await db.doc(`parents/${FAM}`).set({ email: 'parent-one@example.com', createdAt: 1 });
  await db.doc(`families/${FAM}`).set({ pinHash: parentPinHash(FAM, '4821'), createdAt: 1 });
  await db.doc(`parentPins/${FAM}`).set({ verifiedAt: clock });
  await player('kid-pip', 'Pip', 'pip_runner');
  await player('kid-maya', 'Maya', 'maya_stars', 'abcd');
});

describe('passcodeKind answers', () => {
  it('a player with a digit passcode gets digits, with a picture passcode gets pictures, in any letter case', async () => {
    expect(await kind('pip_runner')).toEqual({ kind: 'digits' });
    expect(await kind('Maya_Stars')).toEqual({ kind: 'pictures' });
  });

  it('every answer is exactly { kind } with digits or pictures: known, unknown, malformed, empty', async () => {
    for (const n of ['pip_runner', 'maya_stars', 'nobody_here', 'a', 'x'.repeat(40), 'has space', '', '!!!', 'ünï']) {
      const r = await kind(n);
      expect(Object.keys(r)).toEqual(['kind']);
      expect(['digits', 'pictures']).toContain(r.kind);
    }
  });

  it('an unknown name gets a stable answer, and the 40 unknown names fall on both kinds', async () => {
    const names = Array.from({ length: 40 }, (_, i) => `ghost_${i}`);
    const first = await Promise.all(names.map((n) => kind(n, { ip: `10.1.0.${names.indexOf(n)}` })));
    const again = await Promise.all(names.map((n) => kind(n, { ip: `10.2.0.${names.indexOf(n)}` })));
    expect(again).toEqual(first);
    const kinds = new Set(first.map((r) => r.kind));
    expect(kinds).toEqual(new Set(['digits', 'pictures']));
  });

  it('a player whose kid doc or family is gone is answered with the keyed coin, like an unknown name', async () => {
    const coin = (n: string) => (createHmac('sha256', TEST_PEPPER).update(`passcodeKind:${n}`).digest()[0]! % 2 === 0 ? 'digits' : 'pictures');
    expect((await kind('gone_player')).kind).toBe(coin('gone_player'));
    await db.doc(`families/${FAM}/kids/kid-maya`).delete();
    expect((await kind('maya_stars', { ip: '10.0.0.9' })).kind).toBe(coin('maya_stars'));
    await db.doc(`parents/${FAM}`).delete();
    expect((await kind('pip_runner', { ip: '10.0.0.10' })).kind).toBe(coin('pip_runner'));
  });

  it('a name that is only a display name (no username yet) gets the same shape of answer', async () => {
    await db.doc(`families/${FAM}/kids/kid-lola`).set({ id: 'kid-lola', name: 'Lola', createdAt: 1, settings: {}, game: {} });
    await setKidPin(deps(), PARENT, { kidId: 'kid-lola', pin: '7305' });
    expect(Object.keys(await kind('lola'))).toEqual(['kind']);
  });

  it('rejects a non-string or an over-long username', async () => {
    for (const v of [undefined, null, 5, {}, ['a'], 'x'.repeat(65)]) expect((await fail(kind(v))).code).toBe('invalid-argument');
  });

  it('never writes anything but its own counters', async () => {
    const before = (await db.collection('usernames').get()).size;
    await kind('pip_runner');
    await kind('nobody_here');
    expect((await db.collection('usernames').get()).size).toBe(before);
    const touched = (await db.collection('pinIndex/_global/attempts').get()).docs.map((x) => x.id);
    expect(touched.every((id) => id.startsWith('pk_'))).toBe(true);
  });
});

describe('passcodeKind does the same work for every name', () => {
  it('reads the same 4 documents for a known player, an unknown name and a malformed name alike', async () => {
    const counts: number[] = [];
    for (const [i, n] of ['pip_runner', 'nobody_here', '!!!', 'x/y'].entries()) {
      reads = [];
      await passcodeKind(deps(true), { username: n, ip: `10.3.0.${i}` });
      counts.push(reads.length);
    }
    expect(counts).toEqual([4, 4, 4, 4]);
  });
});

describe('passcodeKind rate limit', () => {
  it('refuses the call after the per-network limit, with a calm message, and a known player is refused like an unknown one', async () => {
    for (let i = 0; i < KIND_LIMITS.ip.max; i++) await kind('nobody_here');
    for (const n of ['nobody_here', 'pip_runner']) {
      const e = await fail(kind(n));
      expect({ code: e.code, message: e.message }).toEqual({ code: 'resource-exhausted', message: KIND_LOCKED_MESSAGE });
    }
  });

  it('unlocks after the window, and another network is not locked', async () => {
    for (let i = 0; i < KIND_LIMITS.ip.max; i++) await kind('nobody_here');
    expect((await fail(kind('pip_runner'))).code).toBe('resource-exhausted');
    expect(await kind('pip_runner', { ip: '10.9.9.9' })).toEqual({ kind: 'digits' });
    clock += KIND_LIMITS.ip.windowMs + 1;
    expect(await kind('pip_runner')).toEqual({ kind: 'digits' });
  });

  it('a device that sends an id is limited on its own, across networks', async () => {
    for (let i = 0; i < KIND_LIMITS.device.max; i++) await kind('nobody_here', { ip: `10.4.${Math.floor(i / 200)}.${i % 200}`, deviceId: DEV });
    expect((await fail(kind('pip_runner', { ip: '10.5.5.5', deviceId: DEV }))).code).toBe('resource-exhausted');
    expect(await kind('pip_runner', { ip: '10.5.5.5' })).toEqual({ kind: 'digits' });
  });

  it('a malformed device id is ignored, not an error', async () => {
    expect(await kind('pip_runner', { deviceId: 'short' })).toEqual({ kind: 'digits' });
    expect(await kind('pip_runner', { deviceId: 42 })).toEqual({ kind: 'digits' });
  });

  it('its counters are separate from sign-in: a locked passcodeKind does not lock kidSignIn, and the reverse', async () => {
    for (let i = 0; i < KIND_LIMITS.ip.max; i++) await kind('nobody_here');
    expect((await fail(kind('pip_runner'))).code).toBe('resource-exhausted');
    const ok = await kidSignIn(deps(), { username: 'pip_runner', pin: '7305', ip: '10.0.0.1' });
    expect(JSON.parse(ok.token).claims.kidId).toBe('kid-pip');
  });

  it('fails closed without a pepper', async () => {
    expect((await fail(passcodeKind({ ...deps(), pepper: '' }, { username: 'pip_runner', ip: '10.0.0.1' }))).code).toBe('internal');
  });
});

describe('signinMode', () => {
  const setCfg = (v: unknown) => db.doc('config/app').set({ minVersion: 1, ...(v === undefined ? {} : { signin2: v }) });

  it('is off with no config doc, with no field, and for any value but true or "pilot"', async () => {
    expect(await signinMode(deps())).toEqual({ signin2: false, pilot: false });
    for (const v of [undefined, false, 'yes', 1, 'TRUE', null, {}]) {
      resetSigninModeCache();
      await setCfg(v);
      expect(await signinMode(deps())).toEqual({ signin2: false, pilot: false });
    }
  });

  it('true turns it on for everyone, "pilot" asks each device to opt in', async () => {
    await setCfg(true);
    expect(await signinMode(deps())).toEqual({ signin2: true, pilot: false });
    resetSigninModeCache();
    await setCfg('pilot');
    expect(await signinMode(deps())).toEqual({ signin2: false, pilot: true });
  });

  it('reuses one read for 30 seconds, then reads again', async () => {
    await setCfg(true);
    expect((await signinMode(deps())).signin2).toBe(true);
    await setCfg(false);
    expect((await signinMode(deps())).signin2).toBe(true);
    clock += 31_000;
    expect((await signinMode(deps())).signin2).toBe(false);
    expect(MIN).toBe(60_000);
  });

  it('modeTtlMs 0 reads every time (the emulator setting)', async () => {
    await setCfg(true);
    expect((await signinMode({ ...deps(), modeTtlMs: 0 })).signin2).toBe(true);
    await setCfg(false);
    expect((await signinMode({ ...deps(), modeTtlMs: 0 })).signin2).toBe(false);
  });

  it('returns only the two flags, nothing from the config doc', async () => {
    await db.doc('config/app').set({ minVersion: 9, maxParents: 5, signin2: true, secretish: 'x' });
    expect(Object.keys(await signinMode(deps())).sort()).toEqual(['pilot', 'signin2']);
  });
});
