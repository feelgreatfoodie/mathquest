import { expect, test, type Page } from '@playwright/test';

/**
 * The clear X and the go check are drawn at the size of the number glyphs on the same keypad: the ink of the icon
 * reaches at least 80% of a digit's ink height, and sits in the middle of its key. Every keypad, at 1024x768,
 * 1024x650 and 820x1180. The pads run on e2e/harness/keys.html (the in-game panels render the same components).
 * KEYPAD_SHOTS=<dir> writes PNGs there. Fixture data only.
 */
const SHOTS = process.env.KEYPAD_SHOTS ?? null;
const VIEWPORTS = [
  { w: 1024, h: 768 },
  { w: 1024, h: 650 },
  { w: 820, h: 1180 },
];

interface Spec {
  pad: string;
  /** The key that carries the icon. */
  icons: { name: string; sel: string }[];
  /** A number key whose glyph is the reference, or null when the pad has no numbers (a 120 px pad's 64 px digit stands in). */
  digit: string | null;
}
const SPECS: Spec[] = [
  { pad: 'keypad', icons: [{ name: 'Delete', sel: '.key-back' }, { name: 'Go', sel: '.key-go' }], digit: '.keypad .key:not(.key-back):not(.key-go)' },
  { pad: 'numpad', icons: [{ name: 'Clear', sel: '[aria-label="Clear"]' }, { name: 'OK', sel: '[aria-label="OK"]' }], digit: '.numpad-key[aria-label="8"]' },
  { pad: 'pin', icons: [{ name: 'Delete', sel: '.key-back' }], digit: '.keypad .key:not(.key-back):not(.key-spacer)' },
  { pad: 'picture', icons: [{ name: 'Not me', sel: '.picture-cancel' }], digit: null },
];

/** Ink height of an "8" in the key's own font, and the ink rect of the icon inside the key. */
async function measure(page: Page, iconSel: string, digitSel: string | null) {
  return page.evaluate(
    async ([iconSel, digitSel]) => {
      await document.fonts.ready;
      const key = document.querySelector(iconSel!) as HTMLElement;
      let digitH: number;
      if (digitSel) {
        const d = document.querySelector(digitSel) as HTMLElement;
        const cs = getComputedStyle(d);
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const m = ctx.measureText('8');
        digitH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      } else {
        digitH = 56; // 0.875 em of the 64 px digit on a 120 px key
      }
      const shapes = [...key.querySelectorAll('svg path, svg rect, svg line, svg circle')] as SVGGraphicsElement[];
      const rects = shapes.map((s) => s.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) return { digitH, inkH: 0, offX: 0, offY: 0, strokeless: true };
      const l = Math.min(...rects.map((r) => r.left)), t = Math.min(...rects.map((r) => r.top));
      const r = Math.max(...rects.map((r) => r.right)), b = Math.max(...rects.map((r) => r.bottom));
      const k = key.getBoundingClientRect();
      return { digitH, inkH: b - t, offX: (l + r) / 2 - (k.left + k.right) / 2, offY: (t + b) / 2 - (k.top + k.bottom) / 2, strokeless: false };
    },
    [iconSel, digitSel] as const,
  );
}

for (const vp of VIEWPORTS) {
  test.describe(`keypad icons at ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });
    for (const spec of SPECS) {
      test(`${spec.pad}: X and check reach 80% of a digit and sit centered`, async ({ page }) => {
        await page.goto(`/e2e/harness/keys.html?pad=${spec.pad}`);
        await expect(page.locator(spec.icons[0]!.sel)).toBeVisible();
        for (const icon of spec.icons) {
          const m = await measure(page, icon.sel, spec.digit);
          const msg = `${spec.pad} ${icon.name}: icon ink ${m.inkH.toFixed(1)} px vs digit ink ${m.digitH.toFixed(1)} px (${((m.inkH / m.digitH) * 100).toFixed(0)}%)`;
          expect(m.inkH, msg).toBeGreaterThanOrEqual(0.8 * m.digitH);
          expect(Math.abs(m.offX), `${spec.pad} ${icon.name} off center x`).toBeLessThanOrEqual(3);
          expect(Math.abs(m.offY), `${spec.pad} ${icon.name} off center y`).toBeLessThanOrEqual(3);
        }
        if (SHOTS && vp.w === 1024 && vp.h === 768) await page.screenshot({ path: `${SHOTS}/${spec.pad}-1024x768.png` });
      });
    }
  });
}
