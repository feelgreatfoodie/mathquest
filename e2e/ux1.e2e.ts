import { expect, test, type Page } from '@playwright/test';

/**
 * UX-1: leaving a run on an insecure origin, the picker with two heroes, and the miss screen.
 * Screenshots go to docs/screenshots/ux1 when SCREENSHOTS=1. Names and ids are made up.
 */
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/ux1' : null;
const settings = { tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 12, maxNew: 6, factGroupsUnlocked: 1, paceMultiplier: 3 };
const game = { xp: 0, gems: 0, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' };

async function seed(page: Page, kids: unknown[], noUuid = false) {
  await page.addInitScript(
    ({ kids, noUuid }) => {
      if (noUuid) {
        // An insecure http origin has no crypto.randomUUID.
        Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
      }
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify(kids));
      }
    },
    { kids, noUuid },
  );
}

test.use({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });

test('picker: two players show two heroes and colors, the whole card is the tap target', async ({ page }) => {
  await seed(page, [
    { id: 'kidux10000000000001', name: 'Ann', createdAt: 1, settings, game, avatar: { hero: 'wizard', color: 'purple' } },
    { id: 'kidux10000000000002', name: 'Bo', createdAt: 2, settings: { ...settings, learner: 'prereader', modules: { add10: true } }, game, avatar: { hero: 'dragon', color: 'orange' } },
  ]);
  await page.goto('/');
  const cards = page.locator('button.kid-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveAttribute('data-hero', 'wizard');
  await expect(cards.nth(1)).toHaveAttribute('data-hero', 'dragon');
  const box = await cards.nth(0).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(240);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-picker-820x1180.png` });
  await cards.nth(1).click(); // tap the face, not the name: the whole card is one button
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('quit on an http origin (no crypto.randomUUID): the hold leaves the run and the summary opens', async ({ page }) => {
  await seed(page, [{ id: 'kidux10000000000003', name: 'Cy', createdAt: 1, settings, game }], true);
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Cy' }).click();
  await page.getByRole('button', { name: 'Start Quest' }).click();
  await expect(page.locator('.keypad')).toBeVisible();
  for (const d of '9999') await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await page.locator('.key-go').click();
  await expect(page.locator('.answer-fixed')).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  const house = page.locator('.hold-btn');
  const b = (await house.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await expect(page.locator('.run')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.toasts')).toHaveCount(0); // the save worked, so no failure toast
});
