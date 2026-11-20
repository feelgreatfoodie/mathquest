import { expect, test } from '@playwright/test';

/**
 * A parent PIN reset clears the kid's sign-in lock. Runs against the Auth, Firestore and Functions emulators
 * (project demo-e2e): `npm run test:e2e:emulator`. Every name, id, email and PIN here is made up.
 *
 * Flow: a fake parent registers, a fixture kid gets a PIN, wrong PINs lock sign-in, the parent resets the PIN
 * (setKidPin), and the kid must get in with the new PIN straight away. A second pass does the same with the picture PIN.
 */
const PROJECT = 'demo-e2e';
const AUTH = 'http://127.0.0.1:9099';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN = `http://127.0.0.1:5001/${PROJECT}/us-west1`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const KID = { id: 'kidpix000000000000001', name: 'Pixel' };
const OLD_PIN = '4821';
const NEW_PIN = '7305';
const WRONG = '1111';
const PICTURE = 'abcd';
// Every name locks after 5 wrong tries in a row (LIMITS.username in functions/src/core.ts), a legacy display name included.
const NAME_LOCK_TRIES = 5;

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

async function seed(): Promise<string> {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const idp = JSON.stringify({ sub: 'parent-reset-sub', email: 'parent-reset@example.com', email_verified: true });
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idp)}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true, returnIdpCredential: true }),
  });
  const { idToken, localId } = (await res.json()) as { idToken: string; localId: string };
  expect((await call('registerParent', idToken, {})).status).toBe(200);
  await fetch(`${FS}/families/${localId}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ pinHash: 'x', createdAt: 1 }) }) });
  // The parent typed the Grown-up PIN a moment ago, which setKidPin needs when a PIN exists.
  await fetch(`${FS}/parentPins/${localId}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ verifiedAt: Date.now() }) }) });
  await fetch(`${FS}/families/${localId}/kids/${KID.id}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ id: KID.id, name: KID.name, createdAt: 1, hasPin: true }) }) });
  expect((await call('setKidPin', idToken, { kidId: KID.id, pin: OLD_PIN })).status).toBe(200);
  return idToken;
}

const signIn = (pin: string) => call('kidSignIn', null, { name: KID.name, pin });

async function lockWithWrongPins() {
  for (let i = 0; i < NAME_LOCK_TRIES; i++) expect((await signIn(WRONG)).status).toBe(403);
  // The lock is on: even the right PIN is refused with the locked message.
  const locked = await signIn(OLD_PIN);
  expect(locked.status).toBe(429);
  expect(locked.body).toContain('Too many wrong tries');
}

test('a parent PIN reset lets the locked kid in with the new PIN', async () => {
  const parent = await seed();
  await lockWithWrongPins();

  expect((await call('setKidPin', parent, { kidId: KID.id, pin: NEW_PIN })).status).toBe(200);

  const res = await signIn(NEW_PIN);
  expect(res.status, res.body).toBe(200);
  expect(res.body).toContain('token');
  // The old PIN no longer works, and it is a plain mismatch, not a lock.
  expect((await signIn(OLD_PIN)).status).toBe(403);
});

test('a parent picture PIN reset lets the locked kid in with the picture', async () => {
  const parent = await seed();
  expect((await call('setKidPicturePin', parent, { kidId: KID.id, picture: 'efgh' })).status).toBe(200);
  await lockWithWrongPins();

  expect((await call('setKidPicturePin', parent, { kidId: KID.id, picture: PICTURE })).status).toBe(200);

  const res = await signIn(PICTURE);
  expect(res.status, res.body).toBe(200);
  expect(res.body).toContain('token');
});

test('the kid screen tells a locked kid to ask a grown-up to tap Unlock, and the new PIN works after a reset', async ({ page }) => {
  const parent = await seed();
  await page.goto('/');
  await expect(page.getByTestId('title-play').or(page.getByPlaceholder('First name'))).toBeVisible();
  if (await page.getByTestId('title-play').isVisible()) await page.getByTestId('title-play').click();
  // The pad ignores taps while it waits for the server, so each attempt waits until the pad is empty and enabled again.
  const tap = async (pin: string) => {
    for (const d of pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).first().click();
    await page.waitForTimeout(400);
    await expect(page.locator('.pin-dots')).toHaveAttribute('aria-label', '0 of 4 digits', { timeout: 15_000 });
    await expect(page.locator('.keypad .key').first()).toBeEnabled({ timeout: 15_000 });
  };
  await page.getByPlaceholder('First name').fill(KID.name);
  for (let i = 0; i < NAME_LOCK_TRIES; i++) await tap(WRONG);
  await tap(OLD_PIN);
  await expect(page.getByText('Ask a grown-up to open Grown-ups and tap Unlock.')).toBeVisible({ timeout: 15_000 });

  expect((await call('setKidPin', parent, { kidId: KID.id, pin: NEW_PIN })).status).toBe(200);
  for (const d of NEW_PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).first().click();
  await expect(page.getByPlaceholder('First name')).toHaveCount(0, { timeout: 20_000 });
});
