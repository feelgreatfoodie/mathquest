import { expect, test } from '@playwright/test';

/**
 * Adventure works offline after the first load: the service worker precaches the Overworld chunk.
 * Runs only against a production build served by `vite preview` (the dev server has no service worker):
 *   VITE_DATA_MODE=local npm run build && npx vite preview --port 5497 &
 *   E2E_PREVIEW_PORT=5497 npx playwright test offline
 * Names and ids are made up.
 */
const PORT = process.env.E2E_PREVIEW_PORT;
test.skip(!PORT, 'set E2E_PREVIEW_PORT to a vite preview of a VITE_DATA_MODE=local build');
test.use({ viewport: { width: 820, height: 1180 }, serviceWorkers: 'allow' });

test('after one online visit, Adventure opens with the network off', async ({ page, context }) => {
  const base = `http://localhost:${PORT}`;
  await page.addInitScript(() => {
    if (!localStorage.getItem('mathquest:v1:kids')) {
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
      localStorage.setItem(
        'mathquest:v1:kids',
        JSON.stringify([{ id: 'kidoff0000000000001', name: 'Ada', createdAt: 1, settings: { tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 8, maxNew: 2, factGroupsUnlocked: 1, paceMultiplier: 3, modes: { overworld: true } }, game: { xp: 0, gems: 0, streakDays: 0, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]),
      );
    }
  });
  await page.goto(base);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.locator('.kid-card', { hasText: 'Ada' }).click();
  await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect(page.getByTestId('overworld')).toBeVisible();
  // Let the worker finish precaching, then cut the network and reload.
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.kid-card', { hasText: 'Ada' }).click();
  await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect(page.getByTestId('ow-canvas')).toBeVisible();
});
