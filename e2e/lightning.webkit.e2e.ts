import { expect, test } from '@playwright/test';
import { PRE_ID, READER_ID, answerOnScreen, holdHome, phase, seed, spoken, stored, typeAnswer } from './harness/lightning';

/**
 * Lightning Round in WebKit (Safari on iPad): the keypad hit, the ring reveal with one copy, the end screen, and the pre-reader's
 * 3 big choices. Taps, not clicks. Made-up names and ids. The voice and the sounds are stubbed.
 */
test.use({ viewport: { width: 820, height: 1180 } });

test('reader: a hit, a reveal, a copy and the end screen', async ({ page }) => {
  await seed(page, { learner: 'reader', delay: 1000 });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).tap();
  await page.getByTestId('home-lightning').tap();
  await expect(page.getByTestId('lightning')).toBeVisible();
  await expect.poll(() => phase(page)).toBe('ask');
  await typeAnswer(page, await answerOnScreen(page));
  await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'hit');
  await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'ask');
  let revealed = false;
  for (let i = 0; i < 40 && !revealed; i++) {
    if ((await page.getByTestId('lightning').getAttribute('data-delay')) === '1500') {
      await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'miss', { timeout: 4000 });
      revealed = true;
      break;
    }
    await typeAnswer(page, await answerOnScreen(page));
    await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'ask');
  }
  expect(revealed).toBe(true);
  await expect(page.getByTestId('lr-answer')).toBeVisible();
  await typeAnswer(page, Number(await page.getByTestId('lr-answer').textContent()));
  await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'ask');
  await holdHome(page);
  await expect(page.getByTestId('lr-end')).toBeVisible();
  const seeded = await page.evaluate(() => (window as unknown as { __seedCards: Record<string, { fsrs: unknown }> }).__seedCards);
  const now = (await stored(page, READER_ID, 'cards')) as Record<string, { fsrs: unknown }>;
  for (const id of Object.keys(seeded)) expect(JSON.stringify(now[id]!.fsrs)).toBe(JSON.stringify(seeded[id]!.fsrs));
});

test('pre-reader: 3 choices of at least 120 px and a spoken question', async ({ page }) => {
  await seed(page, { learner: 'prereader' });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).tap();
  await page.getByTestId('home-lightning').tap();
  await expect(page.getByTestId('lightning')).toBeVisible();
  const choices = page.locator('.lr-choice');
  await expect(choices).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const b = (await choices.nth(i).boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(119.5);
    expect(b.height).toBeGreaterThanOrEqual(119.5);
  }
  expect((await spoken(page)).length).toBeGreaterThan(0);
  await page.locator('.lr-choice[data-answer="true"]').tap();
  await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'ask');
  await holdHome(page);
  await expect(page.getByTestId('lr-end')).toBeVisible();
  const sessions = ((await stored(page, PRE_ID, 'sessions')) as { mode: string }[]).filter((s) => s.mode === 'lightning');
  expect(sessions).toHaveLength(1);
});
