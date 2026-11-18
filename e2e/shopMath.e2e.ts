import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * shop-math: the shop math practice card at 393x852 (phone) and 820x1180 (iPad portrait), reader and pre-reader.
 * Names, ids and the parent PIN are made up per run. SHOP_SHOTS=<dir> writes the PNGs there (keep them local).
 */
const KID_ID = 'kidshopmath00000001';
const KID_NAME = 'Pip';
const PARENT_PIN = String(randomInt(1000, 10000));
const SHOTS = process.env.SHOP_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface Opts { learner: 'reader' | 'prereader'; shop2?: boolean; shopMath?: boolean; gems?: number; goal?: string }

async function seed(page: Page, o: Opts) {
  const { learner, shop2 = true, shopMath = true, gems = learner === 'reader' ? 47 : 5, goal = 'w-bow' } = o;
  const settings =
    learner === 'prereader'
      ? { shop2, shopMath, learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }
      : { shop2, shopMath, tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
  const game = { xp: 300, gems, heroes: ['knight', 'wizard'], hero: 'wizard', goal };
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
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kidId, name, createdAt: 1, settings, game: { ...game, streakDays: 3, lastPlayedDay: null, bestCombo: 5 } }]));
      }
    },
    { kidId: KID_ID, name: KID_NAME, settings, pinHash: sha(`mathquest:local:${PARENT_PIN}`), game },
  );
}

