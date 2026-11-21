import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Gifting (item powers PDR, section 3), offline mode. Pip and Moss are readers, Wren is a pre-reader; names, ids and the parent PIN are made up.
 * A kid buys a shop item for a sibling: the giver pays, the item lands in the receiver's owned list with giftFrom, a purchases record
 * (kind gift) goes on the giver and a gift record on the receiver. The receiver sees a wrapped present on the next Home load. The parent
 * area holds the on/off switch and the history. The voice is stubbed and recorded.
 * GIFT_SHOTS=1 writes screenshots to docs/screenshots/gifting (GIFT_SHOTS_DIR overrides).
 */
const SHOTS = process.env.GIFT_SHOTS ? (process.env.GIFT_SHOTS_DIR ?? 'docs/screenshots/gifting') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PIP = 'kidgiftpip00000000001';
const WREN = 'kidgiftwren0000000002';
const MOSS = 'kidgiftmoss0000000003';
const PARENT_PIN = String(randomInt(1000, 10000));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const VIEWPORTS = [{ w: 820, h: 1180 }, { w: 1024, h: 768 }, { w: 393, h: 852 }];

const READER = { shop2: true, tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
const PRE = { shop2: true, learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const game = (gems: number, extra: Record<string, unknown> = {}) => ({ xp: 300, gems, heroes: ['knight'], hero: 'knight', streakDays: 3, lastPlayedDay: null, bestCombo: 5, ...extra });

interface Seed {
  wrenSettings?: Record<string, unknown>;
  /** Pip already gave Wren the bow: the records are in storage and Wren has not opened the present. */
  given?: boolean;
  family?: Record<string, unknown>;
}
async function seed(page: Page, o: Seed = {}) {
  await page.addInitScript(
    ({ ids, readerS, preS, pinHash, given, family, wrenSettings }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
      class Utter { text: string; lang = ''; rate = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
      w.AudioContext = class { currentTime = 0; destination = {}; resume() { return Promise.resolve(); } createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
      if (localStorage.getItem('mathquest:v1:kids')) return;
      const g = (gems: number, extra: Record<string, unknown> = {}) => ({ xp: 300, gems, heroes: ['knight'], hero: 'knight', streakDays: 3, lastPlayedDay: null, bestCombo: 5, ...extra });
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1, ...family }));
      localStorage.setItem('mathquest:v1:kids', JSON.stringify([
        { id: ids.pip, name: 'Pip', createdAt: 1, settings: readerS, game: g(given ? 145 : 200, given ? { lastPurchaseId: 'g-old' } : {}) },
        { id: ids.wren, name: 'Wren', createdAt: 2, settings: { ...preS, ...wrenSettings }, game: g(given ? 5 : 150, given ? { items: ['w-bow'], giftFrom: { 'w-bow': ids.pip } } : {}) },
        { id: ids.moss, name: 'Moss', createdAt: 3, settings: readerS, game: g(0) },
      ]));
      if (given) {
        localStorage.setItem(`mathquest:v1:purchases:${ids.pip}`, JSON.stringify([{ id: 'g-old', kind: 'gift', to: ids.wren, itemId: 'w-bow', cost: 55, at: Date.now() - 60_000 }]));
        localStorage.setItem(`mathquest:v1:gifts:${ids.wren}`, JSON.stringify([{ id: 'g-old', from: ids.pip, itemId: 'w-bow', at: Date.now() - 60_000, seen: false }]));
      }
    },
    { ids: { pip: PIP, wren: WREN, moss: MOSS }, readerS: READER, preS: PRE, pinHash: sha(`mathquest:local:${PARENT_PIN}`), given: o.given ?? false, family: o.family ?? {}, wrenSettings: o.wrenSettings ?? {} },
  );
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
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
async function box(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox();
  expect(b, sel).not.toBeNull();
  return b!;
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test('reader gives the bow: pick a sibling, one confirm, the giver pays, the receiver owns it with giftFrom, both records are written', async ({ page }) => {
      await seed(page);
      await openReaderShop(page);
      await item(page, 'w-bow').getByTestId('gift-button').click();
      const sheet = page.getByTestId('gift-sheet');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('[data-sibling]')).toHaveCount(2);
      await shot(page, 'gift-reader-pick');
      await sheet.locator(`[data-sibling="${WREN}"]`).click();
      await expect(page.getByTestId('gift-confirm-text')).toHaveText('Give the Bow to Wren for 55 gems?');
      await shot(page, 'gift-reader-confirm');
      // Nothing has moved before the confirm.
      expect((await kidDoc(page, PIP)).game.gems).toBe(200);
      await page.getByTestId('gift-yes').click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(async () => (await kidDoc(page, PIP)).game.gems).toBe(145);
      const pip = await kidDoc(page, PIP);
      expect(pip.game.items).toBeUndefined();
      const wren = await kidDoc(page, WREN);
      expect(wren.game).toMatchObject({ gems: 150, items: ['w-bow'], giftFrom: { 'w-bow': PIP } });
      expect(await stored(page, `purchases:${PIP}`, [])).toMatchObject([{ kind: 'gift', to: WREN, itemId: 'w-bow', cost: 55 }]);
      expect(await stored(page, `gifts:${WREN}`, [])).toMatchObject([{ from: PIP, itemId: 'w-bow', seen: false }]);
      // The giver still sees the bow for sale, and Wren shows as already having it.
      await item(page, 'w-bow').getByTestId('gift-button').click();
      await expect(page.getByTestId('gift-sheet').locator(`[data-sibling="${WREN}"]`)).toBeDisabled();
      await expect(page.getByTestId('gift-sheet').locator(`[data-sibling="${WREN}"]`)).toContainText('has it');
      await expect(page.getByTestId('gift-sheet').locator(`[data-sibling="${MOSS}"]`)).toBeEnabled();
    });

    test('the receiver sees a wrapped present on the next Home load, hears it, opens it, and it does not come back', async ({ page }) => {
      await seed(page, { given: true });
      await openAs(page, 'Wren');
      const present = page.getByTestId('gift-present');
      await expect(present).toBeVisible();
      await expect(page.getByTestId('gift-headline')).toHaveText('A gift from Pip!');
      await expect.poll(() => spoken(page)).toContain('A gift from Pip!');
      const open = await box(page, '[data-testid="gift-open"]');
      expect(open.width).toBeGreaterThanOrEqual(120);
      expect(open.height).toBeGreaterThanOrEqual(120);
      await shot(page, 'gift-present-wrapped');
      await page.getByTestId('gift-open').click();
      await expect(page.getByTestId('gift-opened')).toBeVisible();
      await expect.poll(() => spoken(page)).toContain('You got the Bow!');
      const done = await box(page, '[data-testid="gift-done"]');
      expect(done.width).toBeGreaterThanOrEqual(120);
      expect(done.height).toBeGreaterThanOrEqual(120);
      await shot(page, 'gift-present-opened');
      await page.getByTestId('gift-done').click();
      await expect(page.getByTestId('gift-opened')).toHaveCount(0);
      await expect.poll(async () => (await stored<{ seen: boolean }[]>(page, `gifts:${WREN}`, []))[0]!.seen).toBe(true);
      await openAs(page, 'Wren');
      await expect(page.locator('.early-home')).toBeVisible();
      await expect(page.getByTestId('gift-present')).toHaveCount(0);
    });

    test('pre-reader gives the bow: gift button and faces are 120 px or more, the voice asks and thanks, the giver pays', async ({ page }) => {
      await seed(page);
      await openAs(page, 'Wren');
      await page.getByRole('button', { name: 'Hero shop' }).click();
      await expect(page.locator('.pshop')).toBeVisible();
      await page.locator('[data-tab="weapon"]').click();
      await item(page, 'w-bow').click();
      const gb = await box(page, '[data-testid="gift-button"]');
      expect(gb.width).toBeGreaterThanOrEqual(120);
      expect(gb.height).toBeGreaterThanOrEqual(120);
      await shot(page, 'gift-prereader-confirm-buy');
      await page.getByTestId('gift-button').click();
      await expect(page.getByTestId('gift-sheet')).toBeVisible();
      await expect.poll(() => spoken(page)).toContain('Who gets the Bow?');
      for (const b of await page.locator('[data-sibling]').all()) {
        const bb = (await b.boundingBox())!;
        expect(bb.width).toBeGreaterThanOrEqual(120);
        expect(bb.height).toBeGreaterThanOrEqual(120);
      }
      await shot(page, 'gift-prereader-pick');
      await page.locator(`[data-sibling="${PIP}"]`).click();
      const yes = await box(page, '[data-testid="gift-yes"]');
      expect(yes.width).toBeGreaterThanOrEqual(120);
      expect(yes.height).toBeGreaterThanOrEqual(120);
      await shot(page, 'gift-prereader-confirm');
      await page.getByTestId('gift-yes').click();
      await expect.poll(() => spoken(page)).toContain('You gave the Bow to Pip!');
      await expect.poll(async () => (await kidDoc(page, WREN)).game.gems).toBe(95);
      expect((await kidDoc(page, PIP)).game).toMatchObject({ gems: 200, items: ['w-bow'], giftFrom: { 'w-bow': WREN } });
      expect((await kidDoc(page, WREN)).game.items).toBeUndefined();
    });
  });
}

