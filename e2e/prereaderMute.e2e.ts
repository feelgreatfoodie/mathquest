import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * The pre-reader mute: one shared button on Picture Run and Home, voice and sounds as separate things, "Hear it" while
 * muted, and the parent's voice and sounds settings. Names and ids are made up. The voice and WebAudio are stubbed.
 * MUTE_SHOTS=<dir> writes PNGs there (keep them local).
 */
const KID_ID = 'kidmute00000000000001';
const SHOTS = process.env.MUTE_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const BASE = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };

async function seed(page: Page, extra: Record<string, unknown> = {}, kidMuted = false) {
  await page.addInitScript(
    ({ kidId, settings, kidMuted }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
      w.__tones = 0;
      class Utter {
        text: string;
        lang = '';
        rate = 1;
        volume = 1;
        voice: unknown = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(t: string) { this.text = t; }
      }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          speak(u: Utter) { if (u.text.trim()) (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); },
          cancel() {},
          getVoices() { return []; },
        },
      });
      w.AudioContext = class {
        currentTime = 0;
        destination = {};
        resume() { return Promise.resolve(); }
        createOscillator() { (w.__tones as number)++; return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kidId, name: 'Pip', createdAt: 1, settings, game: { xp: 0, gems: 0, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
        if (kidMuted) localStorage.setItem(`mathquest:v1:mute:${kidId}`, '1');
      }
    },
    { kidId: KID_ID, settings: { ...BASE, ...extra }, kidMuted },
  );
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
const tones = (page: Page) => page.evaluate(() => (window as unknown as { __tones: number }).__tones);
const mute = (page: Page) => page.locator('.mute-btn');

async function toRun(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.early-numerals')).toBeVisible();
}

async function answerRight(page: Page) {
  await page.locator('.choice[data-answer="true"]').first().click();
}

test('the mute button turns off the voice and the chimes, and Hear it speaks once per tap', async ({ page }) => {
  await seed(page);
  await toRun(page);
  await expect.poll(async () => (await spoken(page)).some((s) => / plus /.test(s))).toBe(true);
  await expect(mute(page)).toHaveAttribute('aria-pressed', 'false');

  await mute(page).click();
  await expect(mute(page)).toHaveAttribute('aria-pressed', 'true');
  const said = (await spoken(page)).length;

  // Muted: a right answer makes no chime and no voice, and the next question is not read out.
  const t0 = await tones(page);
  await answerRight(page);
  await expect(page.locator('.early-numerals')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await tones(page)).toBe(t0);
  expect((await spoken(page)).length).toBe(said);

  // Hear it: one tap, one utterance, even while muted. It never plays by itself.
  const hear = page.getByRole('button', { name: 'Hear it' });
  await expect(hear).toBeVisible();
  await hear.click();
  await expect.poll(async () => (await spoken(page)).length).toBe(said + 1);
  await page.waitForTimeout(500);
  expect((await spoken(page)).length).toBe(said + 1);
  await hear.click();
  await expect.poll(async () => (await spoken(page)).length).toBe(said + 2);
});

test('unmuted, a right answer still chimes and speaks', async ({ page }) => {
  await seed(page);
  await toRun(page);
  await expect(mute(page)).toHaveAttribute('aria-pressed', 'false');
  const t0 = await tones(page);
  await answerRight(page);
  await expect.poll(async () => await tones(page)).toBeGreaterThan(t0);
});

test('the choice is one per kid on the device: Picture Run, Home and a reload agree', async ({ page }) => {
  await seed(page);
  await toRun(page);
  await mute(page).click();
  await expect(mute(page)).toHaveAttribute('aria-pressed', 'true');
  // Leave with the Home hold button.
  const b = page.getByRole('button', { name: 'Hold to leave' });
  const box = (await b.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2300);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(mute(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate((id) => localStorage.getItem(`mathquest:v1:mute:${id}`), KID_ID)).toBe('1');
  await page.reload();
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await expect(mute(page)).toHaveAttribute('aria-pressed', 'true');
  await mute(page).click();
  await expect(mute(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate((id) => localStorage.getItem(`mathquest:v1:mute:${id}`), KID_ID)).toBe('0');
});

test('the old parent lock hides the mute and Hear it, and keeps the voice and the chimes off', async ({ page }) => {
  await seed(page, { sound: false });
  await toRun(page);
  await expect(mute(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hear it' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Say it again' })).toHaveCount(0);
  const t0 = await tones(page);
  await answerRight(page);
  await page.waitForTimeout(1500);
  expect(await tones(page)).toBe(t0);
  expect(await spoken(page)).toEqual([]);
});

test('voice off is silent and the kid cannot override it, but the sounds follow their own setting', async ({ page }) => {
  await seed(page, { voice: 'off', sounds: 'on' }, true);
  await toRun(page);
  expect(await spoken(page)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Hear it' })).toHaveCount(0);
  await expect(mute(page)).toBeVisible();
  // Unmuting brings the chimes back and still no voice.
  await mute(page).click();
  const t0 = await tones(page);
  await answerRight(page);
  await expect.poll(async () => await tones(page)).toBeGreaterThan(t0);
  expect(await spoken(page)).toEqual([]);
});

test('sounds off with the voice on: the voice speaks and the chimes do not', async ({ page }) => {
  await seed(page, { sounds: 'off' });
  await toRun(page);
  await expect.poll(async () => (await spoken(page)).some((s) => / plus /.test(s))).toBe(true);
  await answerRight(page);
  await page.waitForTimeout(1500);
  expect(await tones(page)).toBe(0);
});

test("voice 'on' pins the voice: the kid's button mutes the chimes only and shows a chime-off state", async ({ page }) => {
  await seed(page, { voice: 'on' });
  await toRun(page);
  await expect(mute(page)).toHaveAttribute('aria-label', 'Chimes are on. Turn them off');
  await mute(page).click();
  await expect(mute(page)).toHaveAttribute('aria-label', 'Chimes are off. Turn them on');
  const t0 = await tones(page);
  const said = (await spoken(page)).length;
  await answerRight(page);
  await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(said);
  expect(await tones(page)).toBe(t0);
});

for (const vp of [{ w: 820, h: 1180 }, { w: 393, h: 852 }]) {
  test(`Picture Run muted at ${vp.w}x${vp.h}: mute and Hear it are 120 px, the top bar fits`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await seed(page, {}, true);
    await toRun(page);
    await expect(mute(page)).toHaveAttribute('aria-pressed', 'true');
    for (const loc of [mute(page), page.getByRole('button', { name: 'Hear it' })]) {
      const box = (await loc.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(120);
      expect(box.height).toBeGreaterThanOrEqual(120);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.w);
    }
    // The top bar fits. (The 3 choice buttons below it are a separate, older 465 px row on a 393 px phone.)
    const bar = await page.evaluate(() => { const e = document.querySelector('.early-top')!; return { sw: e.scrollWidth, cw: e.clientWidth }; });
    expect(bar.sw).toBeLessThanOrEqual(bar.cw);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/picture-run-muted-${vp.w}x${vp.h}.png` });
  });
}
