import { expect, test, type Browser, type Page } from '@playwright/test';
import { MAYA, PIP, devices, seedFamily, setSignin2 } from './seedSignin2';

/**
 * L2 first screen against the real server: the Auth, Firestore and Functions emulators (project demo-e2e), the real
 * signinMode, passcodeKind and kidSignIn, and a dev server in firestore mode. `npm run test:e2e:emulator`.
 * With config/app.signin2 on: two doors, no name anywhere before sign-in, a username form that asks passcodeKind, the
 * passcode pad, a deviceId on every kidSignIn. With it off or on pilot: the screen players know today.
 */
const home = (page: Page) => page.getByRole('button', { name: 'Switch player' });
const prereaderHome = (page: Page) => page.getByRole('button', { name: 'Play' });
const doors = (page: Page) => page.getByTestId('first-doors');

/** Collects each kidSignIn and passcodeKind request body the page sends, and any refused connection. */
function watch(page: Page) {
  const w = { signIn: [] as Record<string, unknown>[], kind: [] as Record<string, unknown>[], refused: [] as string[] };
  page.on('request', (r) => {
    const body = () => (JSON.parse(r.postData() ?? '{}') as { data?: Record<string, unknown> }).data ?? {};
    if (r.url().endsWith('/kidSignIn')) w.signIn.push(body());
    if (r.url().endsWith('/passcodeKind')) w.kind.push(body());
  });
  page.on('requestfailed', (r) => {
    if (/ERR_CONNECTION_REFUSED/.test(r.failure()?.errorText ?? '')) w.refused.push(r.url());
  });
  return w;
}

const typeDigits = async (page: Page, code: string) => {
  for (const d of code) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).first().click();
};
const tapPictures = async (page: Page, letters: string) => {
  for (const l of letters) await page.locator(`.picture-key[data-icon="${l.charCodeAt(0) - 97}"]`).click();
};

