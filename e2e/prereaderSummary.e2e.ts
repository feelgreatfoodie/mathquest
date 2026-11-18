import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * prereader-summary: the picture-only end screen, at 820x1180 with touch, on a synthetic profile (add10 only).
 * Names, ids and the parent PIN are made up per run. The voice and WebAudio are stubbed.
 * SCREENSHOTS=1 writes the PNGs under docs/screenshots/.
 */
const KID_ID = 'kidsummary00000000001';
const PARENT_PIN = String(randomInt(1000, 10000));
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
test.use({ viewport: { width: 820, height: 1180 } });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface GameSeed { xp: number; gems: number }

async function seed(page: Page, game: GameSeed, learner: 'prereader' | 'reader' = 'prereader') {
  const settings =
    learner === 'prereader'
      ? { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }
      : { tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
  await page.addInitScript(
    ({ kidId, settings, pinHash, game }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
      class Utter {
        text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null;
        onend: (() => void) | null = null; onerror: (() => void) | null = null;
        constructor(t: string) { this.text = t; }
      }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); },
          cancel() {},
          getVoices() { return []; },
        },
      });
      w.AudioContext = class {
        currentTime = 0; destination = {};
        resume() { return Promise.resolve(); }
        createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      };
      // A save that fails on demand: the kid doc write throws while __failSave is set.
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (w.__failSave && k === 'mathquest:v1:kids') throw new Error('quota (test)');
        return set.call(this, k, v);
      };
      const d = new Date(Date.now() - 86_400_000);
      const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([
          { id: kidId, name: 'Pip', createdAt: 1, settings, game: { ...game, streakDays: 3, lastPlayedDay: yesterday, bestCombo: 0, heroes: ['knight'], hero: 'knight' } },
        ]));
      }
    },
    { kidId: KID_ID, settings, pinHash: sha(`mathquest:local:${PARENT_PIN}`), game },
  );
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
const storedGame = (page: Page) =>
  page.evaluate((id) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!).find((k: { id: string }) => k.id === id).game as { gems: number; xp: number }, KID_ID);
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/prereader-summary-${name}.png` });
}

/** Plays a whole run, every answer right, and returns once the end screen is up. */
async function playRun(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  for (let guard = 0; guard < 60; guard++) {
    if (await page.locator('.big-stars').count()) return;
    const right = page.locator('.choice[data-answer="true"]');
    if (await right.count()) await right.first().click({ timeout: 500 }).catch(() => undefined);
    await page.waitForTimeout(60);
  }
  throw new Error('the run did not end');
}

/** Every visible text node on the summary: numerals, or at most 2 words. */
async function textNodes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.querySelector('.sum')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').trim();
      const el = n.parentElement!;
      if (t && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden') out.push(t);
    }
    return out;
  });
}

test('end screen: stars, gems total equal to storage, level bar, map, streak, 3 big buttons, no sentences', async ({ page }) => {
  await seed(page, { xp: 0, gems: 70 });
  await playRun(page);
  const t0 = Date.now();

  await expect(page.locator('.sum[data-step="stars"]')).toBeVisible();
  await shot(page, '1-stars');
  await expect(page.locator('.sum[data-step="gems"]')).toBeVisible({ timeout: 4000 });
  await expect(page.getByTestId('sum-gems')).toBeVisible();
  const game = await storedGame(page);
  await expect(page.getByTestId('sum-gem-total')).toHaveText(String(game.gems)); // counted up to the stored total
  await expect.poll(async () => (await spoken(page)).includes(`You have ${game.gems} gems!`)).toBe(true);
  await shot(page, '2-gems');
  await expect(page.locator('.sum[data-step="xp"]')).toBeVisible({ timeout: 4000 });
  await expect(page.getByTestId('sum-level')).toHaveText('1');
  await expect(page.locator('.sum-bar')).toBeVisible();
  await shot(page, '3-xp');
  await expect(page.locator('.sum[data-step="learned"]')).toBeVisible({ timeout: 4000 });
  expect(await page.locator('.sum-dotcard').count()).toBeGreaterThan(0);
  await shot(page, '4-learned');
  await expect(page.locator('.sum[data-step="map"]')).toBeVisible({ timeout: 4000 });
  // add10 only: one trail, two stones. Group 1 has facts seen, so it is lit; group 2 is locked with a gap.
  await expect(page.locator('.sum-trail')).toHaveCount(1);
  await expect(page.locator('.sum-stone')).toHaveCount(2);
  await expect(page.locator('.sum-stone').nth(0)).toHaveAttribute('data-state', 'current');
  await expect(page.locator('.sum-stone').nth(1)).toHaveAttribute('data-state', 'locked');
  expect(Number(await page.locator('.sum-stone').nth(0).getAttribute('data-seen'))).toBeGreaterThan(0);
  await expect(page.locator('.sum-stone.locked .sum-lock b')).toHaveText(/^\d+$/);
  await shot(page, '5-map');
  await expect(page.locator('.sum[data-step="streak"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('.sum-streak svg')).toHaveCount(4); // 3 days played in a row, plus today
  await expect(page.getByTestId('sum-buttons')).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(11_000); // about 8 s without a tap, plus the test's own waits
  await shot(page, '6-streak-buttons');

  // Three buttons, each at least 120 px.
  for (const name of ['Play again', 'Hero shop', 'Home']) {
    const box = (await page.getByRole('button', { name }).boundingBox())!;
    expect(box.width, name).toBeGreaterThanOrEqual(120);
    expect(box.height, name).toBeGreaterThanOrEqual(120);
  }
  // No sentence: every text node is numerals or at most 2 words.
  for (const t of await textNodes(page)) {
    expect(/^[\d\s+−]+$/.test(t) || t.split(/\s+/).length <= 2, `text "${t}"`).toBe(true);
  }
});

test('a tap skips to the last step with the buttons', async ({ page }) => {
  await seed(page, { xp: 0, gems: 5 });
  await playRun(page);
  await page.waitForTimeout(800);
  await page.locator('.sum').tap({ position: { x: 20, y: 600 } });
  await expect(page.locator('.sum[data-step="streak"]')).toBeVisible({ timeout: 1000 });
  await expect(page.getByTestId('sum-buttons')).toBeVisible();
  await expect(page.getByTestId('sum-map')).toBeVisible();
});

test('the hero shop button opens the shop', async ({ page }) => {
  await seed(page, { xp: 0, gems: 5 });
  await playRun(page);
  await page.waitForTimeout(800);
  await page.locator('.sum').tap({ position: { x: 20, y: 600 } });
  await page.getByRole('button', { name: 'Hero shop' }).click();
  await expect(page.locator('.pshop')).toBeVisible();
});

test('a level-up run shows confetti and says the new level', async ({ page }) => {
  await seed(page, { xp: 95, gems: 0 }); // level 2 starts at 100 XP
  await playRun(page);
  await expect(page.locator('.sum[data-step="xp"]')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('sum-levelup')).toBeVisible();
  await expect.poll(async () => (await spoken(page)).includes('Level 2!')).toBe(true);
  await expect(page.getByTestId('sum-level')).toHaveText('2', { timeout: 3000 });
  await shot(page, 'levelup');
});

test('when the save fails, no totals show and the retry arrows do; a retry shows the totals', async ({ page }) => {
  await seed(page, { xp: 0, gems: 70 });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.evaluate(() => ((window as unknown as { __failSave: boolean }).__failSave = true));
  for (let guard = 0; guard < 60 && !(await page.locator('.big-stars').count()); guard++) {
    const right = page.locator('.choice[data-answer="true"]');
    if (await right.count()) await right.first().click({ timeout: 500 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId('sum-fail')).toBeVisible({ timeout: 4000 });
  await expect(page.getByTestId('sum-gem-total')).toHaveCount(0);
  await expect(page.getByTestId('sum-gems')).toHaveCount(0);
  await expect(page.getByTestId('sum-xp')).toHaveCount(0);
  await expect(page.getByTestId('sum-map')).toHaveCount(0);
  await shot(page, 'save-failed');
  const retry = page.getByRole('button', { name: 'Try again' }).first();
  expect((await retry.boundingBox())!.width).toBeGreaterThanOrEqual(120);
  // The server takes the write now.
  await page.evaluate(() => ((window as unknown as { __failSave: boolean }).__failSave = false));
  await retry.click();
  await expect(page.getByTestId('sum-gems')).toBeVisible({ timeout: 4000 });
  const game = await storedGame(page);
  await expect(page.getByTestId('sum-gem-total')).toHaveText(String(game.gems), { timeout: 4000 });
});
