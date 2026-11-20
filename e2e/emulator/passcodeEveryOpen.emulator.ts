import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * The PIN pad is required on every app open. A kid session that Firebase Auth restored from IndexedDB (reload, cold start,
 * PWA relaunch) must never reach a kid's Home: the app signs it out and shows the pad. A fresh pad sign-in reaches Home, and
 * "Switch player" returns to the pad. Runs against the Auth, Firestore and Functions emulators (project demo-e2e):
 * `npm run test:e2e:emulator`. Names, ids, the email and the PIN are made up.
 */
const PROJECT = 'demo-e2e';
const AUTH = 'http://127.0.0.1:9099';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN = `http://127.0.0.1:5001/${PROJECT}/us-west1`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const KID = { id: 'kidpip000000000000002', name: 'Pip' };
const PIN = '4821';
const SETTINGS = { learner: 'reader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
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
  const res = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ data }) });
  if (!res.ok) throw new Error(`${name} ${res.status} ${await res.text()}`);
}

async function seedFamily(): Promise<void> {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const idp = JSON.stringify({ sub: 'parent-pad-sub', email: 'parent-pad@example.com', email_verified: true });
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idp)}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true, returnIdpCredential: true }),
  });
  const { idToken, localId } = (await res.json()) as { idToken: string; localId: string };
  await call('registerParent', idToken, {});
  await fetch(`${FS}/families/${localId}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ pinHash: 'x', createdAt: 1 }) }) });
  // The parent typed the Grown-up PIN a moment ago, which setKidPin needs when a PIN exists.
  await fetch(`${FS}/parentPins/${localId}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ verifiedAt: Date.now() }) }) });
  await fetch(`${FS}/families/${localId}/kids/${KID.id}`, {
    method: 'PATCH',
    headers: OWNER,
    body: JSON.stringify({ fields: fields({ id: KID.id, name: KID.name, createdAt: 1, hasPin: true, settings: SETTINGS, game: GAME }) }),
  });
  await call('setKidPin', idToken, { kidId: KID.id, pin: PIN });
}

const home = (page: Page) => page.getByRole('button', { name: 'Switch player' });
const nameField = (page: Page) => page.getByPlaceholder('First name');
const facePad = (page: Page) => page.locator('.keypad');

/** A signed-out app opens on the title menu, one tap from the pad. Either is fine. Home is not. */
async function expectPadNotHome(page: Page) {
  await expect(page.getByTestId('title-play').or(page.locator('.keypad').first())).toBeVisible({ timeout: 20_000 });
  await expect(home(page)).toHaveCount(0);
}

/** Opens the app and signs in as the kid through the real pad (kidSignIn plus a custom token). */
async function signInThroughPad(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('title-play').or(nameField(page)).or(facePad(page).first())).toBeVisible({ timeout: 20_000 });
  if (await page.getByTestId('title-play').isVisible()) await page.getByTestId('title-play').click();
  if (!(await nameField(page).isVisible())) {
    const typed = page.getByRole('button', { name: 'Type a name instead' });
    if (await typed.isVisible()) await typed.click();
  }
  await nameField(page).fill(KID.name);
  for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).first().click();
  await expect(home(page)).toBeVisible({ timeout: 20_000 });
}

async function authKeyStored(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open('firebaseLocalStorageDb');
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) return resolve(false);
          const r = db.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAllKeys();
          r.onsuccess = () => resolve(r.result.some((k) => String(k).startsWith('firebase:authUser:')));
          r.onerror = () => resolve(false);
        };
      }),
  );
}

async function coldStart(browser: Browser, from: Page): Promise<Page> {
  // A new browser context seeded with the old one's cookies, localStorage and IndexedDB: the app opened again with nothing in memory.
  const state = await from.context().storageState({ indexedDB: true });
  await from.context().close();
  const ctx = await browser.newContext({ storageState: state, viewport: { width: 1024, height: 768 }, hasTouch: true });
  return ctx.newPage();
}

test('no path reaches a kid Home without the pad: reload, cold start and player switch', async ({ page, browser, baseURL }) => {
  await seedFamily();

  // A fresh pad sign-in reaches Home, and Firebase Auth stores the kid session (the thing a reload would restore).
  await signInThroughPad(page);
  await expect.poll(() => authKeyStored(page), { timeout: 20_000 }).toBe(true);

  // Reload: the stored kid session must not open Home.
  await page.reload();
  await expectPadNotHome(page);

  // The pad still works after that.
  await signInThroughPad(page);

  // Player switch: Switch player signs out and shows the pad. A reload after it shows the pad too.
  await home(page).click();
  await expectPadNotHome(page);
  await page.reload();
  await expectPadNotHome(page);

  // Cold start: a new context holding the old storage (signed in as a kid) shows the pad.
  await signInThroughPad(page);
  const cold = await coldStart(browser, page);
  await cold.goto(baseURL ?? '/');
  await expectPadNotHome(cold);
  await cold.context().close();
});
