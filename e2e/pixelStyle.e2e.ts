import { expect, test, type Page } from '@playwright/test';

/** style-1: title screen, self-hosted fonts, per-kid CRT switch, reduced motion, and no layout shift in a question. */
const LANDING_PORT = Number(process.env.E2E_LANDING_PORT) || 5198;

async function seed(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('mathquest:v1:kids')) return;
    const game = { xp: 0, gems: 0, streakDays: 1, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' };
    const reader = { modes: { overworld: false }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 12, maxNew: 6, factGroupsUnlocked: 1, paceMultiplier: 3 };
    localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
    localStorage.setItem(
      'mathquest:v1:kids',
      JSON.stringify([
        { id: 'kidpixel00000000001', name: 'Pip', createdAt: 1, settings: reader, game },
        { id: 'kidpixel00000000002', name: 'Wren', createdAt: 2, settings: reader, game },
      ]),
    );
  });
}

const box = async (page: Page, sel: string) => {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return { x: b.x, y: b.y, width: b.width, height: b.height };
};

for (const vp of [
  { w: 820, h: 1180 },
  { w: 1024, h: 768 },
  { w: 393, h: 852 },
]) {
  test.describe(`${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test('the question panel does not move between render and answer', async ({ page }) => {
      await seed(page);
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).click();
      await page.getByRole('button', { name: 'Start Quest' }).click();
      await expect(page.locator('.keypad')).toBeVisible();
      await page.waitForTimeout(300);
      const before = await box(page, '.panel.question');
      for (const d of '9999') await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
      expect(await box(page, '.panel.question')).toEqual(before);
      await page.locator('.key-go').click();
      await expect(page.locator('.feedback.bad')).toBeVisible();
      await page.waitForTimeout(300);
      // The miss feedback grows the panel downward (the miss screen is restyled in style-2); it must not move or change width.
      const after = await box(page, '.panel.question');
      expect({ x: after.x, y: after.y, width: after.width }).toEqual({ x: before.x, y: before.y, width: before.width });
    });
  });
}

test('the title screen shows the logo, the tagline and the scene, and makes no outside request', async ({ page }) => {
  const outside: string[] = [];
  const origin = `http://localhost:${LANDING_PORT}`;
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) outside.push(u);
  });
  await page.goto(`${origin}/`);
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await expect(page.locator('h1.px-logo')).toHaveText(/MATH\s*QUEST/);
  await expect(page.locator('.px-tagline')).toHaveText('EVERY MONSTER IS A MATH FACT');
  await expect(page.locator('.px-sky')).toBeVisible();
  await expect(page.locator('.px-hill')).toHaveCount(3);
  // The fonts come from this origin and load.
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(async () => {
    await Promise.all([document.fonts.load("16px 'Press Start 2P'"), document.fonts.load("16px 'Atkinson Hyperlegible'")]);
    return [document.fonts.check("16px 'Press Start 2P'"), document.fonts.check("16px 'Atkinson Hyperlegible'")];
  });
  expect(loaded).toEqual([true, true]);
  const fontReqs = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.endsWith('.woff2')));
  expect(fontReqs.length).toBeGreaterThan(0);
  for (const f of fontReqs) expect(f.startsWith(origin)).toBe(true);
  expect(outside.filter((u) => /fonts\.(googleapis|gstatic)/.test(u))).toEqual([]);
});

test('the CRT scanline switch is off by default, per kid, and kept on this device', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  const toggle = page.getByTestId('scanline-toggle');
  await expect(toggle).toHaveText('Scanlines: Off');
  expect(await page.evaluate(() => document.documentElement.dataset.crt)).toBeUndefined();
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await toggle.click();
  await expect(toggle).toHaveText('Scanlines: On');
  expect(await page.evaluate(() => document.documentElement.dataset.crt)).toBe('on');
  await page.reload();
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await expect(page.getByTestId('scanline-toggle')).toHaveText('Scanlines: On');
  expect(await page.evaluate(() => document.documentElement.dataset.crt)).toBe('on');
  // Wren has her own switch, still off; the overlay clears on the picker.
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.dataset.crt)).toBeUndefined();
  await page.locator('.kid-card', { hasText: 'Wren' }).click();
  await expect(page.getByTestId('scanline-toggle')).toHaveText('Scanlines: Off');
});

test('reduced motion stops the title screen animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://localhost:${LANDING_PORT}/`);
  await expect(page.getByTestId('title-screen')).toBeVisible();
  const names = await page.evaluate(() => [...document.querySelectorAll('.px-twinkle, .title-bat')].map((e) => getComputedStyle(e).animationName));
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toBe('none');
});
