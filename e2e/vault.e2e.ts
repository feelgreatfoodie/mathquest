import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * vault: the gem vault at 820x1180 (iPad portrait), reader and pre-reader, plus the parent controls.
 * Local data mode: one device, no server, so a matured deposit is seeded with an old createdAt (the emulator suites
 * cover the server clock). Names, ids and the parent PIN are made up per run. The voice is stubbed and recorded.
 * SCREENSHOTS=1 writes the PNGs under docs/screenshots/vault/.
 */
test.use({ viewport: { width: 820, height: 1180 } });

const KID_ID = 'kidvaultpip0000000004';
const KID_NAME = 'Pip';
const PARENT_PIN = String(randomInt(1000, 10000));
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/vault' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const DAY = 86_400_000;

interface Dep { id: string; amount: number; termDays: 3 | 7 | 14; ratePer10: number; bonus: number; ageDays: number; status?: 'collecting' | 'breaking'; paidOut?: number }

async function seed(page: Page, opts: { learner?: 'prereader' | 'reader'; vault?: boolean; gems?: number; deposits?: Dep[] } = {}) {
  const learner = opts.learner ?? 'reader';
  const vault = opts.vault ?? true;
  const settings =
    learner === 'prereader'
      ? { shop2: true, vault: { on: vault }, learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }
      : { shop2: true, vault: { on: vault }, tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
  const deposits = (opts.deposits ?? []).map(({ ageDays, ...d }) => ({ ...d, status: d.status ?? 'active', paidOut: d.paidOut ?? 0, createdAt: Date.now() - ageDays * DAY }));
  const active = deposits.filter((d) => d.status === 'active').length;
  await page.addInitScript(
    ({ kidId, name, settings, pinHash, gems, deposits, active }) => {
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
          JSON.stringify([
            {
              id: kidId, name, createdAt: 1, settings, hasPin: false,
              game: { xp: 300, gems, heroes: ['knight', 'wizard'], hero: 'wizard', streakDays: 3, lastPlayedDay: null, bestCombo: 5 },
              ...(deposits.length ? { vault: { active, lastId: deposits[deposits.length - 1].id } } : {}),
            },
          ]),
        );
        if (deposits.length) localStorage.setItem(`mathquest:v1:vault:${kidId}`, JSON.stringify(deposits));
      }
    },
    { kidId: KID_ID, name: KID_NAME, settings, pinHash: sha(`mathquest:local:${PARENT_PIN}`), gems: opts.gems ?? 100, deposits, active },
  );
}

const storedKid = (page: Page) => page.evaluate((id) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!).find((k: { id: string }) => k.id === id), KID_ID);
const storedVault = (page: Page) => page.evaluate((id) => JSON.parse(localStorage.getItem(`mathquest:v1:vault:${id}`) ?? '[]'), KID_ID);
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
const READY: Dep = { id: 'dep-ready', amount: 50, termDays: 7, ratePer10: 3, bonus: 15, ageDays: 8 };
const GROWING: Dep = { id: 'dep-grow', amount: 30, termDays: 3, ratePer10: 1, bonus: 3, ageDays: 1 };
const PRE_READY: Dep = { id: 'dep-pre', amount: 10, termDays: 3, ratePer10: 1, bonus: 1, ageDays: 4 };

