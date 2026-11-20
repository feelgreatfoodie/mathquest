import { expect, test } from '@playwright/test';

/**
 * L1a, the sign-in server core, through the real Functions emulator (project demo-e2e): `npm run test:e2e:emulator`.
 * It runs kidSignIn with the emulator's secret binding (functions/.secret.local, a made-up test pepper), so a wrong
 * binding breaks every sign-in here. Every name, id, email and passcode is made up.
 *
 * Flow: a fake parent registers, a fixture kid gets a PIN (a v2 row), the test writes the username index entry the way the
 * server helper does (no callable claims a username before L3), then it signs in by username, by display name (legacy),
 * checks the device record and the v2 row, and locks the username with 5 wrong tries.
 */
const PROJECT = 'demo-e2e';
const AUTH = 'http://127.0.0.1:9099';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN = `http://127.0.0.1:5001/${PROJECT}/us-west1`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const KID = { id: 'kidcore00000000000001', name: 'Corey', username: 'corey_core' };
const PIN = '4821';
const WRONG = '1111';
const DEVICE = 'e2eDevice-0123456789abcdef';

const fv = (v: unknown): Record<string, unknown> => {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  return { stringValue: String(v) };
};
const fields = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fv(x)]));

async function call(name: string, token: string | null, data: object): Promise<{ status: number; body: string }> {
  const res = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  return { status: res.status, body: await res.text() };
}

async function readDoc(path: string): Promise<{ fields?: Record<string, Record<string, unknown>> } | null> {
  const res = await fetch(`${FS}/${path}`, { headers: OWNER });
  return res.status === 200 ? ((await res.json()) as { fields?: Record<string, Record<string, unknown>> }) : null;
}

async function seed(): Promise<{ idToken: string; uid: string }> {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const idp = JSON.stringify({ sub: 'parent-core-sub', email: 'parent-core@example.com', email_verified: true });
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idp)}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true, returnIdpCredential: true }),
  });
  const { idToken, localId } = (await res.json()) as { idToken: string; localId: string };
  expect((await call('registerParent', idToken, {})).status).toBe(200);
  await fetch(`${FS}/families/${localId}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ pinHash: 'x', createdAt: 1 }) }) });
  await fetch(`${FS}/families/${localId}/kids/${KID.id}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ id: KID.id, name: KID.name, createdAt: 1, hasPin: true, username: KID.username }) }) });
  expect((await call('setKidPin', idToken, { kidId: KID.id, pin: PIN })).status).toBe(200);
  await fetch(`${FS}/usernames/${KID.username}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ familyUid: localId, kidId: KID.id, createdAt: 1 }) }) });
  return { idToken, uid: localId };
}

test('the dev server for the emulator e2e answers', async ({ request }) => {
  // A refused connection fails here by name, before any other test blames the app.
  const res = await request.get('/');
  expect(res.status()).toBe(200);
});

test('a player signs in by username, with the pepper bound, and the row is v2', async () => {
  const { uid } = await seed();
  const res = await call('kidSignIn', null, { username: 'Corey_Core', pin: PIN, deviceId: DEVICE });
  expect(res.status, res.body).toBe(200);
  const { result } = JSON.parse(res.body) as { result: { token: string; remember: boolean } };
  expect(result.token.split('.')).toHaveLength(3);
  expect(result.remember).toBe(true);

  const row = await readDoc(`pinIndex/${uid}/kids/${KID.id}`);
  expect(row?.fields?.v).toEqual({ integerValue: '2' });
  // The pepper decides the hash: the same PIN under no pepper (a plain scrypt) is not what is stored.
  expect(Object.keys(row?.fields ?? {})).not.toContain('pin');
});

test('the device is recorded, with a label and no raw user agent', async () => {
  const { uid } = await seed();
  expect((await call('kidSignIn', null, { username: KID.username, pin: PIN, deviceId: DEVICE })).status).toBe(200);
  const dev = await readDoc(`families/${uid}/devices/${DEVICE}`);
  expect(dev?.fields?.label).toBeDefined();
  expect(JSON.stringify(dev)).toContain(KID.id);
  expect(JSON.stringify(dev?.fields?.label)).not.toContain('Mozilla');
});

test('today\'s players still sign in by display name (legacy), and a wrong passcode gets the new generic message', async () => {
  await seed();
  const ok = await call('kidSignIn', null, { name: KID.name, pin: PIN });
  expect(ok.status, ok.body).toBe(200);
  const bad = await call('kidSignIn', null, { name: KID.name, pin: WRONG });
  expect(bad.status).toBe(403);
  expect(bad.body).toContain("That username and passcode didn't match.");
  const unknown = await call('kidSignIn', null, { username: 'no_such_player', pin: WRONG });
  expect(unknown.status).toBe(403);
  expect(unknown.body).toContain("That username and passcode didn't match.");
});

test('5 wrong passcodes lock the username, and the parent Unlock opens it again', async () => {
  const { idToken } = await seed();
  for (let i = 0; i < 5; i++) expect((await call('kidSignIn', null, { username: KID.username, pin: WRONG })).status).toBe(403);
  const locked = await call('kidSignIn', null, { username: KID.username, pin: PIN });
  expect(locked.status).toBe(429);
  expect(locked.body).toContain('Too many wrong tries');
  expect((await call('unlockKidSignIn', idToken, {})).status).toBe(200);
  expect((await call('kidSignIn', null, { username: KID.username, pin: PIN })).status).toBe(200);
});

test('the client cannot read the username index or the lock counters', async () => {
  const { idToken } = await seed();
  const rules = async (path: string) => (await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${idToken}` } })).status;
  expect(await rules(`usernames/${KID.username}`)).toBe(403);
  expect(await rules('pinIndex/_global/attempts')).toBe(403);
});
