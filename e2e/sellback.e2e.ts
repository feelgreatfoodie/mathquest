import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Selling back (item powers PDR, section 4), offline mode. Pip and Moss are readers, Wren is a pre-reader; names, ids and the parent PIN are made up.
 * A kid sells an owned shop item for half its price: one confirm, the gems rise, the item leaves the owned list and its equipped slot, and a
 * sale record goes on purchases. A gifted item is locked for 7 days. The parent area holds the on/off switch. The voice is stubbed and recorded.
 * SELL_SHOTS=1 writes screenshots to docs/screenshots/sellback (SELL_SHOTS_DIR overrides).
 */
const SHOTS = process.env.SELL_SHOTS ? (process.env.SELL_SHOTS_DIR ?? 'docs/screenshots/sellback') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PIP = 'kidsellpip00000000001';
const WREN = 'kidsellwren0000000002';
const MOSS = 'kidsellmoss0000000003';
const PARENT_PIN = String(randomInt(1000, 10000));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const VIEWPORTS = [{ w: 820, h: 1180 }, { w: 1024, h: 768 }, { w: 393, h: 852 }];

const READER = { shop2: true, tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
const PRE = { shop2: true, learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };

interface Seed {
  wrenSettings?: Record<string, unknown>;
  family?: Record<string, unknown>;
  /** Pip also owns a cape that Moss gave 2 days ago (locked for 5 more days). */
  giftedCape?: boolean;
  /** Pip owns a cape gifted 9 days ago (sellable). */
  oldGift?: boolean;
  muteWren?: boolean;
}
async function seed(page: Page, o: Seed = {}) {
  await page.addInitScript(
    ({ ids, readerS, preS, pinHash, family, wrenSettings, giftedCape, oldGift, muteWren }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
      class Utter { text: string; lang = ''; rate = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
      w.AudioContext = class { currentTime = 0; destination = {}; resume() { return Promise.resolve(); } createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
      if (localStorage.getItem('mathquest:v1:kids')) return;
      const DAY = 24 * 60 * 60 * 1000;
      const g = (gems: number, extra: Record<string, unknown> = {}) => ({ xp: 300, gems, heroes: ['knight'], hero: 'knight', streakDays: 3, lastPlayedDay: null, bestCombo: 5, ...extra });
      const pipGift = giftedCape ? { giftFrom: { 'g-cape': ids.moss }, giftAt: { 'g-cape': Date.now() - 2 * DAY } } : oldGift ? { giftFrom: { 'g-cape': ids.moss }, giftAt: { 'g-cape': Date.now() - 9 * DAY } } : {};
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1, ...family }));
      localStorage.setItem('mathquest:v1:kids', JSON.stringify([
        { id: ids.pip, name: 'Pip', createdAt: 1, settings: readerS, game: g(100, { items: ['c-flag', 'w-bow', ...(giftedCape || oldGift ? ['g-cape'] : [])], equipped: { weapon: 'w-bow' }, gemsEarnedToday: 6, gemsDay: '2026-11-21', ...pipGift }) },
        { id: ids.wren, name: 'Wren', createdAt: 2, settings: { ...preS, ...wrenSettings }, game: g(100, { items: ['w-bow', 'g-goldarmor'], equipped: { weapon: 'w-bow' } }) },
        { id: ids.moss, name: 'Moss', createdAt: 3, settings: readerS, game: g(0) },
      ]));
      if (muteWren) localStorage.setItem(`mathquest:v1:mute:${ids.wren}`, '1');
    },
    { ids: { pip: PIP, wren: WREN, moss: MOSS }, readerS: READER, preS: PRE, pinHash: sha(`mathquest:local:${PARENT_PIN}`), family: o.family ?? {}, wrenSettings: o.wrenSettings ?? {}, giftedCape: o.giftedCape ?? false, oldGift: o.oldGift ?? false, muteWren: o.muteWren ?? false },
  );
}

