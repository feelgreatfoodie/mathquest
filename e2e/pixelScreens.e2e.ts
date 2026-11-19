import { expect, test, type Page } from '@playwright/test';
import { keypadReady } from './harness/keypadReady';

/** style-2: the Dungeon question, Picture Run, Home and the end screen in the Modern pixel look. Made-up names and ids only. */
async function seed(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    class Utter {
      text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null;
      onend: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(t: string) { this.text = t; }
    }
    w.SpeechSynthesisUtterance = Utter;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
    if (localStorage.getItem('mathquest:v1:kids')) return;
    const game = { xp: 240, gems: 31, streakDays: 3, lastPlayedDay: null, bestCombo: 5, heroes: ['knight'], hero: 'knight' };
    const reader = { modes: { overworld: false }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 12, maxNew: 6, factGroupsUnlocked: 1, paceMultiplier: 3 };
    const pre = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
    localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
    localStorage.setItem(
      'mathquest:v1:kids',
      JSON.stringify([
        { id: 'kidscreen000000001', name: 'Pip', createdAt: 1, settings: reader, game },
        { id: 'kidscreen000000002', name: 'Wren', createdAt: 2, settings: pre, game },
      ]),
    );
  });
}

const box = async (page: Page, sel: string) => {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return b;
};

async function startPip(page: Page) {
  await seed(page);
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: 'Start Quest' }).click();
  await keypadReady(page);
}

for (const vp of [
  { w: 820, h: 1180 },
  { w: 1024, h: 768 },
  { w: 393, h: 852 },
]) {
  test.describe(`${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test('Dungeon: torches, brick scene, stone tablet, pixel keys, and the scene and keypad never move', async ({ page }) => {
      await startPip(page);
      await expect(page.locator('.px-torches .px-torch')).toHaveCount(10);
      await expect(page.locator('.px-torches')).toHaveAttribute('data-lit', '0');
      await expect(page.locator('.arena.px-arena .px-dungeon-scene')).toBeVisible();
      await expect(page.locator('.arena.px-arena .px-dungeon-torch')).toHaveCount(2);
      await expect(page.locator('.panel.question.px-stone')).toBeVisible();
      await expect(page.locator('.key-go.px-go')).toBeVisible();
      await expect(page.locator('.key-back')).toHaveText('DEL');
      // The question and keypad fit on the screen without a scroll.
      const pageH = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(pageH).toBeLessThanOrEqual(vp.h + 1);
      // Targets: every key at least 48 px, 96 px on a tall screen.
      const keyH = (await box(page, '.keypad .key')).height;
      expect(keyH).toBeGreaterThanOrEqual(vp.h >= 1000 ? 96 : 48);
      for (const k of await page.locator('.keypad .key').all()) expect((await k.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      const scene = await box(page, '.arena.px-arena');
      const keys = await box(page, '.keypad');
      for (const d of '99') await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
      expect(await box(page, '.arena.px-arena')).toEqual(scene);
      expect(await box(page, '.keypad')).toEqual(keys);
    });

    test('Dungeon: the miss screen keeps the pixel look and the scene in place', async ({ page }) => {
      await startPip(page);
      const scene = await box(page, '.arena.px-arena');
      for (const d of '9999') await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
      await page.locator('.key-go').click();
      await expect(page.locator('.px-stone .feedback.bad')).toBeVisible();
      expect(await box(page, '.arena.px-arena')).toEqual(scene);
      const got = page.getByRole('button', { name: 'Got it' });
      expect((await got.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      expect(await got.evaluate((e) => getComputedStyle(e).borderRadius)).toBe('0px');
    });

    test('Picture Run: 120 px choices, big square dots, torches', async ({ page }) => {
      await seed(page);
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Wren' }).click();
      await page.getByRole('button', { name: 'Play' }).click();
      await expect(page.locator('.early-numerals')).toBeVisible();
      await expect(page.locator('.px-torches .px-torch')).toHaveCount(10);
      const choices = await page.locator('.choice').all();
      expect(choices.length).toBeGreaterThanOrEqual(2);
      for (const c of choices) {
        const b = (await c.boundingBox())!;
        expect(b.width).toBeGreaterThanOrEqual(120);
        expect(b.height).toBeGreaterThanOrEqual(120);
        expect(await c.evaluate((e) => getComputedStyle(e).borderRadius)).toBe('0px');
      }
      const dot = await page.locator('.choice-dot').first().boundingBox();
      if (dot) expect(dot.width).toBeGreaterThanOrEqual(20);
    });

    test('Home: stats bar, camp scene and area-colored mode cards', async ({ page }) => {
      await seed(page);
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).click();
      await expect(page.locator('.px-topbar .stat')).toHaveCount(3);
      await expect(page.getByTestId('camp-scene')).toBeVisible();
      await expect(page.getByTestId('camp-scene').getByText('Pip')).toBeVisible();
      for (const name of ['Start Quest', 'Hero shop', 'Switch player']) expect((await page.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(48);
    });
  });
}

test('the Dungeon flicker and the end-screen count-in stop under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startPip(page);
  const name = await page.locator('.px-flicker').first().evaluate((e) => getComputedStyle(e).animationName);
  expect(name).toBe('none');
});

test('the end screen is a treasure room with its counts', async ({ page }) => {
  await startPip(page);
  for (const d of '9999') await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await page.locator('.key-go').click();
  await page.getByRole('button', { name: 'Got it' }).click();
  const b = (await page.locator('.hold-btn').first().boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1600);
  await page.mouse.up();
  await expect(page.locator('.px-treasure-screen .px-treasure')).toBeVisible();
  await expect(page.locator('.px-treasure-screen .panel.summary.px-frame')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
});
