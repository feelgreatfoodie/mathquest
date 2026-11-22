import { expect, test } from '@playwright/test';
import { PRE_ID, holdHome, phase, seed } from './harness/lightning';

/**
 * Lightning Round with Make 10 and Missing number on, picture player, 1024x768. Every card shows the form its module shows in
 * Dungeon ("4 + ? = 10"), and its answer is one of the 3 choices exactly once. Fixture player, made-up id.
 * LIGHTNING_FIX_SHOT=1 rewrites docs/screenshots/lightning-fix/make10-1024x768.png.
 */
test.use({ viewport: { width: 1024, height: 768 } });

test('pre-reader: make 10 and missing number cards read "a + ? = total" and carry their answer among 3 choices', async ({ page }) => {
  await seed(page, { learner: 'prereader', delay: 4000, make10: true });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).tap();
  await page.getByTestId('home-lightning').tap();
  await expect(page.getByTestId('lightning')).toBeVisible();
  expect(PRE_ID).toBeTruthy();

  let gapCards = 0;
  let shot = !process.env.LIGHTNING_FIX_SHOT;
  for (let card = 0; card < 14; card++) {
    await expect.poll(() => phase(page)).toBe('ask');
    const text = (await page.locator('.lr-card .math').innerText()).replace(/\s+/g, ' ').trim();
    const choices = (await page.locator('.lr-choice').allTextContents()).map((t) => Number(t.trim()));
    expect(choices).toHaveLength(3);
    expect(new Set(choices).size).toBe(3);
    expect(choices.every((c) => c >= 0)).toBe(true);
    const gap = /^(\d+) \+ \? = (\d+)$/.exec(text);
    const sum = /^(\d+) ([+−]) (\d+) = \?$/.exec(text);
    expect(gap ?? sum, `card shows "${text}"`).not.toBeNull();
    const answer = gap ? Number(gap[2]) - Number(gap[1]) : sum![2] === '+' ? Number(sum![1]) + Number(sum![3]) : Number(sum![1]) - Number(sum![3]);
    expect(choices.filter((c) => c === answer), `"${text}" answer ${answer} among ${choices}`).toHaveLength(1);
    const flagged = await page.locator('.lr-choice[data-answer="true"]').allTextContents();
    expect(flagged.map((t) => Number(t.trim()))).toEqual([answer]);
    if (gap) gapCards++;
    if (gap && !shot) {
      await page.screenshot({ path: 'docs/screenshots/lightning-fix/make10-1024x768.png' });
      shot = true;
    }
    await page.locator('.lr-choice[data-answer="true"]').tap();
    await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'ask');
  }
  expect(gapCards).toBeGreaterThan(0);
  await holdHome(page);
  await expect(page.getByTestId('lr-end')).toBeVisible();
});
