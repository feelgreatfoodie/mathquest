import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * The pre-reader Home fits a phone: no horizontal page scroll at 375, 393 and 430 px wide, and every button stays at
 * least 120 px. SHOP_SHOTS=<dir> writes PNGs there (keep them local). Names and ids are made up.
 */
const SHOTS = process.env.SHOP_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

for (const vp of [{ w: 375, h: 812 }, { w: 393, h: 852 }, { w: 430, h: 932 }, { w: 820, h: 1180 }]) {
  test(`pre-reader Home fits ${vp.w}x${vp.h}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.addInitScript(() => {
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
      localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: 'kidfit0000000000001', name: 'Pip', createdAt: 1, settings: { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }, game: { xp: 1, gems: 5, heroes: ['knight'], hero: 'knight', streakDays: 2, lastPlayedDay: null, bestCombo: 1 } }]));
    });
    await page.goto('/');
    await page.locator('.kid-card', { hasText: 'Pip' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    console.log(`WIDTH ${vp.w}: scrollWidth ${m.sw}`);
    expect(m.sw).toBeLessThanOrEqual(m.iw);
    for (const name of ['Play', 'Hero shop']) {
      const box = (await page.getByRole('button', { name }).boundingBox())!;
      expect(box.width, `${name} width`).toBeGreaterThanOrEqual(120);
      expect(box.height, `${name} height`).toBeGreaterThanOrEqual(120);
      expect(box.x, `${name} left`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${name} right`).toBeLessThanOrEqual(vp.w);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/prehome-${vp.w}x${vp.h}.png` });
  });
}
