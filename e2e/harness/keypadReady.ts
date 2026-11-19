import { expect, type Page } from '@playwright/test';

/**
 * Call right after a reader clicks Start Quest (or Play again). The plan shuffles new skills in, so the run opens
 * on the keypad or on a "Let me try one!" teach card. This waits for whichever shows, goes past the card, then
 * requires the keypad. Pre-readers have no keypad, so do not use it for them.
 * onTeach runs while the card is up (a screenshot, for example). Returns true when a card was shown.
 */
export async function keypadReady(page: Page, onTeach?: () => Promise<void>): Promise<boolean> {
  const teach = page.getByRole('button', { name: 'Let me try one!' });
  await expect(page.locator('.keypad').or(teach)).toBeVisible();
  const sawTeach = await teach.isVisible();
  if (sawTeach) {
    await onTeach?.();
    await teach.click();
  }
  await expect(page.locator('.keypad')).toBeVisible();
  return sawTeach;
}