// The speech unlock speaks a blank utterance once; only real words count.
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.filter((t) => t.trim() !== ''));
const stored = <T,>(page: Page, key: string, fallback: T) => page.evaluate(([k, f]) => JSON.parse(localStorage.getItem(`mathquest:v1:${k}`) ?? (f as string)), [key, JSON.stringify(fallback)] as const) as Promise<T>;
const kidDoc = async (page: Page, id: string) => (await stored<{ id: string; game: Record<string, unknown> }[]>(page, 'kids', [])).find((k) => k.id === id)!;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  const vp = page.viewportSize()!;
  await page.screenshot({ path: `${SHOTS}/${name}-${vp.width}x${vp.height}.png` });
}
const item = (page: Page, id: string) => page.locator(`[data-item="${id}"]`);
async function openAs(page: Page, name: string) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: name }).click();
}
async function openReaderShop(page: Page) {
  await openAs(page, 'Pip');
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Hero shop' })).toBeVisible();
  await page.locator('[data-tab="weapon"]').click();
}
async function openPrereaderShop(page: Page) {
  await openAs(page, 'Wren');
  await page.getByRole('button', { name: 'Hero shop' }).click();
  await expect(page.locator('.pshop')).toBeVisible();
  await page.locator('[data-tab="weapon"]').click();
}
async function box(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox();
  expect(b, sel).not.toBeNull();
  return b!;
}
async function openParent(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /grown-ups/i }).first().click();
  for (const d of PARENT_PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test('reader sells the equipped bow: one confirm, +27 gems, the item and its slot go, the sale record is written, the throttle fields stay', async ({ page }) => {
      await seed(page);
      await openReaderShop(page);
      await item(page, 'w-bow').getByTestId('sell-button').click();
      const sheet = page.getByTestId('sell-sheet');
      await expect(sheet).toBeVisible();
      await expect(page.getByTestId('sell-confirm-text')).toHaveText('Sell the Bow for 27 gems?');
      await expect(sheet).toContainText('It comes off your hero first.');
      await shot(page, 'sell-reader-confirm');
      // Nothing has moved before the confirm.
      expect((await kidDoc(page, PIP)).game.gems).toBe(100);
      await page.getByTestId('sell-no').click();
      await expect(sheet).toHaveCount(0);
      expect((await kidDoc(page, PIP)).game.gems).toBe(100);
      await item(page, 'w-bow').getByTestId('sell-button').click();
      await page.getByTestId('sell-yes').click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(async () => (await kidDoc(page, PIP)).game.gems).toBe(127);
      const pip = await kidDoc(page, PIP);
      expect(pip.game).toMatchObject({ items: ['c-flag'], gemsEarnedToday: 6, gemsDay: '2026-11-21', xp: 300 });
      expect(pip.game.equipped).toBeUndefined();
      expect(await stored(page, `purchases:${PIP}`, [])).toMatchObject([{ kind: 'sale', itemId: 'w-bow', refund: 27 }]);
      // The bow is for sale again at the full price, with no Sell button.
      await expect(item(page, 'w-bow')).toHaveAttribute('data-state', 'locked');
      await expect(item(page, 'w-bow').getByTestId('sell-button')).toHaveCount(0);
      await shot(page, 'sell-reader-after');
    });

    test('a gifted item inside its 7 days is locked: the shop says how long, and there is no Sell button; after 7 days it sells', async ({ page }) => {
      await seed(page, { giftedCape: true });
      await openReaderShop(page);
      await page.locator('[data-tab="gear"]').click();
      await expect(item(page, 'g-cape').getByTestId('sell-locked')).toHaveText('You can sell this in 5 days');
      await expect(item(page, 'g-cape').getByTestId('sell-button')).toHaveCount(0);
      await shot(page, 'sell-gift-locked');
      expect((await kidDoc(page, PIP)).game.gems).toBe(100);
    });

    test('a gift from 9 days ago sells, and its gift notes go with it', async ({ page }) => {
      await seed(page, { oldGift: true });
      await openReaderShop(page);
      await page.locator('[data-tab="gear"]').click();
      await item(page, 'g-cape').getByTestId('sell-button').click();
      await expect(page.getByTestId('sell-confirm-text')).toHaveText('Sell the Cape for 7 gems?');
      await page.getByTestId('sell-yes').click();
      await expect.poll(async () => (await kidDoc(page, PIP)).game.gems).toBe(107);
      const pip = await kidDoc(page, PIP);
      expect(pip.game.items).toEqual(['c-flag', 'w-bow']);
      expect(pip.game.giftFrom).toBeUndefined();
      expect(pip.game.giftAt).toBeUndefined();
    });

    test('pre-reader sells the bow: sell button, items, confirm and cancel are 120 px or more; the voice asks and answers; the gems rise', async ({ page }) => {
      await seed(page);
      await openPrereaderShop(page);
      await shot(page, 'sell-prereader-shop');
      const mode = await box(page, '[data-testid="sell-mode"]');
      expect(mode.width).toBeGreaterThanOrEqual(120);
      expect(mode.height).toBeGreaterThanOrEqual(120);
      await page.getByTestId('sell-mode').click();
      await expect.poll(() => spoken(page)).toContain('Tap what you want to sell.');
      await expect(item(page, 'w-bow')).toHaveClass(/is-sell/);
      await shot(page, 'sell-prereader-mode');
      await item(page, 'w-bow').click();
      await expect(page.getByTestId('sell-sheet')).toBeVisible();
      await expect.poll(() => spoken(page)).toContain('Sell the Bow for 27 gems?');
      await expect(page.getByTestId('sell-refund')).toContainText('27');
      for (const sel of ['[data-testid="sell-yes"]', '[data-testid="sell-no"]']) {
        const b = await box(page, sel);
        expect(b.width, sel).toBeGreaterThanOrEqual(120);
        expect(b.height, sel).toBeGreaterThanOrEqual(120);
      }
      await shot(page, 'sell-prereader-confirm');
      expect((await kidDoc(page, WREN)).game.gems).toBe(100);
      await page.getByTestId('sell-yes').click();
      await expect.poll(() => spoken(page)).toContain('You sold the Bow!');
      await expect.poll(async () => (await kidDoc(page, WREN)).game.gems).toBe(127);
      const wren = await kidDoc(page, WREN);
      expect(wren.game.items).toEqual(['g-goldarmor']);
      expect(wren.game.equipped).toBeUndefined();
      expect(await stored(page, `purchases:${WREN}`, [])).toMatchObject([{ kind: 'sale', itemId: 'w-bow', refund: 27 }]);
    });

    test('a legendary item has no sell option for a pre-reader or a reader', async ({ page }) => {
      await seed(page);
      await openPrereaderShop(page);
      await page.getByTestId('sell-mode').click();
      await page.locator('[data-tab="gear"]').click();
      await expect(item(page, 'g-goldarmor')).not.toHaveClass(/is-sell/);
      await item(page, 'g-goldarmor').click();
      await expect(page.getByTestId('sell-sheet')).toHaveCount(0);
      expect((await kidDoc(page, WREN)).game.gems).toBe(100);
    });
  });
}

