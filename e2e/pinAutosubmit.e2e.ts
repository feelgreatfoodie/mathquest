import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * PIN screens sign in on the 4th digit, with no GO key. System Chrome at 820x1180 with touch emulation
 * (WebKit is blocked on this host). Names and PINs are made up. SCREENSHOTS=1 writes PNGs under docs/screenshots/.
 * The kid sign-in screens run on a test page (e2e/harness/pin.html) that mounts the real Landing and PinPad with a
 * fake sign-in. The parent PIN, create and confirm screens run in the real app on local data.
 */
test.use({ viewport: { width: 820, height: 1180 } });

const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PARENT_PIN = String(randomInt(1000, 10000));
const WRONG_PIN = PARENT_PIN === '0000' ? '1111' : '0000';
const KID = 'Pip';

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
const key = (page: Page, d: string) => page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) });
async function tap(page: Page, pin: string) {
  for (const d of pin) await key(page, d).tap();
}
const dotsOn = (page: Page) => page.locator('.pin-dot.is-on').count();
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
async function noGo(page: Page) {
  await expect(page.locator('.keypad')).toBeVisible();
  await expect(page.locator('.key-go')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'GO', exact: true })).toHaveCount(0);
}

test.describe('kid sign-in tab', () => {
  test('the 4th digit signs in once, with no GO key', async ({ page }) => {
    await page.goto('/e2e/harness/pin.html?mode=kid');
    await noGo(page);
    await page.getByPlaceholder('First name').fill(KID);
    await tap(page, '1234');
    await expect.poll(() => calls(page)).toEqual([`${KID}:1234`]);
    await shot(page, 'pin-kid-signin');
  });

  test('a 5th tap and a double tap while checking do not send twice', async ({ page }) => {
    await page.goto('/e2e/harness/pin.html?mode=kid&slow=900');
    await page.getByPlaceholder('First name').fill(KID);
    await tap(page, '1234');
    await expect.poll(() => calls(page)).toHaveLength(1);
    await expect(page.getByText('Checking')).toBeVisible();
    expect(await dotsOn(page)).toBe(4);
    // A 5th tap, a double tap on the 4th digit's key, and the 5th digit from a hardware keyboard.
    await key(page, '5').dispatchEvent('click');
    await key(page, '4').dispatchEvent('click');
    await key(page, '4').dispatchEvent('click');
    await page.keyboard.press('5');
    await expect(page.locator('.keypad .key').first()).toBeDisabled();
    await shot(page, 'pin-checking');
    await page.waitForTimeout(1500);
    expect(await calls(page)).toEqual([`${KID}:1234`]);
  });

  test('a wrong PIN clears the dots, shows the error, and the kid retypes at once', async ({ page }) => {
    await page.goto('/e2e/harness/pin.html?mode=kid');
    await page.getByPlaceholder('First name').fill(KID);
    await tap(page, '0000');
    await expect(page.locator('.error')).toContainText("didn't match");
    await expect.poll(() => dotsOn(page)).toBe(0);
    await expect(page.locator('.pin-dots')).toHaveClass(/shake/);
    await shot(page, 'pin-wrong');
    await tap(page, '1234');
    await expect.poll(() => calls(page)).toEqual([`${KID}:0000`, `${KID}:1234`]);
    await expect(page.locator('.error')).toHaveCount(0);
  });

  test('digits typed into the name field do not enter the PIN (the keydown bug)', async ({ page }) => {
    await page.goto('/e2e/harness/pin.html?mode=kid');
    const name = page.getByPlaceholder('First name');
    await name.focus();
    await page.keyboard.type('Pip4');
    await expect(name).toHaveValue('Pip4');
    expect(await dotsOn(page)).toBe(0);
    await page.keyboard.type('123');
    expect(await dotsOn(page)).toBe(0);
    expect(await calls(page)).toEqual([]);
  });

  test('digits from a hardware keyboard with no field focused still enter the PIN', async ({ page }) => {
    await page.goto('/e2e/harness/pin.html?mode=kid');
    await page.getByPlaceholder('First name').fill(KID);
    await page.locator('h2').click();
    await page.keyboard.type('1234');
    await expect.poll(() => calls(page)).toEqual([`${KID}:1234`]);
  });

  test('an empty name on the 4th digit focuses the name field and does not sign in', async ({ page }) => {
    await page.goto('/e2e/harness/pin.html?mode=kid');
    await tap(page, '1234');
    await expect(page.getByText('Type your first name first')).toBeVisible();
    await expect(page.getByPlaceholder('First name')).toBeFocused();
    await expect.poll(() => dotsOn(page)).toBe(0);
    expect(await calls(page)).toEqual([]);
  });

  test('tapping a keypad digit closes the name keyboard', async ({ page }) => {
    await page.goto('/e2e/harness/pin.html?mode=kid');
    await page.getByPlaceholder('First name').focus();
    await key(page, '1').tap();
    await expect(page.getByPlaceholder('First name')).not.toBeFocused();
    expect(await dotsOn(page)).toBe(1);
  });
});

test('a PinPad on its own (picker, then kid PIN) signs in on the 4th digit once', async ({ page }) => {
  await page.goto('/e2e/harness/pin.html?mode=pad&slow=600');
  await noGo(page);
  await tap(page, '4321');
  await key(page, '9').dispatchEvent('click');
  await page.waitForTimeout(1000);
  expect(await calls(page)).toEqual(['4321']);
});

async function seedParent(page: Page, withKid: boolean) {
  await page.addInitScript(
    ({ pinHash, withKid }) => {
      if (localStorage.getItem('mathquest:v1:family')) return;
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
      if (withKid)
        localStorage.setItem(
          'mathquest:v1:kids',
          JSON.stringify([
            {
              id: 'kidpin000000000001', name: 'Pip', createdAt: 1,
              settings: { modes: { overworld: false }, tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 },
              game: { xp: 0, gems: 0, streakDays: 0, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' },
            },
          ]),
        );
    },
    { pinHash: sha(`mathquest:local:${PARENT_PIN}`), withKid },
  );
}

test.describe('parent PIN screens (real app, local data)', () => {
  test('parent PIN signs in on the 4th digit, wrong PIN clears and retries', async ({ page }) => {
    await seedParent(page, false);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Parent PIN' })).toBeVisible();
    await noGo(page);
    await tap(page, WRONG_PIN);
    await expect(page.locator('.error')).toContainText('Wrong PIN');
    await expect.poll(() => dotsOn(page)).toBe(0);
    await tap(page, PARENT_PIN);
    await expect(page.getByRole('heading', { name: 'Parent area' })).toBeVisible();
    await shot(page, 'pin-parent');
  });

  test('create and confirm a parent PIN: 4 taps each, no GO', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Make a parent PIN' })).toBeVisible();
    await noGo(page);
    await tap(page, PARENT_PIN);
    await expect(page.getByRole('heading', { name: 'Type it again' })).toBeVisible();
    await noGo(page);
    await tap(page, PARENT_PIN);
    await expect(page.getByRole('heading', { name: 'Add a player' })).toBeVisible();
  });

  test('Run keeps its GO key', async ({ page }) => {
    await seedParent(page, true);
    await page.goto('/');
    await page.locator('.kid-card', { hasText: 'Pip' }).click();
    await page.getByRole('button', { name: 'Start Quest' }).click();
    await expect(page.locator('.keypad .key-go')).toBeVisible();
  });
});
