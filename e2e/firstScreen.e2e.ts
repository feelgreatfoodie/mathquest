import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * L2 first screen (config/app.signin2), on the real FirstScreen in the test harness (e2e/harness/pin.html?mode=door), with fake
 * callables, so no Firebase and no network. Covers: no player name is visible before sign-in, at any viewport and in every view;
 * 120 px targets for pre-readers (doors, tiles, picture pad); the iPad fit guard for each view; and the screen's own flow.
 * The emulator spec (e2e/emulator/signin2.emulator.ts) covers the real server. Made-up usernames and passcodes.
 */
const URL_DOOR = '/e2e/harness/pin.html?mode=door';
const VIEWPORTS = [
  { w: 1024, h: 650 },
  { w: 1080, h: 700 },
  { w: 768, h: 900 },
  { w: 810, h: 960 },
  { w: 390, h: 844 },
  { w: 1366, h: 1024 },
];
const TILES = [
  { username: 'pip_runner', hero: 'knight', color: 'blue', kind: 'digits' },
  { username: 'maya_pic', hero: 'wizard', color: 'pink', kind: 'pictures' },
  { username: 'zed_ok', hero: 'knight', color: 'green', kind: 'digits' },
];
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);

async function seed(page: Page, tiles: object[] = TILES) {
  await page.addInitScript((t) => {
    localStorage.setItem('mathquest:v1:device-tiles', JSON.stringify(t));
    // The older cache holds display names. The two-door screen must never read it.
    localStorage.setItem('mathquest:v1:device-kids', JSON.stringify([{ kidId: 'k1', name: 'Pipname', hero: 'knight', color: 'blue' }]));
    const w = window as unknown as Record<string, unknown>;
    class Utter { text: string; lang = ''; rate = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(x: string) { this.text = x; } }
    w.SpeechSynthesisUtterance = Utter;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { setTimeout(() => u.onend?.(), 10); }, cancel() {}, getVoices() { return []; } } });
  }, tiles);
}

/** Everything a person or a screen reader can get from the page: the text, and every attribute value except what the viewer typed. */
async function visibleStrings(page: Page): Promise<string> {
  return page.evaluate(() => {
    const out: string[] = [document.body.innerText, document.title];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      for (const a of Array.from(el.attributes)) {
        if (a.name === 'value' && el instanceof HTMLInputElement) continue;
        out.push(`${a.name}=${a.value}`);
      }
    }
    return out.join('\n');
  });
}

const typeDigits = async (page: Page, code: string) => {
  for (const d of code) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).first().tap();
};

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

/** The views, each opened from a fresh load. `primary` is the control a player or a grown-up has to reach. */
const VIEWS: { name: string; open: (p: Page) => Promise<void>; primary: (p: Page) => Locator }[] = [
  { name: 'doors', open: async (p) => { await p.goto(URL_DOOR); await expect(p.getByTestId('first-doors')).toBeVisible(); }, primary: (p) => p.getByTestId('title-intro') },
  { name: 'username form', open: async (p) => { await p.goto(URL_DOOR); await p.getByTestId('door-player').tap(); await expect(p.getByTestId('first-username')).toBeVisible(); }, primary: (p) => p.getByTestId('first-back') },
  { name: 'digit pad (tile)', open: async (p) => { await p.goto(URL_DOOR); await p.locator('[data-testid="tile"][data-kind="digits"]').first().tap(); await expect(p.getByTestId('first-pad')).toBeVisible(); }, primary: (p) => p.locator('.keypad') },
  { name: 'picture pad (tile)', open: async (p) => { await p.goto(URL_DOOR); await p.locator('[data-testid="tile"][data-kind="pictures"]').tap(); await expect(p.getByTestId('picture-pad')).toBeVisible(); }, primary: (p) => p.locator('.picture-actions') },
  { name: 'grown-ups', open: async (p) => { await p.goto(`${URL_DOOR}&view=grownups`); await expect(p.getByTestId('first-grownups')).toBeVisible(); }, primary: (p) => p.getByTestId('first-back') },
];

