import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/logger';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimUsername, parentPinHash, setKidPin, type AuthContext, type Deps } from '../src/core.js';
import { TEST_PEPPER } from './testPepper.js';

// index.ts wiring: instance settings, the MQ_PIN_PEPPER secret binding, and App Check in monitor mode (a verdict per call,
// nothing refused). Runs the real handlers with `.run()` against the Firestore emulator. All ids and passcodes are made up.
process.env.GCLOUD_PROJECT = 'demo-mathquest';
process.env.MQ_PIN_PEPPER = TEST_PEPPER;
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'; // createCustomToken signs locally in emulator mode

type Endpoint = { minInstances?: number | null; maxInstances?: number | null; secretEnvironmentVariables?: { key: string }[]; callableTrigger?: Record<string, unknown> };
type Fn = { __endpoint: Endpoint; run: (req: unknown) => Promise<unknown> };
let fns: Record<string, Fn>;
let db: Firestore;

const FAM = 'fam-wire-1';
const PARENT: AuthContext = { uid: FAM, email: 'parent-wire@example.com', emailVerified: true, provider: 'google.com' };
const req = (data: object, extra: object = {}) => ({ data, rawRequest: { headers: { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' }, ip: '203.0.113.7' }, ...extra });

beforeAll(async () => {
  fns = (await import('../src/index.js')) as unknown as Record<string, Fn>;
  db = getFirestore();
});

beforeEach(async () => {
  for (const col of ['families', 'pinIndex', 'parents', 'meta', 'nameKeys', 'usernames', 'config']) await db.recursiveDelete(db.collection(col));
  await db.doc(`parents/${FAM}`).set({ email: 'parent-wire@example.com', createdAt: 1 });
  await db.doc(`families/${FAM}`).set({ pinHash: parentPinHash(FAM, '4821'), createdAt: 1 });
  await db.doc(`families/${FAM}/kids/kid-wire`).set({ id: 'kid-wire', name: 'Wire', createdAt: 1 });
  const d: Deps = { db, pepper: TEST_PEPPER, auth: { createCustomToken: async () => 't' } };
  await setKidPin(d, PARENT, { kidId: 'kid-wire', pin: '7305' });
  await claimUsername(d, FAM, 'kid-wire', 'wire_kid');
});

describe('instance settings and the secret binding', () => {
  it('kidSignIn: minInstances 1, maxInstances 20, MQ_PIN_PEPPER bound', () => {
    const e = fns.kidSignIn!.__endpoint;
    expect(e.minInstances).toBe(1);
    expect(e.maxInstances).toBe(20);
    expect(e.secretEnvironmentVariables).toEqual([{ key: 'MQ_PIN_PEPPER' }]);
  });

  it('every function that hashes a passcode binds the secret; the others do not', () => {
    for (const name of ['kidSignIn', 'setKidPin', 'setKidPicturePin']) expect(fns[name]!.__endpoint.secretEnvironmentVariables, name).toEqual([{ key: 'MQ_PIN_PEPPER' }]);
    for (const name of ['registerParent', 'kidLockStatus', 'unlockKidSignIn']) expect(fns[name]!.__endpoint.secretEnvironmentVariables ?? [], name).toEqual([]);
  });

  it('the other callables cap at 10 instances and only kidSignIn keeps one warm', () => {
    for (const name of ['setKidPin', 'setKidPicturePin', 'registerParent', 'kidLockStatus', 'unlockKidSignIn']) {
      expect(fns[name]!.__endpoint.maxInstances, name).toBe(10);
      expect(typeof fns[name]!.__endpoint.minInstances, name).not.toBe('number'); // unset, so no warm instance
    }
  });

  it('no callable enforces App Check yet (monitor mode)', () => {
    for (const [name, fn] of Object.entries(fns)) expect(fn.__endpoint.callableTrigger?.enforceAppCheck, name).toBeFalsy();
  });
});

describe('kidSignIn through the real handler', () => {
  const lines = () => (logger.info as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as Record<string, unknown>);
  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  it('signs in by username with the bound pepper and returns {token, remember}', async () => {
    const r = (await fns.kidSignIn!.run(req({ username: 'Wire_Kid', pin: '7305' }))) as { token: string; remember: boolean };
    expect(r.token.split('.')).toHaveLength(3);
    expect(r.remember).toBe(true);
  });

  it('logs app: missing with no App Check token, app: valid with one, and refuses neither', async () => {
    await fns.kidSignIn!.run(req({ username: 'wire_kid', pin: '7305' }));
    await fns.kidSignIn!.run(req({ username: 'wire_kid', pin: '7305' }, { app: { appId: 'web-app-id' } }));
    const checks = lines().filter((l) => l.event === 'appcheck');
    expect(checks.map((l) => [l.fn, l.app])).toEqual([['kidSignIn', 'missing'], ['kidSignIn', 'valid']]);
    expect(lines().filter((l) => l.event === 'kidSignIn').map((l) => l.app)).toEqual(['missing', 'valid']);
  });

  it('logs a verdict for every other callable too', async () => {
    const auth = { uid: FAM, token: { email: 'parent-wire@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } } };
    await fns.kidLockStatus!.run(req({}, { auth }));
    await fns.unlockKidSignIn!.run(req({}, { auth }));
    await fns.registerParent!.run(req({}, { auth }));
    await fns.setKidPin!.run(req({ kidId: 'kid-wire', pin: '2946' }, { auth }));
    await fns.setKidPicturePin!.run(req({ kidId: 'kid-wire', picture: 'abcd' }, { auth, app: { appId: 'x' } }));
    const checks = lines().filter((l) => l.event === 'appcheck');
    expect(checks.map((l) => l.fn)).toEqual(['kidLockStatus', 'unlockKidSignIn', 'registerParent', 'setKidPin', 'setKidPicturePin']);
    expect(checks.map((l) => l.app)).toEqual(['missing', 'missing', 'missing', 'missing', 'valid']);
  });

  it('records the device with a label from the user-agent header', async () => {
    await fns.kidSignIn!.run(req({ username: 'wire_kid', pin: '7305', deviceId: 'wireDevice-0123456789ab' }));
    const dev = (await db.doc(`families/${FAM}/devices/wireDevice-0123456789ab`).get()).data()!;
    expect(dev.label).toBe('iPad Safari');
    expect(dev.kids).toEqual(['kid-wire']);
  });
});
