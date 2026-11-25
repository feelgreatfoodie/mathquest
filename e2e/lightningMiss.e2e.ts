import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { holdHome, phase, seed, typeAnswer } from './harness/lightning';

/**
 * Lightning miss state on an iPad viewport: the ring closes, the prompt names the number, the keypad is live and fully on screen,
 * and typing the named number moves on. LIGHTNING_MISS_SHOT=<path> writes the 1024x768 PNG. Made-up names and ids.
 */
for (const vp of [{ w: 1024, h: 768 }, { w: 1024, h: 650 }, { w: 820, h: 1180 }]) {
  test(`reader miss at ${vp.w}x${vp.h}: prompt visible, keypad live and on screen, the named number moves on`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await seed(page, { learner: 'reader', delay: 1000 });
    await page.goto('/');
    await page.locator('.kid-card', { hasText: 'Pip' }).tap();
    await page.getByTestId('home-lightning').tap();
    await expect(page.getByTestId('lightning')).toBeVisible();
    await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'miss', { timeout: 6000 });

    const prompt = page.getByTestId('lr-copy');
    await expect(prompt).toHaveText(/^Type \d+ to keep going$/);
    const number = Number((await prompt.textContent())!.match(/\d+/)![0]);
    await expect(page.getByTestId('lr-typed')).toHaveClass(/is-prompt/);
    const vh = vp.h;
    for (const box of [await prompt.boundingBox(), await page.locator('.keypad').boundingBox()]) {
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
    }
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true);
    if (vp.w === 1024 && vp.h === 768 && process.env.LIGHTNING_MISS_SHOT) {
      mkdirSync(process.env.LIGHTNING_MISS_SHOT.replace(/\/[^/]+$/, ''), { recursive: true });
      await page.screenshot({ path: process.env.LIGHTNING_MISS_SHOT });
    }

    await typeAnswer(page, number);
    await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'ask');
    expect(await phase(page)).toBe('ask');
    await holdHome(page);
  });
}