async function openReaderVault(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await page.locator('[data-tab="vault"]').click();
  await expect(page.getByTestId('vault')).toBeVisible();
  await expect(page.locator('.shop-grid')).toBeHidden();
}
async function openPreVault(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await page.getByRole('button', { name: 'Hero shop' }).click();
  await page.locator('[data-tab="vault"]').click();
  await expect(page.getByTestId('pvault')).toBeVisible();
  await expect(page.locator('.pshop-grid')).toBeHidden();
}
async function enterPin(page: Page, pin: string) {
  for (const d of pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
}

test('reader: the Vault tab is hidden while the parent setting is off', async ({ page }) => {
  await seed(page, { vault: false });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await expect(page.locator('[data-tab="hero"]')).toBeVisible();
  await expect(page.locator('[data-tab="vault"]')).toHaveCount(0);
});

test('reader: deposit 50 for 7 days, see the 65 it returns, break early and get all 50 back', async ({ page }) => {
  await seed(page);
  await openReaderVault(page);
  await shot(page, 'reader-vault-empty');
  await page.locator('[data-term="7"]').click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByTestId('vault-amount')).toHaveText('50');
  await expect(page.getByTestId('vault-example')).toContainText('you get back 65');
  await shot(page, 'reader-vault-builder');
  await page.getByTestId('vault-deposit').click();
  await expect(page.locator('.vault-card')).toHaveCount(1);
  expect((await storedKid(page)).game.gems).toBe(50);
  expect((await storedKid(page)).vault).toMatchObject({ active: 1 });
  expect(await storedVault(page)).toMatchObject([{ amount: 50, termDays: 7, bonus: 15, status: 'active' }]);
  await expect(page.getByTestId('vault-balance')).toContainText('50');
  await shot(page, 'reader-vault-deposited');
  // Break early: a confirm names the 50 back and the 15 lost, then the whole 50 returns.
  await page.getByRole('button', { name: 'Break early' }).click();
  await expect(page.locator('.vault-warn')).toContainText('50 back');
  await expect(page.locator('.vault-warn')).toContainText('15 extra is lost');
  await shot(page, 'reader-vault-break-confirm');
  await page.getByRole('button', { name: 'Break it' }).click();
  await expect.poll(async () => (await storedKid(page)).game.gems).toBe(100);
  expect(await storedVault(page)).toMatchObject([{ status: 'broken', paidOut: 50 }]);
  expect((await storedKid(page)).vault).toMatchObject({ active: 0 });
});

test('reader: a matured deposit glows on Home, collects 65 with the coin shower, and the voice says it', async ({ page }) => {
  await seed(page, { gems: 40, deposits: [READY, GROWING] });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await expect(page.getByTestId('home-vault-ready')).toBeVisible();
  await expect(page.locator('.stats')).toContainText('in the vault');
  await shot(page, 'reader-home-vault-ready');
  await page.getByTestId('home-vault-ready').click();
  await expect(page.getByTestId('vault')).toBeVisible();
  await expect(page.locator('.vault-card.is-ready')).toHaveCount(1);
  await shot(page, 'reader-vault-ready');
  await page.getByRole('button', { name: 'Collect 65' }).click();
  await expect(page.getByTestId('coin-shower')).toBeVisible();
  await shot(page, 'reader-vault-coin-shower');
  await expect.poll(async () => (await storedKid(page)).game.gems).toBe(105);
  expect(await storedVault(page)).toMatchObject([{ id: 'dep-ready', status: 'collected', paidOut: 65 }, { id: 'dep-grow', status: 'active' }]);
  await expect(page.getByTestId('vault-note')).toContainText('Your 50 gems grew to 65!');
  await expect.poll(async () => (await spoken(page)).includes('Your 50 gems grew to 65!')).toBe(true);
});

test('reader: the deposit button is disabled under 10 gems', async ({ page }) => {
  await seed(page, { gems: 9 });
  await openReaderVault(page);
  await expect(page.getByTestId('vault-deposit')).toBeDisabled();
});

test('reader: every vault button is at least 48 px', async ({ page }) => {
  await seed(page, { gems: 100, deposits: [READY, GROWING] });
  await openReaderVault(page);
  for (const b of await page.locator('.vault button').all()) {
    const box = (await b.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.width).toBeGreaterThanOrEqual(48);
  }
});