test.describe('820x1180 rules of the road', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('a hero and a legendary item show no Sell button, and every Sell button is 48 px or taller', async ({ page }) => {
    await seed(page);
    await openReaderShop(page);
    await page.locator('[data-tab="hero"]').click();
    await expect(page.getByTestId('sell-button')).toHaveCount(0);
    await page.locator('[data-tab="gear"]').click();
    await expect(page.getByTestId('sell-button')).toHaveCount(0);
    await page.locator('[data-tab="weapon"]').click();
    await expect(item(page, 'w-crystalstaff').getByTestId('sell-button')).toHaveCount(0);
    for (const b of await page.getByTestId('sell-button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await page.locator('[data-tab="camp"]').click();
    await expect(item(page, 'c-flag').getByTestId('sell-button')).toHaveCount(1);
  });

  test('voice off: the pre-reader sale is silent, and it still works', async ({ page }) => {
    await seed(page, { wrenSettings: { voice: 'off' } });
    await openPrereaderShop(page);
    await page.getByTestId('sell-mode').click();
    await item(page, 'w-bow').click();
    await page.getByTestId('sell-yes').click();
    await expect.poll(async () => (await kidDoc(page, WREN)).game.gems).toBe(127);
    expect(await spoken(page)).toEqual([]);
  });

  test('muted: the pre-reader sale is silent, and it still works', async ({ page }) => {
    await seed(page, { muteWren: true });
    await openPrereaderShop(page);
    await page.getByTestId('sell-mode').click();
    await item(page, 'w-bow').click();
    await page.getByTestId('sell-yes').click();
    await expect.poll(async () => (await kidDoc(page, WREN)).game.gems).toBe(127);
    expect(await spoken(page)).toEqual([]);
  });

  test('the grown-up turns selling off: no Sell button for a reader or a pre-reader, the history shows the sale; back on, the button returns', async ({ page }) => {
    await seed(page);
    await openReaderShop(page);
    await item(page, 'w-bow').getByTestId('sell-button').click();
    await page.getByTestId('sell-yes').click();
    await expect.poll(async () => (await kidDoc(page, PIP)).game.gems).toBe(127);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Switch player' }).click();
    await openParent(page);
    const panel = page.getByTestId('selling-panel');
    await expect(panel).toBeVisible();
    await shot(page, 'sell-parent-panel');
    const toggle = page.getByTestId('selling-toggle');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect.poll(async () => (await stored<{ selling?: boolean }>(page, 'family', {})).selling).toBe(false);
    // The sale shows in Pip's gem history as a Sold line.
    await page.locator('.tab', { hasText: 'Pip' }).click();
    await expect(page.locator('.gem-history')).toContainText('Sold: Bow (+27 gems)');
    await page.getByRole('button', { name: 'Back to game' }).click();
    await page.locator('.kid-card', { hasText: 'Pip' }).click();
    await page.getByRole('button', { name: 'Shop', exact: true }).click();
    await page.locator('[data-tab="camp"]').click();
    await expect(item(page, 'c-flag')).toBeVisible();
    await expect(page.getByTestId('sell-button')).toHaveCount(0);
    await shot(page, 'sell-off-reader');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Switch player' }).click();
    await page.locator('.kid-card', { hasText: 'Wren' }).click();
    await page.getByRole('button', { name: 'Hero shop' }).click();
    await expect(page.locator('.pshop')).toBeVisible();
    await expect(page.getByTestId('sell-mode')).toHaveCount(0);
    await openParent(page);
    await page.getByTestId('selling-toggle').check();
    await expect.poll(async () => (await stored<{ selling?: boolean }>(page, 'family', {})).selling).toBe(true);
  });
});
