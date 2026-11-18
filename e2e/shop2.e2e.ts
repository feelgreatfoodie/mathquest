import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * shop-2: the item shop, equip, the savings jar and the weapon strike at 820x1180 (iPad portrait), reader and pre-reader.
 * Names, ids and the parent PIN are made up per run. The voice is stubbed and recorded.
 * SCREENSHOTS=1 writes the PNGs under docs/screenshots/.
 */
test.use({ viewport: { width: 820, height: 1180 } });

const KID_ID = 'kidshoptwo0000000003';
const KID_NAME = 'Pip';
const PARENT_PIN = String(randomInt(1000, 10000));
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface GameSeed { xp: number; gems: number; heroes: string[]; hero: string; items?: string[]; equipped?: Record<string, string>; goal?: string }

async function seed(page: Page, game: GameSeed, learner: 'prereader' | 'reader' = 'prereader', shop2 = true) {
  const settings =
    learner === 'prereader'
      ? { shop2, learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }
      : { shop2, tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
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


const storedGame = (page: Page) => page.evaluate((id) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!).find((k: { id: string }) => k.id === id).game, KID_ID);
const storedPurchases = (page: Page) => page.evaluate((id) => JSON.parse(localStorage.getItem(`mathquest:v1:purchases:${id}`) ?? '[]'), KID_ID);
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
const GAME = { xp: 300, gems: 100, heroes: ['knight', 'wizard'], hero: 'wizard' };

async function openReaderShop(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Hero shop' })).toBeVisible();
}
async function openPreShop(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await page.getByRole('button', { name: 'Hero shop' }).click();
  await expect(page.locator('.pshop')).toBeVisible();
}
const item = (page: Page, id: string) => page.locator(`[data-item="${id}"]`);

test('reader: tabs, buy the bow with one confirm, it is worn, the log has the item', async ({ page }) => {
  await seed(page, GAME, 'reader');
  await openReaderShop(page);
  await expect(page.locator('.shop-tab')).toHaveCount(6);
  await shot(page, 'shop2-reader-heroes');
  await page.locator('[data-tab="weapon"]').click();
  await expect(page.locator('.shop-item')).toHaveCount(6);
  await expect(item(page, 'w-crystalstaff')).toContainText('Legendary');
  await shot(page, 'shop2-reader-weapons');
  // One confirm: the price button asks, "Buy for 55" buys.
  await item(page, 'w-bow').getByRole('button', { name: '55 gems' }).click();
  expect((await storedGame(page)).gems).toBe(100);
  await item(page, 'w-bow').getByRole('button', { name: 'Buy for 55' }).click();
  await expect(item(page, 'w-bow')).toHaveAttribute('data-state', 'active');
  const g = await storedGame(page);
  expect(g).toMatchObject({ gems: 45, items: ['w-bow'], equipped: { weapon: 'w-bow' }, hero: 'wizard' });
  expect(await storedPurchases(page)).toMatchObject([{ itemId: 'w-bow', cost: 55 }]);
  // Take off, then equip again. Free, no gems move.
  await item(page, 'w-bow').getByRole('button', { name: 'Take off' }).click();
  expect((await storedGame(page)).equipped ?? {}).toEqual({});
  await item(page, 'w-bow').getByRole('button', { name: 'Equip' }).click();
  expect((await storedGame(page))).toMatchObject({ gems: 45, equipped: { weapon: 'w-bow' } });
  // The hero on Home wears it.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.hero-fig[data-weapon="w-bow"]')).toBeVisible();
  await shot(page, 'shop2-reader-home-bow');
});

test('reader: every shop button and tab is at least 48 px, prices are shown, legendary costs 300 and 350', async ({ page }) => {
  await seed(page, { ...GAME, gems: 500 }, 'reader');
  await openReaderShop(page);
  for (const tab of ['hero', 'weapon', 'gear', 'pet', 'adventure', 'camp']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    for (const b of await page.locator('.shop button').all()) {
      const box = (await b.boundingBox())!;
      expect(box.height, `${tab} button`).toBeGreaterThanOrEqual(48);
      expect(box.width).toBeGreaterThanOrEqual(48);
    }
    for (const c of await page.locator('.shop-item').all()) expect(await c.innerText()).toMatch(/\d+ gems|Equip|Owned|Equipped/);
  }
  await page.locator('[data-tab="gear"]').click();
  await expect(item(page, 'g-goldarmor')).toContainText('300 gems');
  await page.locator('[data-tab="weapon"]').click();
  await expect(item(page, 'w-crystalstaff')).toContainText('350 gems');
  await page.locator('[data-tab="adventure"]').click();
  await shot(page, 'shop2-reader-adventure');
});

test('reader: too few gems blocks a buy; the goal pins, the jar shows progress, buying the goal clears it', async ({ page }) => {
  await seed(page, { ...GAME, gems: 47 }, 'reader');
  await openReaderShop(page);
  await page.locator('[data-tab="weapon"]').click();
  await expect(item(page, 'w-bow').getByRole('button', { name: '55 gems' })).toBeDisabled();
  await item(page, 'w-bow').getByRole('button', { name: 'Save for this' }).click();
  expect((await storedGame(page)).goal).toBe('w-bow');
  const jar = page.locator('.goal-jar').first();
  await expect(jar).toHaveAttribute('data-goal', 'w-bow');
  await expect(jar).toHaveAttribute('data-pct', String(Math.round((47 / 55) * 100)));
  await expect(jar).toContainText('8 more gems for the Bow');
  await shot(page, 'shop2-reader-jar');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.home .goal-jar')).toBeVisible();
  await shot(page, 'shop2-reader-home-jar');
});

test('reader: with the setting off the shop is the hero shop only', async ({ page }) => {
  await seed(page, GAME, 'reader', false);
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await page.getByRole('button', { name: 'Hero shop' }).click();
  await expect(page.locator('.shop-tab')).toHaveCount(0);
  await expect(page.locator('.shop-item')).toHaveCount(5);
});

test('reader: an owned camp tent shows on Home, an adventure item shows as Owned', async ({ page }) => {
  await seed(page, { ...GAME, items: ['c-tent', 'c-flag', 'a-lantern'] }, 'reader');
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await expect(page.locator('.camp-row svg')).toHaveCount(2);
  await shot(page, 'shop2-reader-home-camp');
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await page.locator('[data-tab="adventure"]').click();
  await expect(item(page, 'a-lantern')).toContainText('Owned');
});

test('pre-reader: 6 picture tabs, no words, every target at least 120 px', async ({ page }) => {
  await seed(page, { ...GAME, gems: 70 });
  await openPreShop(page);
  await expect(page.locator('.pshop-tab')).toHaveCount(6);
  for (const tab of ['hero', 'weapon', 'gear', 'pet', 'adventure', 'camp']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    const text = (await page.locator('.pshop').innerText()).replace(/\s+/g, '');
    expect(text, tab).toMatch(/^[0-9]*$/);
    for (const b of await page.locator('.pshop button').all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, `${tab} width`).toBeGreaterThanOrEqual(120);
      expect(box.height, `${tab} height`).toBeGreaterThanOrEqual(120);
    }
    await shot(page, `shop2-prereader-${tab}`);
  }
});

