import { createHash, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/** The parent picks a start group per module; the kid doc keeps it in settings.groupsUnlocked. Made-up names and pin. */
const KID_ID = 'kidpreread0000000003';
const PARENT_PIN = String(randomInt(1000, 10000));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function seed(page: Page) {
  await page.addInitScript(({ kidId, pinHash }) => {
    if (localStorage.getItem('mathquest:v1:kids')) return;
    localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
    localStorage.setItem('mathquest:v1:kids', JSON.stringify([{
      id: kidId, name: 'Pip', createdAt: 1,
      settings: { learner: 'prereader', modules: { add10: true, sub10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 },
      game: { xp: 100, gems: 5, streakDays: 1, lastPlayedDay: null, bestCombo: 2, heroes: ['knight'], hero: 'knight' },
    }]));
  }, { kidId: KID_ID, pinHash: sha(`mathquest:local:${PARENT_PIN}`) });
}
const stored = (page: Page) => page.evaluate((id) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!).find((k: { id: string }) => k.id === id).settings, KID_ID);

test('the parent picks a start group per module and saves it', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Grown-ups area' }).click();
  for (const d of PARENT_PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  const add = page.getByLabel('Start Addition within 10 at');
  const sub = page.getByLabel('Start Subtraction within 10 at');
  await expect(add).toBeVisible();
  await expect(add.locator('option')).toHaveText(['1 · Sums to 5', '2 · Sums 6 to 10']);
  await expect(sub.locator('option')).toHaveText(['1 · Start with 5 or less', '2 · Start with 6 to 10']);
  expect(await add.inputValue()).toBe('1');
  await add.selectOption('2');
  await sub.selectOption('2');
  await page.getByLabel('Most new cards per run').selectOption('4');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  const s = await stored(page);
  expect(s.groupsUnlocked).toEqual({ add10: 2, sub10: 2 });
  expect(s.maxNew).toBe(4);
  expect(s.sessionSize).toBe(10);
});

test('a module that is off has no picker; a kid with no floor saves no groupsUnlocked key', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Grown-ups area' }).click();
  for (const d of PARENT_PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await page.getByLabel('Subtraction within 10', { exact: true }).uncheck();
  await expect(page.getByLabel('Start Subtraction within 10 at')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  expect((await stored(page)).groupsUnlocked ?? {}).toEqual({});
});
