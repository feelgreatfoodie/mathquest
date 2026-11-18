import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * adventure-fit: Adventure on an older iPad in landscape (WebKit). Names and ids are made up. SCREENSHOTS=1 writes PNGs
 * under docs/screenshots/adventure-fit.
 */
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/adventure-fit' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidfit000000000000001';
const PRE = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const READER = { tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 8, maxNew: 2, factGroupsUnlocked: 1, paceMultiplier: 3 };
const VIEWPORTS = [{ w: 1024, h: 768 }, { w: 1080, h: 810 }, { w: 1112, h: 834 }, { w: 1180, h: 820 }, { w: 768, h: 1024 }];

test.use({ deviceScaleFactor: 2, hasTouch: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1' });

async function seed(page: Page, settings: object) {
  await page.addInitScript(
    ({ kid, settings }) => {
      const w = window as unknown as Record<string, unknown>;
      class Utter { text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
      w.AudioContext = class { currentTime = 0; destination = {}; resume() { return Promise.resolve(); } createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name: 'Pip', createdAt: 1, settings, game: { xp: 0, gems: 5, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
      }
    },
    { kid: KID, settings },
  );
}

async function openAdventure(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: 'Adventure' }).click();
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
  await page.waitForTimeout(400);
}

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null): Box | null => (el ? (({ left, top, right, bottom, width, height }) => ({ left, top, right, bottom, width, height }))(el.getBoundingClientRect()) : null);
    const q = (s: string) => document.querySelector(s);
    const canvas = q('.ow-canvas') as HTMLCanvasElement;
    const arrow = (d: string) => box(document.querySelector(`[aria-label="Walk ${d}"]`));
    return {
      inner: { w: window.innerWidth, h: window.innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      home: box(q('.ow-hud .hold-btn')),
      mute: box(q('.ow-hud .mute-btn')),
      arrows: { up: arrow('up'), left: arrow('left'), down: arrow('down'), right: arrow('right') },
      canvas: box(canvas),
      canvasPx: { w: canvas.width, h: canvas.height },
      tile: Number(canvas.dataset.tile),
      dpr: window.devicePixelRatio,
    };
  });
}
type M = Awaited<ReturnType<typeof measure>>;

const inside = (b: Box | null, w: number, h: number) => !!b && b.left >= 0 && b.top >= 0 && b.right <= w && b.bottom <= h;

function check(m: M, learner: string, label: string) {
  const { w, h } = m.inner;
  expect(m.scrollWidth, `${label} scrollWidth`).toBeLessThanOrEqual(w);
  expect(m.bodyScrollWidth, `${label} body scrollWidth`).toBeLessThanOrEqual(w);
  expect(inside(m.home, w, h), `${label} Home inside`).toBe(true);
  expect(inside(m.mute, w, h), `${label} mute inside`).toBe(true);
  for (const [d, b] of Object.entries(m.arrows)) expect(inside(b, w, h), `${label} arrow ${d} inside`).toBe(true);
  expect(m.canvas!.width / m.tile, `${label} tiles across`).toBeGreaterThanOrEqual(11);
  expect(m.canvas!.height / m.tile, `${label} tiles down`).toBeGreaterThanOrEqual(7);
  expect(m.canvasPx.w, `${label} canvas px`).toBe(Math.round(m.canvas!.width * Math.max(1, Math.round(m.dpr))));
  if (learner === 'prereader') {
    for (const [n, b] of [['Home', m.home], ['mute', m.mute], ...Object.entries(m.arrows)] as Array<[string, Box | null]>) {
      expect(b!.width, `${label} ${n} width`).toBeGreaterThanOrEqual(120);
      expect(b!.height, `${label} ${n} height`).toBeGreaterThanOrEqual(120);
    }
  }
}

for (const [name, settings] of [['prereader', PRE], ['reader', READER]] as const)
  for (const { w, h } of VIEWPORTS)
    test(`${name} ${w}x${h}: Adventure fits, controls are inside and big enough`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page, settings);
      await openAdventure(page);
      check(await measure(page), name, `${name} ${w}x${h}`);
      if (SHOTS && w === 1024 && h === 768) await page.screenshot({ path: `${SHOTS}/${name}-adventure-1024x768.png` });
    });

for (const [name, settings] of [['prereader', PRE], ['reader', READER]] as const)
  test(`${name}: rotating mid-trip keeps everything inside and the canvas re-sized`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await seed(page, settings);
    await openAdventure(page);
    check(await measure(page), name, 'landscape');
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(400);
    check(await measure(page), name, 'portrait');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(400);
    check(await measure(page), name, 'landscape again');
  });

test('a pre-reader Picture Run in landscape fits: no sideways scroll, top bar inside', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await seed(page, PRE);
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.early-top')).toBeVisible();
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, iw: window.innerWidth,
    bad: [...document.querySelectorAll('.early-top button, .choice')].filter((e) => { const b = e.getBoundingClientRect(); return b.left < 0 || b.right > window.innerWidth; }).length,
  }));
  expect(r.sw).toBeLessThanOrEqual(r.iw);
  expect(r.bad).toBe(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/prereader-picture-run-1024x768.png` });
});