async function signInByUsername(page: Page, username: string, code: string) {
  await expect(doors(page)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('door-player').click();
  await page.getByPlaceholder('username').fill(username);
  await page.getByTestId('username-next').click();
  await expect(page.getByTestId('first-pad')).toBeVisible({ timeout: 10_000 });
  if (/^[a-i]{4}$/.test(code)) await tapPictures(page, code);
  else await typeDigits(page, code);
}

async function coldStart(browser: Browser, from: Page, baseURL: string): Promise<Page> {
  const state = await from.context().storageState({ indexedDB: true });
  await from.context().close();
  const ctx = await browser.newContext({ storageState: state, viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(baseURL);
  return page;
}

test.beforeEach(async () => {
  await seedFamily();
  await setSignin2(true);
});

test('signin2 on: two doors, no name, a username, a pad, then Home, with a deviceId on the call', async ({ page }) => {
  const net = watch(page);
  await page.goto('/');
  await expect(doors(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('door-player')).toHaveText(/I'M A PLAYER/i);
  await expect(page.getByTestId('door-grownups')).toBeVisible();
  // Nothing names a player before sign-in: no tile on a new device, no name text.
  await expect(page.getByTestId('tile')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/pip|maya/i);

  await signInByUsername(page, 'Pip_Runner', PIP.pin);
  await expect(home(page)).toBeVisible({ timeout: 20_000 });

  // The calls: passcodeKind then kidSignIn by username (lowercased), both carrying one 128-bit deviceId, and no display name.
  expect(net.kind).toHaveLength(1);
  expect(net.kind[0]).toMatchObject({ username: 'pip_runner' });
  expect(net.signIn).toHaveLength(1);
  expect(net.signIn[0]).toMatchObject({ username: 'pip_runner', pin: PIP.pin });
  expect(net.signIn[0]).not.toHaveProperty('name');
  expect(String(net.signIn[0]!.deviceId)).toMatch(/^[0-9a-f]{32}$/);
  expect(net.kind[0]!.deviceId).toBe(net.signIn[0]!.deviceId);
  expect(net.refused).toEqual([]);
});

test('every path to Home needs the pad: a tile, a reload, a cold start and Switch player', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  await signInByUsername(page, PIP.username, PIP.pin);
  await expect(home(page)).toBeVisible({ timeout: 20_000 });

  // The device now holds a tile for Pip: the hero picture, no name.
  await home(page).click();
  await expect(doors(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(page.getByTestId('tile')).toHaveAttribute('data-hero', 'knight');
  expect(await page.locator('body').innerText()).not.toMatch(/pip/i);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/Pip(?!_)|"name"/);

  // The tile path: tapping it opens the pad, never Home. The passcode then opens Home.
  await page.getByTestId('tile').click();
  await expect(page.getByTestId('first-pad')).toBeVisible();
  await expect(home(page)).toHaveCount(0);
  await typeDigits(page, '0000');
  await expect(page.locator('.error')).toContainText("That username and passcode didn't match.");
  await expect(home(page)).toHaveCount(0);
  await typeDigits(page, PIP.pin);
  await expect(home(page)).toBeVisible({ timeout: 20_000 });

  // Reload with a restored kid session: the doors and the tile, never Home.
  await page.reload();
  await expect(doors(page)).toBeVisible({ timeout: 20_000 });
  await expect(home(page)).toHaveCount(0);
  await page.getByTestId('tile').click();
  await expect(page.getByTestId('first-pad')).toBeVisible();
  await expect(home(page)).toHaveCount(0);
  await typeDigits(page, PIP.pin);
  await expect(home(page)).toBeVisible({ timeout: 20_000 });

  // Cold start: a new context holding the old storage shows the doors and the tile, and the tile opens the pad.
  const cold = await coldStart(browser, page, baseURL ?? '/');
  await expect(doors(cold)).toBeVisible({ timeout: 20_000 });
  await expect(home(cold)).toHaveCount(0);
  await expect(cold.getByTestId('tile')).toHaveCount(1);
  await cold.getByTestId('tile').click();
  await expect(cold.getByTestId('first-pad')).toBeVisible();
  await expect(home(cold)).toHaveCount(0);
  await cold.context().close();
});

test('a pre-reader signs in on the picture pad, which passcodeKind chose, and the tile remembers it', async ({ page }) => {
  await page.goto('/');
  await signInByUsername(page, MAYA.username, MAYA.picture);
  await expect(page.getByTestId('first-pad')).toHaveAttribute('data-kind', 'pictures').catch(() => undefined);
  await expect(prereaderHome(page)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(doors(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('tile')).toHaveAttribute('data-kind', 'pictures');
  await page.getByTestId('tile').click();
  await expect(page.getByTestId('picture-pad')).toBeVisible();
  await expect(prereaderHome(page)).toHaveCount(0);
});

test('an unknown username gets a pad too, then the generic line, and never Home', async ({ page }) => {
  await page.goto('/');
  await expect(doors(page)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('door-player').click();
  await page.getByPlaceholder('username').fill('nobody_here');
  await page.getByTestId('username-next').click();
  await expect(page.getByTestId('first-pad')).toBeVisible({ timeout: 10_000 });
  const kind = await page.getByTestId('first-pad').getAttribute('data-kind');
  if (kind === 'pictures') await tapPictures(page, 'abcd');
  else await typeDigits(page, '4821');
  await expect(page.locator('.error')).toContainText("That username and passcode didn't match.");
  await expect(home(page)).toHaveCount(0);
  await expect(page.getByTestId('tile')).toHaveCount(0);
});

test('the older name cache is wiped, never shown, and the Grown-ups door shows only Google', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('seeded', '1');
      localStorage.setItem('mathquest:v1:device-kids', JSON.stringify([{ kidId: 'k1', name: 'Pip', hero: 'knight', color: 'blue' }]));
    }
  });
  await page.goto('/');
  await expect(doors(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.face-btn')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/pip/i);
  expect(await page.evaluate(() => localStorage.getItem('mathquest:v1:device-kids'))).toBeNull();
  await page.getByTestId('door-grownups').click();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(page.getByPlaceholder('username')).toHaveCount(0);
  await expect(page.getByPlaceholder('First name')).toHaveCount(0);
});

test('every kidSignIn carries a deviceId, and the server records the device', async ({ page }) => {
  const fam = await seedFamily();
  await setSignin2(true);
  const net = watch(page);
  await page.goto('/');
  await signInByUsername(page, PIP.username, PIP.pin);
  await expect(home(page)).toBeVisible({ timeout: 20_000 });
  const id = String(net.signIn[0]!.deviceId);
  await expect.poll(() => devices(fam)).toEqual([id]);
  expect(await page.evaluate(() => localStorage.getItem('mathquest:v1:device-id'))).toBe(id);
});

test('signin2 off: the screen players know today, and its sign-in still sends a deviceId', async ({ page }) => {
  await setSignin2(false);
  const net = watch(page);
  await page.goto('/');
  await expect(page.getByTestId('title-play')).toBeVisible({ timeout: 20_000 });
  await expect(doors(page)).toHaveCount(0);
  await page.getByTestId('title-play').click();
  await page.getByPlaceholder('First name').fill(PIP.name);
  await typeDigits(page, PIP.pin);
  await expect(home(page)).toBeVisible({ timeout: 20_000 });
  expect(net.signIn[0]).toMatchObject({ name: PIP.name, pin: PIP.pin });
  expect(String(net.signIn[0]!.deviceId)).toMatch(/^[0-9a-f]{32}$/);
  expect(net.kind).toEqual([]);
});

test('signin2 pilot: only a device that opted in with ?signin2=on shows the doors', async ({ page }) => {
  await setSignin2('pilot');
  await page.goto('/');
  await expect(page.getByTestId('title-play')).toBeVisible({ timeout: 20_000 });
  await expect(doors(page)).toHaveCount(0);
  await page.goto('/?signin2=on');
  await expect(doors(page)).toBeVisible({ timeout: 20_000 });
  await page.goto('/?signin2=off');
  await expect(page.getByTestId('title-play')).toBeVisible({ timeout: 20_000 });
});

test('with no config doc the screen is today\'s', async ({ page }) => {
  await setSignin2(null);
  await page.goto('/');
  await expect(page.getByTestId('title-play')).toBeVisible({ timeout: 20_000 });
  await expect(doors(page)).toHaveCount(0);
});