const storedGame = (page: Page) => page.evaluate((id) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!).find((k: { id: string }) => k.id === id).game, KID_ID);
const storedCards = (page: Page) => page.evaluate((id) => localStorage.getItem(`mathquest:v1:cards:${id}`), KID_ID);
const storedSessions = (page: Page) => page.evaluate((id) => localStorage.getItem(`mathquest:v1:sessions:${id}`), KID_ID);
async function shot(page: Page, name: string, vp: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/shopmath-${vp}-${name}.png` });
}
async function home(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
}
const openCard = (page: Page) => page.getByTestId('shop-math-open');
/** No horizontal overflow: on the page, and inside the card when it is open (the pre-reader Home row behind it is wider than a phone on main, with the setting off too). */
async function noOverflow(page: Page, card = false) {
  const o = await page.evaluate((c) => {
    const el = document.querySelector('.shopmath');
    const kids = el ? [...el.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).length : 0;
    return { sw: c && el ? el.scrollWidth : document.documentElement.scrollWidth, iw: c && el ? el.clientWidth : window.innerWidth, wide: kids };
  }, card);
  expect(o.sw).toBeLessThanOrEqual(o.iw);
  expect(o.wide).toBe(0);
}
async function typeNumber(page: Page, n: number) {
  for (const d of String(n)) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
}
/** The need in the prompt: the last number before "How many more". */
async function neededFromText(page: Page): Promise<number> {
  const t = await page.getByTestId('shop-math-text').innerText();
  const m = /You have (\d+)(?: dots)?\. (?:The .+ costs|You need) (\d+)\./.exec(t)!;
  return Number(m[2]) - Number(m[1]);
}

for (const vp of [{ name: 'phone', width: 393, height: 852 }, { name: 'ipad', width: 820, height: 1180 }]) {
  test.describe(`shop math at ${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('the card shows with shop2 and shopMath on, and is hidden with either off', async ({ page }) => {
      await seed(page, { learner: 'reader' });
      await home(page);
      await expect(openCard(page)).toBeVisible();
      await noOverflow(page);
      await shot(page, 'reader-home', vp.name);
    });

    test('hidden when shopMath is off', async ({ page }) => {
      await seed(page, { learner: 'reader', shopMath: false });
      await home(page);
      await expect(page.getByRole('button', { name: 'Hero shop' }).or(page.getByRole('button', { name: 'Shop', exact: true })).first()).toBeVisible();
      await expect(openCard(page)).toHaveCount(0);
    });

    test('hidden when shop2 is off', async ({ page }) => {
      await seed(page, { learner: 'reader', shop2: false });
      await home(page);
      await expect(page.getByRole('button', { name: 'Hero shop' }).first()).toBeVisible();
      await expect(openCard(page)).toHaveCount(0);
    });

    test('reader: a right first answer gives +1 gem, and touches no card or session', async ({ page }) => {
      await seed(page, { learner: 'reader' });
      await home(page);
      await openCard(page).click();
      await expect(page.getByTestId('shop-math-text')).toHaveText('You have 47. The Bow costs 55. How many more?');
      await noOverflow(page, true);
      await shot(page, 'reader-card', vp.name);
      await typeNumber(page, 8);
      await page.getByRole('button', { name: 'GO' }).click();
      await expect(page.getByTestId('shop-math-tip')).toHaveText('+1 gem');
      expect((await storedGame(page))).toMatchObject({ gems: 48, shopTipsToday: 1 });
      expect(await storedCards(page)).toBeNull();
      expect(await storedSessions(page)).toBeNull();
      await noOverflow(page, true);
      await shot(page, 'reader-right', vp.name);
    });

    test('reader: a wrong answer shows the right one with no penalty, and a retry pays no tip', async ({ page }) => {
      await seed(page, { learner: 'reader' });
      await home(page);
      await openCard(page).click();
      await typeNumber(page, 5);
      await page.getByRole('button', { name: 'GO' }).click();
      await expect(page.getByTestId('shop-math-answer')).toContainText('The answer is 8');
      expect((await storedGame(page)).gems).toBe(47);
      await shot(page, 'reader-wrong', vp.name);
      await page.getByTestId('shop-math-retry').click();
      await typeNumber(page, 8);
      await page.getByRole('button', { name: 'GO' }).click();
      await expect(page.getByTestId('shop-math-notip')).toBeVisible();
      expect((await storedGame(page)).gems).toBe(47);
    });

    test('reader: the 4th tip of a day is not paid', async ({ page }) => {
      await seed(page, { learner: 'reader' });
      await home(page);
      for (let i = 0; i < 4; i++) {
        await openCard(page).click();
        await typeNumber(page, await neededFromText(page));
        await page.getByRole('button', { name: 'GO' }).click();
        if (i < 3) await expect(page.getByTestId('shop-math-tip')).toBeVisible();
        else await expect(page.getByTestId('shop-math-capped')).toBeVisible();
        await page.getByTestId('shop-math-close').click();
      }
      expect(await storedGame(page)).toMatchObject({ gems: 50, shopTipsToday: 3 });
    });

    test('pre-reader: three buttons of at least 120 px, a right tap gives +1, no overflow', async ({ page }) => {
      await seed(page, { learner: 'prereader' });
      await home(page);
      await expect(openCard(page)).toBeVisible();
      const open = (await openCard(page).boundingBox())!;
      expect(open.width).toBeGreaterThanOrEqual(120);
      expect(open.height).toBeGreaterThanOrEqual(120);
      await openCard(page).click();
      const buttons = page.locator('.shopmath .choice');
      await expect(buttons).toHaveCount(3);
      for (const b of await buttons.all()) {
        const box = (await b.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(120);
        expect(box.height).toBeGreaterThanOrEqual(120);
      }
      await noOverflow(page, true);
      const text = await page.getByTestId('shop-math-text').innerText();
      expect(text).toMatch(/^You have \d+ dots\. You need \d+\. How many more\?$/);
      expect(await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toContain(text);
      await shot(page, 'prereader-card', vp.name);
      // A wrong tap shows the answer and pays nothing.
      await page.locator('.shopmath .choice[data-answer="false"]').first().click();
      await expect(page.getByTestId('shop-math-answer')).toBeVisible();
      expect((await storedGame(page)).gems).toBe(5);
      await page.locator('.shopmath .choice[data-answer="true"]').click({ force: true });
      await expect(page.getByTestId('shop-math-notip')).toBeVisible();
      expect((await storedGame(page)).gems).toBe(5);
    });

    test('pre-reader: a right first tap gives +1', async ({ page }) => {
      await seed(page, { learner: 'prereader' });
      await home(page);
      await openCard(page).click();
      await page.locator('.shopmath .choice[data-answer="true"]').click({ force: true });
      await expect(page.getByTestId('shop-math-tip')).toHaveText('+1 gem');
      expect(await storedGame(page)).toMatchObject({ gems: 6, shopTipsToday: 1 });
      await shot(page, 'prereader-right', vp.name);
    });
  });
}