for (const vp of VIEWPORTS) {
  test.describe(`first screen ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test('no player name or username is visible in any view before sign-in', async ({ page }) => {
      await seed(page);
      for (const v of VIEWS) {
        await v.open(page);
        const all = await visibleStrings(page);
        expect(all, `${v.name} shows a name`).not.toMatch(/pip|maya|zed|runner|pipname/i);
      }
      // The username the player types is theirs: it stays in the field and appears nowhere else.
      await page.goto(URL_DOOR);
      await page.getByTestId('door-player').tap();
      await page.getByPlaceholder('username').fill('Maya_Pic');
      await page.getByTestId('username-next').tap();
      await expect(page.getByTestId('picture-pad')).toBeVisible();
      expect(await visibleStrings(page)).not.toMatch(/maya|pic\b/i);
    });

    test('doors, tiles and the picture pad are at least 120 px', async ({ page }) => {
      await seed(page);
      await page.goto(URL_DOOR);
      const player = await box(page.getByTestId('door-player'));
      expect(player.height).toBeGreaterThanOrEqual(120);
      expect(player.width).toBeGreaterThanOrEqual(120);
      for (const t of await page.getByTestId('tile').all()) {
        const b = await box(t);
        expect(b.width).toBeGreaterThanOrEqual(120);
        expect(b.height).toBeGreaterThanOrEqual(120);
      }
      await page.locator('[data-testid="tile"][data-kind="pictures"]').tap();
      await expect(page.getByTestId('picture-pad')).toBeVisible();
      const buttons = await page.getByTestId('picture-pad').locator('button').all();
      expect(buttons.length).toBe(11);
      for (const b of buttons) {
        const bb = await box(b);
        expect(bb.width).toBeGreaterThanOrEqual(120);
        expect(bb.height).toBeGreaterThanOrEqual(120);
      }
    });
  });
}

// The iPad fit guard: no page scroll, and the primary control fully inside the viewport. The four iPad Safari sizes.
for (const vp of VIEWPORTS.slice(0, 4)) {
  test.describe(`ipad-fit first screen ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });
    for (const v of VIEWS) {
      test(`${v.name} fits`, async ({ page }) => {
        await seed(page);
        await v.open(page);
        await page.waitForTimeout(250);
        const scroll = await page.evaluate(() => ({ h: document.scrollingElement!.scrollHeight, ih: window.innerHeight }));
        expect.soft(scroll.h, 'page scrolls').toBeLessThanOrEqual(scroll.ih);
        const b = await box(v.primary(page));
        expect.soft(b.y, 'top').toBeGreaterThanOrEqual(-0.5);
        expect.soft(b.x, 'left').toBeGreaterThanOrEqual(-0.5);
        expect.soft(b.y + b.height, 'bottom').toBeLessThanOrEqual(vp.h + 0.5);
        expect.soft(b.x + b.width, 'right').toBeLessThanOrEqual(vp.w + 0.5);
      });
    }
  });
}

