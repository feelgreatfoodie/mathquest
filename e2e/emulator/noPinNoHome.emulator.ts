import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

/**
 * A kid with no PIN, picked in the Picker on a grown-up session, never reaches Home. The grown-up is sent to the Grown-up PIN,
 * then that kid's PIN panel in Grown-ups, then that kid's PIN pad, and the kid signs in through the pad.
 * Runs against the Auth, Firestore and Functions emulators (project demo-e2e) and a dev server in firestore mode wired to them:
 * `npm run test:e2e:emulator`. Names, ids, the email and the PINs are made up.
 */
const PROJECT = 'demo-e2e';
const AUTH = 'http://127.0.0.1:9099';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN = `http://127.0.0.1:5001/${PROJECT}/us-west1`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const GROWN_PIN = '7391';
const KID_PIN = '4826';
const NO_PIN_KID = { id: 'kidnopin00000000000001', name: 'Fixture Alpha' };
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

/** The family doc with a Grown-up PIN, one kid with a PIN and one without. Written as the emulator admin. */
async function seedFamily(uid: string): Promise<void> {
  await put(`families/${uid}`, { pinHash: createHash('sha256').update(`mathquest:${uid}:${GROWN_PIN}`).digest('hex'), createdAt: 1 });
  await put(`families/${uid}/kids/${NO_PIN_KID.id}`, { id: NO_PIN_KID.id, name: NO_PIN_KID.name, createdAt: 1, settings: SETTINGS, game: GAME });
  await put(`families/${uid}/kids/${PIN_KID.id}`, { id: PIN_KID.id, name: PIN_KID.name, createdAt: 2, hasPin: true, settings: SETTINGS, game: GAME });
}

async function typePin(page: Page, pin: string) {
  for (const d of pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).first().click();
}

/** Signs in through the Auth emulator's fake Google popup (an auto-generated, made-up identity), seeds that family, and reloads. */
async function parentSignIn(page: Page) {
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
  await seedFamily(await parentUid());
  await page.reload();
}

test('a kid with no PIN picked on a grown-up session never reaches Home and lands on the set-PIN flow', async ({ page }) => {
  const refused: string[] = [];
  page.on('requestfailed', (r) => {
    if (/ERR_CONNECTION_REFUSED/.test(r.failure()?.errorText ?? '')) refused.push(r.url());
  });
  await parentSignIn(page);

  // Picker on the grown-up session.
  await expect(page.getByRole('heading', { name: 'Who is playing?' })).toBeVisible({ timeout: 20_000 });
  await page.locator('.kid-card', { hasText: NO_PIN_KID.name }).click();

  // 1. Never Home. The Grown-up PIN gate shows, with the kid-facing line.
  await expect(page.getByRole('heading', { name: 'Grown-up PIN' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Ask a grown-up to set your passcode.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adventure' })).toHaveCount(0);

  // 2. The Grown-up PIN opens Grown-ups on that kid's PIN panel.
  await typePin(page, GROWN_PIN);
  await expect(page.getByRole('heading', { name: `Sign-in PIN for ${NO_PIN_KID.name}` })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('No PIN yet')).toBeVisible();
  await page.getByTestId('kid-pin-panel').locator('input').fill(KID_PIN);
  await page.getByRole('button', { name: 'Set PIN' }).click();

  // 3. That kid's PIN pad, not Home. The pad signs the kid in.
  await expect(page.getByRole('heading', { name: `${NO_PIN_KID.name}'s PIN` })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Adventure' })).toHaveCount(0);
  await typePin(page, KID_PIN);
  await expect(page.getByRole('button', { name: 'Adventure' })).toBeVisible({ timeout: 20_000 });

  expect(refused).toEqual([]);
});

test('a kid with a PIN still goes to that kid\'s PIN pad', async ({ page }) => {
  await parentSignIn(page);
  await expect(page.getByRole('heading', { name: 'Who is playing?' })).toBeVisible({ timeout: 20_000 });
  await page.locator('.kid-card', { hasText: PIN_KID.name }).click();
  await expect(page.getByRole('heading', { name: `${PIN_KID.name}'s PIN` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adventure' })).toHaveCount(0);
});