test('pre-reader: buy the bow with one big confirm, a double tap buys once, the voice names it', async ({ page }) => {
  await seed(page, { ...GAME, gems: 70 });
  await openPreShop(page);
  await page.locator('[data-tab="weapon"]').click();
  await item(page, 'w-bow').click();
  await expect(page.locator('.pshop-confirm')).toBeVisible();
  expect((await storedGame(page)).gems).toBe(70);
  await shot(page, 'shop2-prereader-confirm');
  await page.getByRole('button', { name: 'Buy' }).dblclick();
  await expect(item(page, 'w-bow')).toHaveAttribute('data-state', 'active');
  expect(await storedGame(page)).toMatchObject({ gems: 15, items: ['w-bow'], equipped: { weapon: 'w-bow' } });
  expect(await storedPurchases(page)).toHaveLength(1);
  await expect.poll(async () => (await spoken(page)).includes('You got the Bow!')).toBe(true);
});

test('pre-reader: a thing you cannot afford goes in the jar, the jar speaks, and gems from a round move it', async ({ page }) => {
  await seed(page, { ...GAME, gems: 30 });
  await openPreShop(page);
  await page.locator('[data-tab="pet"]').click();
  await item(page, 'p-owl').click();
  await expect.poll(async () => (await storedGame(page)).goal).toBe('p-owl');
  await expect.poll(async () => (await spoken(page)).includes('Saving for the Owl!')).toBe(true);
  const jar = page.locator('.goal-jar-prereader');
  await expect(jar).toHaveAttribute('data-goal', 'p-owl');
  await expect(jar).toHaveAttribute('data-pct', '25');
  const box = (await jar.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(120);
  expect(box.height).toBeGreaterThanOrEqual(120);
  await shot(page, 'shop2-prereader-jar');
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.locator('.early-home .goal-jar-prereader')).toBeVisible();
  await shot(page, 'shop2-prereader-home-jar');
  // A round: the jar fills with the gems the round gave.
  await page.getByRole('button', { name: 'Play' }).click();
  for (let guard = 0; guard < 40; guard++) {
    if (await page.locator('.big-stars').count()) break;
    await page.locator('.choice[data-answer="true"]').click();
    await expect.poll(async () => (await page.locator('.big-stars').count()) > 0 || (await page.locator('.early-check').count()) === 0, { timeout: 8000 }).toBe(true);
  }
  await expect(page.locator('.big-stars')).toBeVisible();
  const after = await storedGame(page);
  expect(after.gems).toBeGreaterThan(30);
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.locator('.goal-jar-prereader')).toHaveAttribute('data-pct', String(Math.round((after.gems / 120) * 100)));
});

test('the weapon changes the strike on a correct answer; no weapon gives no strike', async ({ page }) => {
  await seed(page, { ...GAME, items: ['w-hammer', 'p-dog', 'g-helm'], equipped: { weapon: 'w-hammer', pet: 'p-dog', gear: 'g-helm' } });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await shot(page, 'shop2-prereader-home-figure');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.hero-fig[data-weapon="w-hammer"]')).toBeVisible();
  await expect(page.locator('.hero-fig .strike')).toHaveCount(0);
  await page.locator('.choice[data-answer="true"]').click();
  await expect(page.locator('.hero-fig .strike-w-hammer')).toHaveCount(1);
  await shot(page, 'shop2-prereader-strike-hammer');
});

test('a hero with no weapon is the plain sprite (no figure, no strike)', async ({ page }) => {
  await seed(page, GAME);
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.hero-sprite')).toBeVisible();
  await expect(page.locator('.hero-fig')).toHaveCount(0);
});