test('pre-reader: text-free vault, 10 dots become 11, deposit with one confirm, targets at least 120 px, voice says it', async ({ page }) => {
  await seed(page, { learner: 'prereader', gems: 30 });
  await openPreVault(page);
  // No words on the vault surface: no letters in its visible text.
  expect((await page.getByTestId('pvault').innerText()).trim()).toBe('');
  await shot(page, 'prereader-vault');
  for (const b of await page.locator('.pvault button, .pshop-tab').all()) {
    const box = (await b.boundingBox())!;
    expect(box.height, 'height').toBeGreaterThanOrEqual(120);
    expect(box.width, 'width').toBeGreaterThanOrEqual(120);
  }
  await page.getByTestId('pvault-new').click();
  await expect(page.getByTestId('pvault-confirm')).toHaveAttribute('data-step', 'deposit');
  await expect.poll(async () => (await spoken(page)).includes('Put in 10. Get back 11 in 3 sleeps!')).toBe(true);
  expect((await page.getByTestId('pvault-confirm').innerText()).trim()).toBe('');
  for (const b of await page.locator('.pvault-confirm button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(120);
  await shot(page, 'prereader-vault-confirm');
  await page.getByRole('button', { name: 'Put in' }).dblclick();
  await expect(page.locator('.pv-chest')).toHaveCount(1);
  expect((await storedKid(page)).game.gems).toBe(20);
  expect(await storedVault(page)).toHaveLength(1);
  await shot(page, 'prereader-vault-growing');
});

test('pre-reader: a ready chest glows on Home, a tap collects 11 with the shower and the voice, a growing chest asks before breaking', async ({ page }) => {
  await seed(page, { learner: 'prereader', gems: 20, deposits: [PRE_READY, { ...GROWING, id: 'dep-g2', amount: 10, ageDays: 1 }] });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  const glow = page.getByTestId('home-vault-ready');
  await expect(glow).toBeVisible();
  const box = (await glow.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(120);
  expect(box.height).toBeGreaterThanOrEqual(120);
  await shot(page, 'prereader-home-vault-ready');
  await glow.click();
  await expect(page.getByTestId('pvault')).toBeVisible();
  await expect(page.locator('.pv-chest.is-ready')).toHaveCount(1);
  await shot(page, 'prereader-vault-ready');
  await page.locator('.pv-chest.is-ready').click();
  await expect(page.getByTestId('coin-shower')).toBeVisible();
  await shot(page, 'prereader-vault-coin-shower');
  await expect.poll(async () => (await storedKid(page)).game.gems).toBe(31);
  await expect.poll(async () => (await spoken(page)).includes('Your 10 gems grew to 11!')).toBe(true);
  // The growing chest: tap, hear it, a check and a cross appear, the cross keeps the gems in.
  await page.locator('.pv-chest[data-status="active"]').click();
  await expect(page.getByTestId('pvault-confirm')).toHaveAttribute('data-step', 'break');
  await shot(page, 'prereader-vault-break-confirm');
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect((await storedVault(page)).find((d: { id: string }) => d.id === 'dep-g2').status).toBe('active');
  await page.locator('.pv-chest[data-status="active"]').click();
  await page.getByRole('button', { name: 'Take back' }).click();
  await expect.poll(async () => (await storedKid(page)).game.gems).toBe(41);
});

test('parent: turn the vault on, edit a rate, see the history and the vault balance', async ({ page }) => {
  await seed(page, { vault: false, gems: 100, deposits: [READY] });
  await page.goto('/');
  await page.getByRole('button', { name: /parent/i }).first().click();
  await enterPin(page, PARENT_PIN);
  await expect(page.locator('.parent')).toBeVisible();
  await page.locator('.tabs .tab', { hasText: KID_NAME }).click();
  await expect(page.locator('.detail')).toBeVisible();
  await expect(page.getByTestId('vault-rates')).toHaveCount(0);
  await page.getByTestId('setting-vault').check();
  await page.getByTestId('vault-rate-7').selectOption('5');
  await shot(page, 'parent-vault-settings');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect.poll(async () => (await storedKid(page)).settings.vault).toEqual({ on: true, d7: 5 });
  await expect(page.getByTestId('parent-vault-balance')).toContainText('50');
  await expect(page.getByTestId('vault-history')).toContainText('50 gems for 7 days at 3 per 10');
  await shot(page, 'parent-vault-history');
});

test('reader: a collect interrupted after 30 of 65 resumes when the vault opens and pays the other 35 once', async ({ page }) => {
  await seed(page, { gems: 130, deposits: [{ ...READY, status: 'collecting', paidOut: 30 }] });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await expect(page.getByTestId('home-vault-ready')).toBeVisible();
  await page.getByTestId('home-vault-ready').click();
  await expect(page.getByTestId('vault')).toBeVisible();
  await expect.poll(async () => (await storedKid(page)).game.gems).toBe(165);
  expect(await storedVault(page)).toMatchObject([{ id: 'dep-ready', status: 'collected', paidOut: 65 }]);
  // Open it again: nothing more is paid.
  await page.reload();
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await page.locator('[data-tab="vault"]').click();
  await expect(page.getByTestId('vault')).toBeVisible();
  expect((await storedKid(page)).game.gems).toBe(165);
});
