import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { seed } from './harness/lightning';

/**
 * adventure-pad-toast guard (TENSOR task anbU4hhJ): in Adventure the walk pad stays small and an Adventure toast never has its
 * close control on top of its text. 1024x650 and 1080x700 (landscape with the address bar), 768x900 and 810x960 (portrait),
 * reader and picture player. PAD_SHOTS=<dir> writes a PNG per case (fixture kid only, keep them local).
 */
const VIEWPORTS = [
  { w: 1024, h: 650 },
  { w: 1080, h: 700 },
  { w: 768, h: 900 },
  { w: 810, h: 960 },
];
const PAD_CAP = 0.12; // the 4 arrows' bounding box over the map area
const SHOTS = process.env.PAD_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

type Ow = { tapTile(x: number, y: number): void };
async function openAdventure(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).tap();
  await page.getByRole('button', { name: 'Adventure' }).tap();
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
  await page.waitForTimeout(500);
}

/** Taps tiles in the map corner until the "You can't walk there." toast shows. */
async function showToast(page: Page) {
  const msg = page.getByTestId('ow-msg');
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      await page.evaluate(([tx, ty]) => (window as unknown as { __ow: Ow }).__ow.tapTile(tx!, ty!), [x, y]);
      if (await msg.isVisible()) return msg;
    }
  }
  await expect(msg).toBeVisible();
  return msg;
}

for (const who of ['reader', 'prereader'] as const) {
  for (const vp of VIEWPORTS) {
    test.describe(`adventure pad and toast ${who} ${vp.w}x${vp.h}`, () => {
      test.use({ viewport: { width: vp.w, height: vp.h } });
      test.setTimeout(60_000);

      test(`the walk pad covers at most ${PAD_CAP * 100}% of the map`, async ({ page }) => {
        await seed(page, { learner: who });
        await openAdventure(page);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${who}-${vp.w}x${vp.h}-pad.png` });
        const m = await page.evaluate(() => {
          const rs = ['up', 'down', 'left', 'right'].map((d) => document.querySelector(`[aria-label="Walk ${d}"]`)!.getBoundingClientRect());
          const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top));
          const r = Math.max(...rs.map((x) => x.right)), b = Math.max(...rs.map((x) => x.bottom));
          const c = document.querySelector('.ow-canvas')!.getBoundingClientRect();
          return { pad: (r - l) * (b - t), map: c.width * c.height, w: r - l, h: b - t };
        });
        expect(m.pad / m.map, `pad ${Math.round(m.w)}x${Math.round(m.h)} over map ${Math.round(m.map)}`).toBeLessThanOrEqual(PAD_CAP);
      });

      test('the HUD counters stay on one row, "+N" included', async ({ page }) => {
        await seed(page, { learner: who });
        await openAdventure(page);
        const rows = await page.evaluate(() => {
          const tops = (sel: string) => Array.from(document.querySelectorAll(sel)).map((e) => Math.round(e.getBoundingClientRect().top / 8));
          const stats = tops('.ow-hud .ow-stat');
          const left = tops('.ow-remaining > *');
          return { stats: new Set(stats).size, left: new Set(left).size, n: left.length };
        });
        expect(rows.stats, 'gems, keys and chests share a row').toBe(1);
        expect(rows.left, `${rows.n} monster icons and "+N" share a row`).toBe(1);
      });

      test('the toast close control does not touch its text', async ({ page }) => {
        await seed(page, { learner: who });
        await openAdventure(page);
        const msg = await showToast(page);
        await page.waitForTimeout(300);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${who}-${vp.w}x${vp.h}-toast.png` });
        const m = await msg.evaluate((el) => {
          const p = el.querySelector('p')!;
          const range = document.createRange();
          range.selectNodeContents(p);
          const t = range.getBoundingClientRect();
          const x = el.querySelector('button[aria-label="Close"]')!.getBoundingClientRect();
          const o = el.getBoundingClientRect();
          return { text: { l: t.left, t: t.top, r: t.right, b: t.bottom }, x: { l: x.left, t: x.top, r: x.right, b: x.bottom }, box: { l: o.left, r: o.right, w: window.innerWidth } };
        });
        const hit = m.text.l < m.x.r && m.x.l < m.text.r && m.text.t < m.x.b && m.x.t < m.text.b;
        expect(hit, `text ${JSON.stringify(m.text)} vs close ${JSON.stringify(m.x)}`).toBe(false);
        expect(m.box.l, 'toast inside viewport, left').toBeGreaterThanOrEqual(0);
        expect(m.box.r, 'toast inside viewport, right').toBeLessThanOrEqual(m.box.w);
      });
    });
  }
}
