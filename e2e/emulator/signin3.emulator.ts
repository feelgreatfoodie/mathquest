import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { AUTH, FN, FS, OWNER, PIP, PROJECT, call, devices, fields, seedFamily, setSignin2 } from './seedSignin2';

/**
 * L3 against the real server: the Auth, Firestore and Functions emulators (project demo-e2e) and a dev server in firestore mode.
 * `npm run test:e2e:emulator`. Player side (seedFamily): a forgotten device refuses its next sign-in and loses its tile, and school
 * mode leaves no tile and sends Back to an empty username form. Grown-up side (a fake Google popup): the player wizard with a
 * suggested username and the card, a username for a player who exists, and the Sign-in tab (devices with Forget, lockouts,
 * school mode). Names, ids, the email and the passcodes are made up.
 */
const GROWN_PIN = '7391';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const home = (page: Page) => page.getByRole('button', { name: 'Switch player' });
const doors = (page: Page) => page.getByTestId('first-doors');

const typeDigits = async (page: Page, code: string) => {
  for (const d of code) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).first().click();
};

async function signInByUsername(page: Page, username: string, code: string) {
  await expect(doors(page)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('door-player').click();
  await page.getByPlaceholder('username').fill(username);
  await page.getByTestId('username-next').click();
  await expect(page.getByTestId('first-pad')).toBeVisible({ timeout: 10_000 });
  await typeDigits(page, code);
}

const patch = (path: string, o: object) => fetch(`${FS}/${path}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields(o) }) });
const del = (path: string) => fetch(`${FS}/${path}`, { method: 'DELETE', headers: OWNER });
const get = async (path: string) => (await fetch(`${FS}/${path}`, { headers: OWNER })).json() as Promise<{ fields?: Record<string, { stringValue?: string; booleanValue?: boolean }> }>;

/** kidSignIn straight to the function, as a client would: the parsed body and the status. */
async function rawSignIn(data: object) {
  const res = await fetch(`${FN}/kidSignIn`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': IPAD }, body: JSON.stringify({ data }) });
  return { status: res.status, body: (await res.json()) as { result?: { token: string; remember: boolean }; error?: { status: string; message: string } } };
}

test.describe('the player side', () => {
  test.beforeEach(async () => {
    await seedFamily();
    await setSignin2(true);
  });

  test('a forgotten device refuses the next sign-in with a plain line and loses its tile', async ({ page }) => {
    const fam = await seedFamily();
    await setSignin2(true);
    await page.goto('/');
    await signInByUsername(page, PIP.username, PIP.pin);
    await expect(home(page)).toBeVisible({ timeout: 20_000 });
    const [deviceId] = await expect.poll(() => devices(fam)).toHaveLength(1).then(() => devices(fam));
    await home(page).click();
    await expect(page.getByTestId('tile')).toHaveCount(1);

    // The grown-up forgets the device (the portal's Forget writes this one field).
    await patch(`families/${fam}/devices/${deviceId}?updateMask.fieldPaths=revoked`, { revoked: true });
    await page.getByTestId('tile').click();
    await expect(page.getByTestId('first-pad')).toBeVisible();
    await typeDigits(page, PIP.pin);
    await expect(page.locator('.error')).toContainText('This device was forgotten. Ask a grown-up.');
    await expect(home(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('mathquest:v1:device-tiles'))).toBeNull();
    // Back to the doors: no tile on the forgotten device.
    await page.reload();
    await expect(doors(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('tile')).toHaveCount(0);
  });

  test('school mode leaves no tile, and Back on Home opens an empty username form', async ({ page }) => {
    const fam = await seedFamily();
    await setSignin2(true);
    await patch(`families/${fam}?updateMask.fieldPaths=schoolMode`, { schoolMode: true });
    await page.goto('/');
    await signInByUsername(page, PIP.username, PIP.pin);
    await expect(home(page)).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => localStorage.getItem('mathquest:v1:device-tiles'))).toBeNull();
    await home(page).click();
    await expect(page.getByTestId('first-username')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByPlaceholder('username')).toHaveValue('');
    await expect(page.getByTestId('tile')).toHaveCount(0);
  });
});

// ---------- the grown-up side ----------

const clearEmulators = async () => {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
};

async function parentAccount(): Promise<{ uid: string; sub: string; email: string }> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchGet?maxResults=10`, { headers: { Authorization: 'Bearer owner' } });
  const { users } = (await res.json()) as { users: { localId: string; email: string; providerUserInfo: { rawId: string }[] }[] };
  expect(users).toHaveLength(1);
  return { uid: users[0]!.localId, sub: users[0]!.providerUserInfo[0]!.rawId, email: users[0]!.email };
}

/** An id token for the popup's account, so the test can call the grown-up callables the way the page does. */
async function tokenFor(a: { sub: string; email: string }): Promise<string> {
  const idp = JSON.stringify({ sub: a.sub, email: a.email, email_verified: true });
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idp)}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true, returnIdpCredential: true }),
  });
  return ((await res.json()) as { idToken: string }).idToken;
}

