import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Pre-reader hero shop and the parent stats row at 820x1180 (iPad portrait).
 * Names, ids and the parent PIN are made up per run. The voice is stubbed and recorded.
 * SCREENSHOTS=1 writes the PNGs under docs/screenshots/.
 */
test.use({ viewport: { width: 820, height: 1180 } });

const KID_ID = 'kidpreread0000000002';
const KID_NAME = 'Pip';
const PARENT_PIN = String(randomInt(1000, 10000));
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface GameSeed { xp: number; gems: number; heroes: string[]; hero: string }

async function seed(page: Page, game: GameSeed, learner: 'prereader' | 'reader' = 'prereader') {
  const settings =
    learner === 'prereader'
      ? { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }
      : { tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
  await page.addInitScript(
    ({ kidId, name, settings, pinHash, game }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
      class Utter {
        text: string;
        lang = '';
        rate = 1;
        voice: unknown = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(t: string) { this.text = t; }
      }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: { speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } },
      });
      w.AudioContext = class {
        currentTime = 0;
        destination = {};
        resume() { return Promise.resolve(); }
        createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
        localStorage.setItem(
          'mathquest:v1:kids',
          JSON.stringify([{ id: kidId, name, createdAt: 1, settings, game: { ...game, streakDays: 3, lastPlayedDay: null, bestCombo: 5 } }]),
        );
        localStorage.setItem(
          `mathquest:v1:sessions:${kidId}`,
          JSON.stringify([{ id: 's-old', startedAt: Date.now() - 3_600_000, endedAt: Date.now() - 3_540_000, answered: 10, graded: 10, correct: 9, fast: 4, newLearned: 0, medianMs: 2100, xp: 40, gems: 8, bestCombo: 5, missed: [] }]),
        );
      }
    },
    { kidId: KID_ID, name: KID_NAME, settings, pinHash: sha(`mathquest:local:${PARENT_PIN}`), game },
  );
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
const storedGame = (page: Page) => page.evaluate((id) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!).find((k: { id: string }) => k.id === id).game, KID_ID);
const storedPurchases = (page: Page) => page.evaluate((id) => JSON.parse(localStorage.getItem(`mathquest:v1:purchases:${id}`) ?? '[]'), KID_ID);
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
async function enterPin(page: Page, pin: string) {
  for (const d of pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
}
async function openShop(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await page.getByRole('button', { name: 'Hero shop' }).click();
  await expect(page.locator('.pshop')).toBeVisible();
}
const card = (page: Page, hero: string) => page.locator(`.pshop-card[data-hero="${hero}"]`);

test('pre-reader home has a chest button of at least 120 px with the gem count', async ({ page }) => {
  await seed(page, { xp: 300, gems: 40, heroes: ['knight'], hero: 'knight' });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  const chest = page.getByRole('button', { name: 'Hero shop' });
  await expect(chest).toBeVisible();
  const box = (await chest.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(120);
  expect(box.height).toBeGreaterThanOrEqual(120);
  await expect(chest.locator('svg')).not.toHaveCount(0);
  expect((await chest.innerText()).trim()).toBe('40');
  await shot(page, 'shop-prereader-home');
});

test('the shop grid has no words and every target is big enough', async ({ page }) => {
  await seed(page, { xp: 300, gems: 40, heroes: ['knight'], hero: 'knight' });
  await openShop(page);
  await expect(page.locator('.pshop-card')).toHaveCount(5);
  const text = (await page.locator('.pshop').innerText()).replace(/\s+/g, '');
  expect(text).toMatch(/^[0-9]*$/);
  for (const c of await page.locator('.pshop-card').all()) {
    const b = (await c.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(140);
    expect(b.height).toBeGreaterThanOrEqual(140);
  }
  for (const b of await page.locator('.pshop button').all()) {
    const box = (await b.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(120);
    expect(box.height).toBeGreaterThanOrEqual(120);
  }
  await expect(card(page, 'knight')).toHaveAttribute('data-state', 'active');
  await expect(card(page, 'knight').locator('svg')).not.toHaveCount(0);
  await expect(card(page, 'wizard')).toHaveAttribute('data-state', 'locked');
  await expect(card(page, 'robot')).toHaveAttribute('data-state', 'poor');
  await expect(card(page, 'wizard')).toContainText('15');
  await shot(page, 'shop-prereader-grid');
});

test('tapping a hero says its name; a hero the kid cannot afford opens no confirm and buys nothing', async ({ page }) => {
  await seed(page, { xp: 300, gems: 20, heroes: ['knight'], hero: 'knight' });
  await openShop(page);
  await card(page, 'robot').click();
  await expect.poll(async () => (await spoken(page)).includes('Robot!')).toBe(true);
  await expect(page.locator('.pshop-confirm')).toHaveCount(0);
  expect((await storedGame(page)).gems).toBe(20);
  expect(await storedPurchases(page)).toHaveLength(0);
});

test('buy: one confirm, a double tap on confirm buys once, the voice and the log agree', async ({ page }) => {
  await seed(page, { xp: 300, gems: 40, heroes: ['knight'], hero: 'knight' });
  await openShop(page);
  await card(page, 'wizard').click();
  await expect(page.locator('.pshop-confirm')).toBeVisible();
  // Nothing is bought before the confirm.
  expect((await storedGame(page)).gems).toBe(40);
  const text = (await page.locator('.pshop-confirm').innerText()).replace(/\s+/g, '');
  expect(text).toMatch(/^[0-9]*$/);
  const confirm = page.getByRole('button', { name: 'Buy' });
  const box = (await confirm.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(120);
  expect(box.height).toBeGreaterThanOrEqual(120);
  await shot(page, 'shop-prereader-confirm');
  // Two taps in the same task, before React re-renders: only the UI guard stops the second call.
  await confirm.evaluate((el) => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  await expect(page.locator('.pshop-confirm')).toHaveCount(0);
  await expect(card(page, 'wizard')).toHaveAttribute('data-state', 'active');
  await expect.poll(async () => (await spoken(page)).includes('You got the Wizard!')).toBe(true);
  const game = await storedGame(page);
  expect(game).toMatchObject({ gems: 25, hero: 'wizard' });
  expect(game.heroes).toEqual(['knight', 'wizard']);
  const log = await storedPurchases(page);
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ heroId: 'wizard', cost: 15 });
  // The second tap never reached the repo: no "already owned" failure toast.
  await page.waitForTimeout(300);
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('cancel on the confirm screen buys nothing', async ({ page }) => {
  await seed(page, { xp: 300, gems: 40, heroes: ['knight'], hero: 'knight' });
  await openShop(page);
  await card(page, 'wizard').click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.pshop-confirm')).toHaveCount(0);
  expect((await storedGame(page)).gems).toBe(40);
  expect(await storedPurchases(page)).toHaveLength(0);
});

test('equipping an owned hero changes the home sprite', async ({ page }) => {
  await seed(page, { xp: 300, gems: 5, heroes: ['knight', 'wizard'], hero: 'knight' });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  const heroOnHome = () => page.locator('.early-home svg.bob').first().innerHTML();
  const before = await heroOnHome();
  await page.getByRole('button', { name: 'Hero shop' }).click();
  await card(page, 'wizard').click();
  await expect(card(page, 'wizard')).toHaveAttribute('data-state', 'active');
  expect((await storedGame(page)).hero).toBe('wizard');
  expect(await storedPurchases(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  expect(await heroOnHome()).not.toBe(before);
});

test('parent area shows XP, gems and hero, follows a second client without a reload, lists gem history, and has no edit field', async ({ page }) => {
  await seed(page, { xp: 250, gems: 40, heroes: ['knight', 'wizard'], hero: 'wizard' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Grown-ups area' }).click();
  await enterPin(page, PARENT_PIN);
  const row = page.locator('.summary-row');
  await expect(row).toContainText('250');
  await expect(row).toContainText('xp');
  await expect(row.locator('.stat', { hasText: 'gems' })).toContainText('40');
  await expect(row.locator('.stat', { hasText: 'hero' })).toContainText('Wizard · 2 of 5');
  await expect(row.locator('.progress')).toHaveCount(1);
  await shot(page, 'parent-stats-row');

  // A second client finishes a run: it writes the same storage, and the parent tiles follow with no reload.
  await page.evaluate((id) => {
    const kids = JSON.parse(localStorage.getItem('mathquest:v1:kids')!);
    const k = kids.find((x: { id: string }) => x.id === id);
    k.game.xp += 100;
    k.game.gems += 9;
    localStorage.setItem('mathquest:v1:kids', JSON.stringify(kids));
    const sessions = JSON.parse(localStorage.getItem(`mathquest:v1:sessions:${id}`)!);
    sessions.push({ ...sessions[0], id: 's-new', startedAt: Date.now() - 60_000, endedAt: Date.now(), gems: 9, xp: 100 });
    localStorage.setItem(`mathquest:v1:sessions:${id}`, JSON.stringify(sessions));
    localStorage.setItem(`mathquest:v1:purchases:${id}`, JSON.stringify([{ id: 'p1', heroId: 'wizard', cost: 15, at: Date.now() - 1_800_000 }]));
  }, KID_ID);
  await expect(row).toContainText('350', { timeout: 8000 });
  await expect(row.locator('.stat', { hasText: 'gems' })).toContainText('49');

  // Gem history: runs (+) and purchases (-), newest first.
  const history = page.locator('.gem-history');
  await expect(history).toBeVisible();
  await expect.poll(async () => history.locator('li').count(), { timeout: 8000 }).toBe(3);
  const rows = await history.locator('li').allInnerTexts();
  expect(rows[0]).toContain('+9');
  expect(rows[1]).toContain('−15');
  expect(rows[2]).toContain('+8');

  // No field edits xp or gems anywhere in the parent area.
  await expect(page.locator('input[name*="xp" i], input[name*="gem" i], input[aria-label*="xp" i], input[aria-label*="gem" i], [contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator('.summary-row input, .summary-row button, .gem-history input, .gem-history button')).toHaveCount(0);
});
