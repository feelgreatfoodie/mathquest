import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';

/**
 * Before and after screenshots for style-3 (Adventure, shop, vault, Grown-ups). Skipped unless STYLE_SHOTS_DIR is set:
 *   STYLE_SHOTS_DIR=/path/to/dir npx playwright test styleShots3
 * Demo family only (Pip). Each PNG has a .txt beside it with the page text, so the shots can be leak-scanned as text.
 */
const DIR = process.env.STYLE_SHOTS_DIR;
const PIN = '2468'; // made up
const PIN_HASH = createHash('sha256').update(`mathquest:local:${PIN}`).digest('hex');
const KID = 'kidshots0000000001';
const SIZES = [
  { tag: '820x1180', width: 820, height: 1180 },
  { tag: '1024x768', width: 1024, height: 768 },
  { tag: '393x852', width: 393, height: 852 },
];

async function seed(page: Page) {
  await page.addInitScript(
    ({ pinHash, kid }) => {
      const w = window as unknown as Record<string, unknown>;
      class Utter { text: string; onend: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
      let a = 1234567;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      if (localStorage.getItem('mathquest:v1:kids')) return;
      const game = { xp: 240, gems: 60, streakDays: 3, lastPlayedDay: null, bestCombo: 5, heroes: ['knight', 'wizard'], hero: 'knight' };
      const settings = { shop2: true, vault: { on: true }, modes: { overworld: true }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 12, maxNew: 6, factGroupsUnlocked: 1, paceMultiplier: 3 };
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1, tourSeen: true }));
      localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name: 'Pip', createdAt: 1, settings, game }]));
      const now = Date.now();
      localStorage.setItem(`mathquest:v1:purchases:${kid}`, JSON.stringify([
        { id: 'p1', heroId: 'knight', cost: 0, at: now - 3 * 86_400_000 },
        { id: 'p2', heroId: 'wizard', cost: 25, at: now - 86_400_000 },
      ]));
    },
    { pinHash: PIN_HASH, kid: KID },
  );
}

async function shot(page: Page, tag: string, name: string) {
  mkdirSync(join(DIR!, tag), { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(DIR!, tag, `${name}.png`) });
  writeFileSync(join(DIR!, tag, `${name}.txt`), await page.evaluate(() => document.body.innerText));
}

for (const s of SIZES) {
  test.describe(`style shots 3 ${s.tag}`, () => {
    test.skip(!DIR, 'set STYLE_SHOTS_DIR');
    test.use({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 });

    test('adventure, shop, vault', async ({ page }) => {
      await seed(page);
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).click();
      await page.getByRole('button', { name: 'Adventure' }).click();
      await page.getByTestId('overworld').waitFor();
      await page.waitForTimeout(900);
      await shot(page, s.tag, 'adventure');
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).click();
      await page.getByRole('button', { name: 'Shop', exact: true }).click();
      await shot(page, s.tag, 'shop');
      await page.locator('[data-tab="vault"]').click();
      await page.getByTestId('vault').waitFor();
      await shot(page, s.tag, 'vault');
    });

    test('grown-ups, dark and light', async ({ page }) => {
      await seed(page);
      await page.goto('/');
      await page.getByRole('button', { name: /(grown-ups|parent) area/i }).click();
      for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
      await page.locator('.parent').waitFor();
      await page.waitForTimeout(600);
      await shot(page, s.tag, 'grownups-top');
      await page.locator('.gem-history').scrollIntoViewIfNeeded();
      await shot(page, s.tag, 'grownups-gems');
      const toggle = page.getByTestId('theme-toggle');
      if (await toggle.count()) {
        await toggle.click();
        await page.locator('.gem-history').scrollIntoViewIfNeeded();
        await shot(page, s.tag, 'grownups-gems-light');
        await page.evaluate(() => window.scrollTo(0, 0));
        await shot(page, s.tag, 'grownups-top-light');
      }
    });
  });
}