const SETTINGS = { learner: 'reader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const GAME = { xp: 100, gems: 10, streakDays: 1, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' };
const KID = { id: 'kidlegacy00000000004', name: 'Fixture Gamma', pin: '2468' };

/**
 * Signs in through the Auth emulator's fake Google popup, then seeds the family: the old browser PIN hash (the first right
 * Grown-up PIN moves it to the server) and one legacy player with a PIN and no username. The two-door screen is on.
 */
async function parentSignIn(page: Page): Promise<{ uid: string; token: string }> {
  await clearEmulators();
  await setSignin2(true);
  await page.goto('/');
  await page.getByTestId('door-grownups').click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /sign in with google/i }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  const auto = popup.getByRole('button', { name: /auto-generate/i });
  await expect(async () => {
    if (!(await auto.isVisible())) await popup.getByText(/add new account/i).click({ timeout: 1_500 });
    await expect(auto).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  await auto.click();
  await popup.getByRole('button', { name: /sign in with google/i }).click();
  await expect(page.getByRole('heading', { name: 'Make a Grown-up PIN' })).toBeVisible({ timeout: 20_000 });
  const acct = await parentAccount();
  const token = await tokenFor(acct);
  await patch(`families/${acct.uid}`, { pinHash: createHash('sha256').update(`mathquest:${acct.uid}:${GROWN_PIN}`).digest('hex'), createdAt: 1 });
  await patch(`families/${acct.uid}/kids/${KID.id}`, { id: KID.id, name: KID.name, createdAt: 2, settings: SETTINGS, game: GAME });
  // setKidPin needs the Grown-up PIN typed recently. Stamp it, set the PIN, then remove the row so the page's first check migrates the old hash.
  await patch(`parentPins/${acct.uid}`, { verifiedAt: Date.now() });
  await call('setKidPin', token, { kidId: KID.id, pin: KID.pin });
  await del(`parentPins/${acct.uid}`);
  await page.reload();
  return { uid: acct.uid, token };
}

async function openGrownups(page: Page) {
  await expect(page.getByRole('heading', { name: 'Who is playing?' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Grown-ups area' }).click();
  await expect(page.getByRole('heading', { name: 'Grown-up PIN' })).toBeVisible();
  await typeDigits(page, GROWN_PIN);
  await expect(page.getByRole('button', { name: 'Back to game' })).toBeVisible({ timeout: 15_000 });
}

test.describe('the grown-up side', () => {
  test('the wizard adds a player with a suggested username and a card with no passcode, and the player signs in with it', async ({ page }) => {
    const { uid } = await parentSignIn(page);
    await openGrownups(page);
    await page.getByRole('button', { name: '+ Add player' }).click();
    await page.getByTestId('wizard-start').click();
    await page.locator('#wizard-name').fill('Fixture Delta');
    await page.getByTestId('wizard-next').click();

    // The suggestion button gives 3 names; a pick is already known free.
    await expect(page.getByTestId('wizard-next')).toBeDisabled();
    await page.getByTestId('username-suggest').click();
    await expect(page.getByTestId('username-suggestion')).toHaveCount(3, { timeout: 10_000 });
    const picked = (await page.getByTestId('username-suggestion').first().innerText()).trim();
    expect(picked).toMatch(/^[a-z]+\d{2}$/);
    await page.getByTestId('username-suggestion').first().click();
    await page.getByTestId('wizard-next').click();

    // Digits, typed twice. A mismatch starts over.
    await page.getByTestId('pass-digits').click();
    await typeDigits(page, '2580');
    await expect(page.getByRole('heading', { name: 'Type it again' })).toBeVisible();
    await typeDigits(page, '1111');
    await expect(page.getByText('Those did not match. Start over.')).toBeVisible();
    await expect(page.getByRole('heading', { name: '4-digit passcode' })).toBeVisible();
    await typeDigits(page, '2580');
    await expect(page.getByRole('heading', { name: 'Type it again' })).toBeVisible();
    await typeDigits(page, '2580');
    await page.getByTestId('wizard-create').click();

    const card = page.getByTestId('signin-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('signin-card-username')).toHaveText(picked);
    const cardText = await card.innerText();
    expect(cardText).not.toMatch(/2580|Delta|Fixture/i);
    await expect(page.getByTestId('wizard-card')).not.toContainText('2580');

    // The server holds the username, and the new player signs in with it and the passcode.
    expect((await get(`usernames/${picked}`)).fields).toHaveProperty('kidId');
    const ok = await rawSignIn({ username: picked, pin: '2580' });
    expect(ok.body.result?.remember).toBe(true);
    const bad = await rawSignIn({ username: picked, pin: '0000' });
    expect(bad.body.error?.message).toBe("That username and passcode didn't match.");
    expect(uid).toBeTruthy();

    // Add another starts again at the welcome step.
    await page.getByTestId('wizard-another').click();
    await expect(page.getByTestId('wizard-welcome')).toBeVisible();
  });

  test('a player who exists gets a username in Grown-ups, and a taken name is refused', async ({ page }) => {
    const { token } = await parentSignIn(page);
    await openGrownups(page);
    await page.getByRole('button', { name: KID.name, exact: true }).click();
    const panel = page.getByTestId('kid-username-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('No username yet');

    await panel.locator('#player-username').fill('gamma_one');
    await expect(page.getByTestId('username-save')).toBeDisabled();
    await page.getByTestId('username-check').click();
    await expect(page.getByTestId('username-verdict')).toHaveText('That username is free.');
    await page.getByTestId('username-save').click();
    await expect(panel.getByTestId('kid-username-now')).toHaveText('gamma_one', { timeout: 15_000 });
    expect((await get(`usernames/gamma_one`)).fields).toHaveProperty('kidId');
    expect((await rawSignIn({ username: 'gamma_one', pin: KID.pin })).body.result?.token).toBeTruthy();

    // A name this player now holds reads as taken for anyone else, whatever its case.
    const other = await fetch(`${FN}/checkUsername`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ data: { username: 'GAMMA_one' } }) });
    expect(((await other.json()) as { result: unknown }).result).toEqual({ free: false, reason: 'taken' });
  });

  test('the Sign-in tab: devices with Forget, lockouts with Unlock, and school mode', async ({ page }) => {
    const { uid, token } = await parentSignIn(page);
    await call('setUsername', token, { kidId: KID.id, username: 'gamma_two' }).catch(async () => {
      // setUsername needs the Grown-up PIN typed recently: stamp it for this seed call.
      await patch(`parentPins/${uid}`, { verifiedAt: Date.now() });
      await call('setUsername', token, { kidId: KID.id, username: 'gamma_two' });
      await del(`parentPins/${uid}`);
    });
    const DEV = 'devE2E-0123456789abcdef';
    expect((await rawSignIn({ username: 'gamma_two', pin: KID.pin, deviceId: DEV })).body.result?.remember).toBe(true);
    for (let i = 0; i < 5; i++) await rawSignIn({ username: 'gamma_two', pin: '0000', deviceId: DEV });

    await openGrownups(page);
    await page.getByTestId('tab-signin').click();
    await expect(page.getByTestId('signin-portal')).toBeVisible();

    // Lockouts: the player is named with minutes left, and Unlock clears it.
    await expect(page.getByTestId('lockout-row')).toContainText(KID.name, { timeout: 15_000 });
    await page.getByTestId('lockouts-unlock').click();
    await expect(page.getByTestId('lockouts-none')).toBeVisible({ timeout: 15_000 });

    // Devices: one row from the sign-in, Forget (with a second tap to confirm), then the next sign-in on it fails.
    await expect(page.getByTestId('device-row')).toHaveCount(1);
    await expect(page.getByTestId('device-label')).toHaveText(/iPad/);
    await page.getByTestId('device-forget').click();
    await page.getByTestId('device-forget-yes').click();
    await expect(page.getByTestId('device-row')).toHaveAttribute('data-revoked', 'true');
    const refused = await rawSignIn({ username: 'gamma_two', pin: KID.pin, deviceId: DEV });
    expect(refused.body.error).toMatchObject({ status: 'FAILED_PRECONDITION', message: 'This device was forgotten. Ask a grown-up.' });
    await page.getByTestId('device-allow').click();
    await expect(page.getByTestId('device-row')).toHaveAttribute('data-revoked', 'false');
    expect((await rawSignIn({ username: 'gamma_two', pin: KID.pin, deviceId: DEV })).body.result?.token).toBeTruthy();

    // School mode: the next sign-in answers remember: false.
    await expect(page.getByTestId('school-mode')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('school-mode').click();
    await expect(page.getByTestId('school-mode')).toBeChecked({ timeout: 15_000 });
    await expect.poll(async () => (await get(`families/${uid}`)).fields?.schoolMode?.booleanValue).toBe(true);
    expect((await rawSignIn({ username: 'gamma_two', pin: KID.pin })).body.result?.remember).toBe(false);
    await page.getByTestId('school-mode').click();
    await expect(page.getByTestId('school-mode')).not.toBeChecked({ timeout: 15_000 });
    await expect.poll(async () => (await get(`families/${uid}`)).fields?.schoolMode?.booleanValue).toBe(false);
  });

  test('with config/app.signin2 off, Grown-ups is what it was: the old Add player form and no Sign-in tab', async ({ page }) => {
    await parentSignIn(page);
    await setSignin2(false);
    await page.reload();
    await openGrownups(page);
    await expect(page.getByTestId('tab-signin')).toHaveCount(0);
    await page.getByRole('button', { name: '+ Add player' }).click();
    await expect(page.getByLabel('Player name')).toBeVisible();
    await expect(page.getByTestId('wizard-welcome')).toHaveCount(0);
    await page.getByRole('button', { name: KID.name, exact: true }).click();
    await expect(page.getByTestId('kid-username-panel')).toHaveCount(0);
  });
});