test.describe('first screen flow', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('a tile opens the pad for its player, and the passcode is still typed', async ({ page }) => {
    await seed(page);
    await page.goto(URL_DOOR);
    await expect(page.getByTestId('tile')).toHaveCount(3);
    await page.getByTestId('tile').first().tap();
    await expect(page.getByTestId('first-pad')).toHaveAttribute('data-kind', 'digits');
    expect(await calls(page)).toEqual(['kind:pip_runner']);
    await typeDigits(page, '2468');
    await expect.poll(() => calls(page)).toEqual(['kind:pip_runner', 'pip_runner:2468']);
  });

  test('a wrong passcode shakes the dots, shows the generic line and keeps the pad', async ({ page }) => {
    await seed(page);
    await page.goto(URL_DOOR);
    await page.getByTestId('tile').first().tap();
    await typeDigits(page, '0000');
    await expect(page.locator('.error')).toHaveText("That username and passcode didn't match.");
    await expect(page.locator('.pin-dots.shake')).toHaveCount(1);
    await expect(page.getByTestId('first-pad')).toBeVisible();
  });

  test('the username form lowercases the name, asks passcodeKind, and shows the pad it answers with', async ({ page }) => {
    await seed(page, []);
    await page.goto(URL_DOOR);
    await expect(page.getByTestId('tile')).toHaveCount(0);
    await page.getByTestId('door-player').tap();
    await expect(page.getByTestId('username-next')).toBeDisabled();
    await page.getByPlaceholder('username').fill('Sam_Pic');
    await page.getByTestId('username-next').tap();
    await expect(page.getByTestId('first-pad')).toHaveAttribute('data-kind', 'pictures');
    expect(await calls(page)).toEqual(['kind:sam_pic']);
    for (const n of [0, 3, 6, 1]) await page.locator(`.picture-key[data-icon="${n}"]`).tap();
    await expect.poll(() => calls(page)).toEqual(['kind:sam_pic', 'sam_pic:adgb']);
  });

  test('the username form refuses a name the server could never hold', async ({ page }) => {
    await seed(page, []);
    await page.goto(URL_DOOR);
    await page.getByTestId('door-player').tap();
    for (const bad of ['ab', 'has space', 'bad-name', 'x'.repeat(21)]) {
      await page.getByPlaceholder('username').fill(bad);
      // maxLength stops the 21st character, so that one holds 20 valid characters: valid.
      if (bad.length > 20) continue;
      await expect(page.getByTestId('username-next')).toBeDisabled();
    }
    expect(await calls(page)).toEqual([]);
  });

  test('a locked passcodeKind shows its calm line on the username form and the player stays there', async ({ page }) => {
    await seed(page, []);
    await page.goto(URL_DOOR);
    await page.getByTestId('door-player').tap();
    await page.getByPlaceholder('username').fill('lock_me');
    await page.getByTestId('username-next').tap();
    await expect(page.getByRole('alert')).toHaveText('Too many tries. Wait a minute and try again.');
    await expect(page.getByTestId('first-username')).toBeVisible();
  });

  test('no connection shows a plain line and no pad', async ({ page }) => {
    await seed(page);
    await page.goto(URL_DOOR);
    await page.getByTestId('door-player').tap();
    await page.getByPlaceholder('username').fill('down_now');
    await page.getByTestId('username-next').tap();
    await expect(page.getByRole('alert')).toContainText('Could not reach Math Quest');
    await expect(page.getByTestId('first-pad')).toHaveCount(0);
  });

  test('Not me on a tile pad returns to the doors, and on a typed pad returns to the form', async ({ page }) => {
    await seed(page);
    await page.goto(URL_DOOR);
    await page.getByTestId('tile').first().tap();
    await page.getByRole('button', { name: 'Cancel' }).tap();
    await expect(page.getByTestId('first-doors')).toBeVisible();
    await page.getByTestId('door-player').tap();
    await page.getByPlaceholder('username').fill('maya_pic');
    await page.getByTestId('username-next').tap();
    await page.getByRole('button', { name: 'Not me' }).tap();
    await expect(page.getByTestId('first-username')).toBeVisible();
  });

  test('the Grown-ups door opens only the Google sign-in: no player form, no tiles', async ({ page }) => {
    await seed(page);
    await page.goto(URL_DOOR);
    await page.getByTestId('door-grownups').tap();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.getByTestId('tile')).toHaveCount(0);
    await expect(page.getByPlaceholder('username')).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign in with Google' }).tap();
    expect(await calls(page)).toEqual(['google']);
  });

  test('stored names in the old cache never reach the screen, and a stored name in a tile is dropped', async ({ page }) => {
    await seed(page, [{ username: 'pip_runner', hero: 'knight', color: 'blue', kind: 'digits', name: 'Pipname' }]);
    await page.goto(URL_DOOR);
    await expect(page.getByTestId('tile')).toHaveCount(1);
    expect(await visibleStrings(page)).not.toMatch(/pipname/i);
  });
});
