import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

/**
 * The Grown-up PIN is checked on the server. A wrong PIN is refused and 5 wrong tries lock it; a right PIN moves an old browser-made
 * hash to the server and deletes it; a new account sets its first PIN through setParentPin.
 * Runs against the Auth, Firestore and Functions emulators (project demo-e2e) and a dev server in firestore mode wired to them:
 * `npm run test:e2e:emulator`. Names, ids, the email and the PINs are made up.
 */
const PROJECT = 'demo-e2e';
const AUTH = 'http://127.0.0.1:9099';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN = `http://127.0.0.1:5001/${PROJECT}/us-west1`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const GROWN_PIN = '7391';
const PIN_KID = { id: 'kidhaspin0000000000001', name: 'Fixture Beta' };

const SETTINGS = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const GAME = { xp: 100, gems: 10, streakDays: 1, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' };

type Fv = Record<string, unknown>;
const fv = (v: unknown): Fv => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fv) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, fv(x)])) } };
};
const fields = (o: object): Fv => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fv(x)]));

async function call(name: string, token: string, data: object) {
  const res = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`${name} ${res.status} ${await res.text()}`);
}

const put = (path: string, o: object) => fetch(`${FS}/${path}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields(o) }) });

const clearEmulators = async () => {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
};

/** The one account in the Auth emulator: the fake Google parent the popup just created. */
async function parentUid(): Promise<string> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchGet?maxResults=10`, { headers: { Authorization: 'Bearer owner' } });
  const { users } = (await res.json()) as { users: { localId: string }[] };
  expect(users).toHaveLength(1);
  return users[0]!.localId;
}

/** The family doc as the browser wrote it before L1b: the old SHA-256 pinHash and nothing else. */
async function seedFamily(uid: string): Promise<void> {
  await put(`families/${uid}`, { pinHash: createHash('sha256').update(`mathquest:${uid}:${GROWN_PIN}`).digest('hex'), createdAt: 1 });
  await put(`families/${uid}/kids/${PIN_KID.id}`, { id: PIN_KID.id, name: PIN_KID.name, createdAt: 2, hasPin: true, settings: SETTINGS, game: GAME });
}

const get = async (path: string) => (await fetch(`${FS}/${path}`, { headers: OWNER })).json() as Promise<{ fields?: Record<string, unknown> }>;

async function typePin(page: Page, pin: string) {
  for (const d of pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).first().click();
}

/** Types a Grown-up PIN and waits for the server's answer, so the next try starts on a cleared pad. */
async function tryPin(page: Page, pin: string) {
  const answered = page.waitForResponse((r) => r.url().includes('checkParentPin'));
  await typePin(page, pin);
  await answered;
}

/** Signs in through the Auth emulator's fake Google popup (an auto-generated, made-up identity), seeds that family, and reloads. */
async function parentSignIn(page: Page, seed: boolean) {
  await clearEmulators();
  await page.goto('/');
  await page.getByTestId('title-grownups').click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /sign in with google/i }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  // The widget can open on its account list or straight on the form. Click through to the form either way.
  const auto = popup.getByRole('button', { name: /auto-generate/i });
  await expect(async () => {
    if (!(await auto.isVisible())) await popup.getByText(/add new account/i).click({ timeout: 1_500 });
    await expect(auto).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  await auto.click();
  await popup.getByRole('button', { name: /sign in with google/i }).click();
  await expect(page.getByRole('heading', { name: 'Make a Grown-up PIN' })).toBeVisible({ timeout: 20_000 });
  if (!seed) return;
  await seedFamily(await parentUid());
  await page.reload();
}

const OTHER_PIN = '1234';

test('a right PIN moves the old hash to the server once, and a wrong PIN is refused without moving it', async ({ page }) => {
  await parentSignIn(page, true);
  await expect(page.getByRole('heading', { name: 'Who is playing?' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Grown-ups area' }).click();
  await expect(page.getByRole('heading', { name: 'Grown-up PIN' })).toBeVisible();
  const uid = await parentUid();

  await typePin(page, OTHER_PIN);
  await expect(page.getByText('Wrong PIN. Try again.')).toBeVisible({ timeout: 10_000 });
  // Wrong: nothing moved. The old hash is still in the family doc and there is no v2 row.
  expect((await get(`families/${uid}`)).fields).toHaveProperty('pinHash');
  expect((await get(`parentPins/${uid}`)).fields).toBeUndefined();

  await typePin(page, GROWN_PIN);
  await expect(page.getByRole('button', { name: 'Back to game' })).toBeVisible({ timeout: 15_000 });
  const fam = (await get(`families/${uid}`)).fields ?? {};
  expect(fam).not.toHaveProperty('pinHash');
  expect(fam).toHaveProperty('hasPin');
  expect((await get(`parentPins/${uid}`)).fields).toHaveProperty('hash');
});

test('5 wrong PINs lock the Grown-up PIN with a line that says so', async ({ page }) => {
  await parentSignIn(page, true);
  await expect(page.getByRole('heading', { name: 'Who is playing?' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Grown-ups area' }).click();
  for (let i = 0; i < 5; i++) {
    await tryPin(page, OTHER_PIN);
    await expect(page.getByText('Wrong PIN. Try again.')).toBeVisible({ timeout: 10_000 });
  }
  await tryPin(page, GROWN_PIN);
  await expect(page.getByText(/too many wrong tries/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Grown-up PIN' })).toBeVisible();
});

test('a new account sets its first Grown-up PIN on the server, with no hash in the family doc', async ({ page }) => {
  await parentSignIn(page, false);
  await typePin(page, GROWN_PIN);
  await expect(page.getByRole('heading', { name: 'Type it again' })).toBeVisible();
  await typePin(page, GROWN_PIN);
  const uid = await parentUid();
  await expect(async () => expect((await get(`parentPins/${uid}`)).fields).toHaveProperty('hash')).toPass({ timeout: 15_000 });
  const fam = (await get(`families/${uid}`)).fields ?? {};
  expect(fam).not.toHaveProperty('pinHash');
  expect(fam).toHaveProperty('hasPin');
});

test('a stale Grown-up PIN is asked for again before a kid PIN is saved, and the save goes through', async ({ page }) => {
  await parentSignIn(page, true);
  await expect(page.getByRole('heading', { name: 'Who is playing?' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Grown-ups area' }).click();
  await tryPin(page, GROWN_PIN);
  await expect(page.getByRole('button', { name: 'Back to game' })).toBeVisible({ timeout: 15_000 });
  // The last right check is 31 minutes old.
  const uid = await parentUid();
  await fetch(`${FS}/parentPins/${uid}?updateMask.fieldPaths=verifiedAt`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ verifiedAt: Date.now() - 31 * 60_000 }) }) });
  await page.getByTestId('kid-pin-panel').locator('input').fill('4826');
  await page.getByTestId('kid-pin-panel').getByRole('button', { name: 'Change PIN' }).click();
  await expect(page.getByTestId('fresh-pin')).toBeVisible({ timeout: 10_000 });
  await tryPin(page, GROWN_PIN);
  // The pad closes and the save is retried: a reset on this device hands the kid to the PIN pad.
  await expect(page.getByRole('heading', { name: `${PIN_KID.name}'s PIN` })).toBeVisible({ timeout: 15_000 });
});
