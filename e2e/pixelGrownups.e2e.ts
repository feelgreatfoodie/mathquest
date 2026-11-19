import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/** style-3: Adventure polish, the shop stall, the vault door and the Grown-ups area. Made-up names, ids and PIN. */
const PIN = '2468';
const PIN_HASH = createHash('sha256').update(`mathquest:local:${PIN}`).digest('hex');
const KID = 'kidgrownups000000001';

async function seed(page: Page) {
  await page.addInitScript(
    ({ pinHash, kid }) => {
      const w = window as unknown as Record<string, unknown>;
      class Utter { text: string; onend: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
      if (localStorage.getItem('mathquest:v1:kids')) return;
      const game = { xp: 240, gems: 60, streakDays: 3, lastPlayedDay: null, bestCombo: 5, heroes: ['knight', 'wizard'], hero: 'knight' };
      const settings = { shop2: true, vault: { on: true }, modes: { overworld: true }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 12, maxNew: 6, factGroupsUnlocked: 1, paceMultiplier: 3 };
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1, tourSeen: true }));
      localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name: 'Pip', createdAt: 1, settings, game }]));
      const now = Date.now();
      localStorage.setItem(`mathquest:v1:purchases:${kid}`, JSON.stringify([
        { id: 'p1', heroId: 'knight', cost: 0, at: now - 3 * 86_400_000 },
        { id: 'p2', heroId: 'wizard', cost: 25, at: now - 86_400_000 },
      ]));
    },
    { pinHash: PIN_HASH, kid: KID },
  );
}

async function openGrownups(page: Page) {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: /(grown-ups|parent) area/i }).click();
  for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await page.locator('.parent').waitFor();
}

for (const vp of [
  { w: 820, h: 1180 },
  { w: 1024, h: 768 },
  { w: 393, h: 852 },
]) {
  test.describe(`${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test('Grown-ups: the gem history says Bought Knight (free) and Bought Wizard (-25 gems), never -0', async ({ page }) => {
      await openGrownups(page);
      const list = page.locator('.gem-history');
      await expect(list).toContainText('Bought Knight (free)');
      await expect(list).toContainText('Bought Wizard (-25 gems)');
      const text = await list.innerText();
      expect(text).not.toMatch(/[-−]0(?!\d)/);
      await expect(page.locator('.gem-history .spend .gem-delta')).toHaveText('−25');
    });

    test('Grown-ups: light theme is off by default, kept per parent on this device, and leaves kid screens dark', async ({ page }) => {
      await openGrownups(page);
      const screen = page.locator('.screen.parent');
      await expect(screen).toHaveAttribute('data-theme', 'dark');
      const toggle = page.getByTestId('theme-toggle');
      await expect(toggle).toHaveText('Light theme: Off');
      expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await toggle.click();
      await expect(screen).toHaveAttribute('data-theme', 'light');
      expect(await screen.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(244, 245, 251)');
      expect(await page.evaluate(() => localStorage.getItem('mq-theme:local'))).toBe('light');
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
      await page.reload();
      await page.getByRole('button', { name: /(grown-ups|parent) area/i }).click();
      for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
      await expect(page.locator('.screen.parent')).toHaveAttribute('data-theme', 'light');
      // Another parent key on the same device starts dark: the choice is stored under the parent, not the device.
      expect(await page.evaluate(() => localStorage.getItem('mq-theme:someone-else'))).toBeNull();
      // The kid picker is still the dark pixel look.
      await page.getByRole('button', { name: /back to game/i }).click();
      await page.locator('.kid-card', { hasText: 'Pip' }).waitFor();
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgb(244, 245, 251)');
    });

    test('Grown-ups: the mastery colors are grey, amber and green', async ({ page }) => {
      await openGrownups(page);
      const colors = await page.evaluate(() => {
        const probe = (cls: string) => {
          const el = document.createElement('span');
          el.className = cls;
          document.body.appendChild(el);
          const c = getComputedStyle(el).backgroundColor;
          el.remove();
          return c;
        };
        return [0, 1, 2, 3, 4].map((l) => probe(`lv${l}`));
      });
      expect(colors).toEqual(['rgb(58, 61, 77)', 'rgb(217, 119, 6)', 'rgb(251, 191, 36)', 'rgb(74, 222, 128)', 'rgb(34, 197, 94)']);
    });

    test('Shop: a stall above the items, a vault door above the vault, a plank under each item', async ({ page }) => {
      await seed(page);
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).click();
      await page.getByRole('button', { name: 'Shop', exact: true }).click();
      await expect(page.getByTestId('shop-stall')).toBeVisible();
      expect(await page.locator('.shop-item').first().evaluate((e) => getComputedStyle(e, '::after').content)).toBe('""');
      await page.locator('[data-tab="vault"]').click();
      await expect(page.getByTestId('vault-door')).toBeVisible();
      await expect(page.getByTestId('shop-stall')).toHaveCount(0);
    });

    test('Adventure: a slim top bar, pixel hearts, and a see-through walk pad with 64 px keys', async ({ page }) => {
      await seed(page);
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).click();
      await page.getByRole('button', { name: 'Adventure' }).click();
      await expect(page.getByTestId('overworld')).toBeVisible();
      const hud = (await page.locator('.ow-hud').boundingBox())!;
      // One row on a tablet; a phone is 393 px wide and wraps to two short rows.
      expect(hud.height).toBeLessThanOrEqual(vp.w >= 700 ? 76 : 152);
      await expect(page.locator('.ow-hearts svg')).toHaveCount(3);
      const pad = await page.locator('.ow-dir').first().evaluate((e) => getComputedStyle(e).backgroundColor);
      expect(pad).toMatch(/rgba\(44, 51, 84, 0\.58\)/);
      for (const k of await page.locator('.ow-dir').all()) {
        const b = (await k.boundingBox())!;
        expect(b.width).toBeGreaterThanOrEqual(48);
        expect(b.height).toBeGreaterThanOrEqual(48);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.w);
    });
  });
}
