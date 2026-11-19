import { expect, test, type Page } from '@playwright/test';
import { FACTS } from '../src/engine/modules/facts';

/**
 * The Adventure top bar is one row at 820x1180 and 1024x768, for a reader and a pre-reader, with the chest count showing.
 * Names and ids are made up. A second row costs the map 60 to 130 px and moves the monsters under the bar.
 */
const KID = 'kidhud0000000000001';
const READER = { tracks: { facts: true, multidigit: false, fractions: false }, modes: { overworld: true }, sessionSize: 8, maxNew: 2, factGroupsUnlocked: 1, paceMultiplier: 3 };
const PRE = { learner: 'prereader', modules: { add10: true }, modes: { overworld: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const SIZES = [{ w: 820, h: 1180 }, { w: 1024, h: 768 }];

const DAY = 86_400_000;
/** Ten seen, due cards: ten monsters wait, so the bar shows 8 sprites and "+2". */
function dueCards(now: number) {
  return Object.fromEntries(
    FACTS.groups![0]!.cardIds.slice(0, 10).map((id) => [
      id,
      { id, attempts: 4, correct: 4, recentMs: [2500, 2600], lastRating: 3, updatedAt: now - 3 * DAY, day: '2000-01-01', dayGraded: 1, lastResults: [true, true],
        fsrs: { due: now - DAY, stability: 5, difficulty: 5, elapsed_days: 3, scheduled_days: 5, learning_steps: 0, reps: 3, lapses: 0, state: 2, last_review: now - 3 * DAY } },
    ]),
  );
}

async function seed(page: Page, settings: object, cards?: object) {
  await page.addInitScript(
    ({ kid, settings }) => {
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name: 'Ada', createdAt: 1, settings, game: { xp: 0, gems: 5, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
        if (cards) localStorage.setItem(`mathquest:v1:cards:${kid}`, JSON.stringify(cards));
      }
    },
    { kid: KID, settings, cards: cards ?? null },
  );
}

async function hud(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.ow-hud') as HTMLElement;
    const r = bar.getBoundingClientRect();
    const kids = [...bar.children].map((c) => {
      const b = c.getBoundingClientRect();
      return { cls: (c as HTMLElement).className.toString().slice(0, 40), top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) };
    });
    return { w: window.innerWidth, height: Math.round(r.height), right: Math.round(r.right), scrollW: bar.scrollWidth, kids, rows: new Set(kids.map((k) => Math.round((k.top + k.bottom) / 2 / 20))).size, chests: !!document.querySelector('[data-testid="ow-chests"]') };
  });
}

for (const [name, settings, busy] of [['reader', READER, false], ['reader, 10 monsters', READER, true], ['prereader', PRE, false]] as const)
  for (const { w, h } of SIZES)
    test(`${name} ${w}x${h}: the Adventure top bar is a single row with the chest count showing`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page, settings, busy ? dueCards(Date.now()) : undefined);
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Ada' }).click();
      await page.locator('[data-mode="overworld"]').first().click();
      await expect(page.getByTestId('overworld')).toBeVisible();
      await expect(page.getByTestId('ow-chests')).toBeVisible();
      await page.waitForTimeout(400);
      const m = await hud(page);
      expect(m.chests).toBe(true);
      const home = page.locator('.ow-hud .hold-btn');
      const mute = page.locator('.ow-hud .mute-btn');
      const [hb, mb, bar] = [await home.boundingBox(), await mute.boundingBox(), await page.locator('.ow-hud').boundingBox()];
      expect(hb && mb && bar).toBeTruthy();
      // Single row: every direct child of the bar sits on the same row, so the bar is no taller than its tallest child.
      const tallest = Math.max(...m.kids.map((k) => k.bottom - k.top));
      expect(bar!.height, 'bar height is one row').toBeLessThanOrEqual(tallest + 24);
      expect(m.rows, 'rows of items, by vertical centre').toBe(1);
      expect(mb!.x + mb!.width, 'mute inside the bar').toBeLessThanOrEqual(w);
      expect(hb!.x, 'Home inside').toBeGreaterThanOrEqual(0);
      expect(m.scrollW, 'no sideways overflow in the bar').toBeLessThanOrEqual(m.w);
    });