test.describe('820x1180 rules of the road', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('a reader with too few gems gets no Gift button, and no button is smaller than 48 px', async ({ page }) => {
    await seed(page);
    await openAs(page, 'Moss');
    await page.getByRole('button', { name: 'Shop', exact: true }).click();
    await page.locator('[data-tab="weapon"]').click();
    await expect(page.getByTestId('gift-button')).toHaveCount(0);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Switch player' }).click();
    await openAs(page, 'Pip');
    await page.getByRole('button', { name: 'Shop', exact: true }).click();
    await page.locator('[data-tab="weapon"]').click();
    for (const b of await page.getByTestId('gift-button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  });

  test('voice off: the present is silent, and it still opens', async ({ page }) => {
    await seed(page, { given: true, wrenSettings: { voice: 'off' } });
    await openAs(page, 'Wren');
    await expect(page.getByTestId('gift-present')).toBeVisible();
    await page.getByTestId('gift-open').click();
    await expect(page.getByTestId('gift-opened')).toBeVisible();
    expect(await spoken(page)).toEqual([]);
  });

  test('the grown-up turns gifting off: no Gift button, no sibling to give to; history lists the gift; back on, the button returns', async ({ page }) => {
    await seed(page, { given: true });
    await page.goto('/');
    await page.getByRole('button', { name: /grown-ups/i }).first().click();
    for (const d of PARENT_PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
    const panel = page.getByTestId('gifts-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('gift-row')).toHaveCount(1);
    await expect(page.getByTestId('gift-row')).toContainText('Pip gave Wren the Bow');
    await shot(page, 'gift-parent-panel');
    const toggle = page.getByTestId('gifting-toggle');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect.poll(async () => (await stored<{ gifting?: boolean }>(page, 'family', {})).gifting).toBe(false);
    await page.getByRole('button', { name: 'Back to game' }).click();
    await page.locator('.kid-card', { hasText: 'Pip' }).click();
    await page.getByRole('button', { name: 'Shop', exact: true }).click();
    await page.locator('[data-tab="weapon"]').click();
    await expect(page.locator('[data-item="w-hammer"]')).toBeVisible();
    await expect(page.getByTestId('gift-button')).toHaveCount(0);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Switch player' }).click();
    await page.getByRole('button', { name: /grown-ups/i }).first().click();
    for (const d of PARENT_PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
    await page.getByTestId('gifting-toggle').check();
    await expect.poll(async () => (await stored<{ gifting?: boolean }>(page, 'family', {})).gifting).toBe(true);
  });
});
