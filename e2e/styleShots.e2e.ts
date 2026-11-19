import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';

/**
 * Before and after screenshots for the style PRs. Skipped unless STYLE_SHOTS_DIR is set:
 *   STYLE_SHOTS_DIR=/path/to/dir npx playwright test styleShots
 * Demo family only (Pip, a reader; Wren, a pre-reader). Each PNG has a .txt beside it with the page text,
 * so the shots can be leak-scanned as text (node scripts/check-private-ids.mjs --text <file>).
 */
const DIR = process.env.STYLE_SHOTS_DIR;
const LANDING_PORT = Number(process.env.E2E_LANDING_PORT) || 5198;
const SIZES = [
  { tag: '820x1180', width: 820, height: 1180 },
  { tag: '1024x768', width: 1024, height: 768 },
  { tag: '393x852', width: 393, height: 852 },
];

async function seedDemoFamily(page: Page) {
  await page.addInitScript(() => {
    let a = 1234567;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    if (localStorage.getItem('mathquest:v1:kids')) return;
    const game = (hero: string) => ({ xp: 240, gems: 31, streakDays: 3, lastPlayedDay: null, bestCombo: 5, heroes: [hero], hero });
    const reader = { modes: { overworld: false }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 12, maxNew: 6, factGroupsUnlocked: 1, paceMultiplier: 3 };
    const pre = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
    localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
    localStorage.setItem(
      'mathquest:v1:kids',
      JSON.stringify([
        { id: 'kidshots0000000001', name: 'Pip', createdAt: 1, settings: reader, game: game('knight') },
        { id: 'kidshots0000000002', name: 'Wren', createdAt: 2, settings: pre, game: game('knight') },
      ]),
    );
  });
}

async function shot(page: Page, tag: string, name: string) {
  mkdirSync(join(DIR!, tag), { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(DIR!, tag, `${name}.png`) });
  writeFileSync(join(DIR!, tag, `${name}.txt`), await page.evaluate(() => document.body.innerText));
}

for (const s of SIZES) {
  test.describe(`style shots ${s.tag}`, () => {
    test.skip(!DIR, 'set STYLE_SHOTS_DIR');
    test.use({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 });

    test('landing, kid and grown-ups', async ({ page }) => {
      await page.goto(`http://localhost:${LANDING_PORT}/`);
      await page.waitForSelector('.landing-tab, [data-testid="title-screen"]');
      await shot(page, s.tag, 'landing');
      const tab = page.locator('#landing-tab-parent');
      if (await tab.count()) {
        await tab.click();
        await shot(page, s.tag, 'landing-grownups');
      }
    });

    test('picker, home, question', async ({ page }) => {
      await seedDemoFamily(page);
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).waitFor();
      await shot(page, s.tag, 'picker');
      await page.locator('.kid-card', { hasText: 'Pip' }).click();
      await shot(page, s.tag, 'home-pip');
      await page.getByRole('button', { name: 'Start Quest' }).click();
      await page.locator('.keypad').waitFor();
      await shot(page, s.tag, 'question-pip');
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Wren' }).click();
      await shot(page, s.tag, 'home-wren');
      await page.getByRole('button', { name: 'Play' }).click();
      await page.locator('.early-numerals').waitFor();
      await shot(page, s.tag, 'question-wren');
    });
  });
}
