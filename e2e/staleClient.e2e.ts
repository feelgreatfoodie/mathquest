import { createHash, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * Stale clients at iPad size, local data. The dev server gives the app a gate fed by one localStorage key
 * (mathquest:test:minVersion) and a build of 100, so a value above 100 means "this bundle is behind".
 * Names, ids and the parent PIN are made up per run. The voice and WebAudio are stubbed.
 */
const KID_ID = 'kidstale00000000001';
const KID_NAME = 'Pip';
const PARENT_PIN = String(randomInt(1000, 10000));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const MIN_KEY = 'mathquest:test:minVersion';

async function seed(page: Page, learner: 'prereader' | 'reader') {
  const settings =
    learner === 'prereader'
      ? { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }
      : { modes: { overworld: false }, tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
  await page.addInitScript(
    ({ kidId, name, settings, pinHash }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
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
        value: { speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } },
      });
      w.AudioContext = class {
        currentTime = 0;
        destination = {};
        resume() { return Promise.resolve(); }
        createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      };
      // Writes to the data keys throw with the error code a refused Firestore write carries, while __failWrites is set.
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        const fail = (w.__failWrites as string | undefined) && k.startsWith('mathquest:v1:');
        if (fail) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: w.__failWrites });
        return real.call(this, k, v);
      };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
        localStorage.setItem(
          'mathquest:v1:kids',
          JSON.stringify([{ id: kidId, name, createdAt: 1, settings, game: { xp: 0, gems: 0, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]),
        );
      }
    },
    { kidId: KID_ID, name: KID_NAME, settings, pinHash: sha(`mathquest:local:${PARENT_PIN}`) },
  );
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
const setMin = (page: Page, v: number | null) =>
  page.evaluate(([k, val]) => (val === null ? localStorage.removeItem(k as string) : localStorage.setItem(k as string, String(val))), [MIN_KEY, v] as const);

test.describe('a failed save is never silent', () => {
  test('a pre-reader answer that cannot be saved shows the toast, with picture buttons', async ({ page }) => {
    await seed(page, 'prereader');
    await page.goto('/');
    await page.locator('.kid-card', { hasText: KID_NAME }).click();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.early-numerals')).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __failWrites: string }).__failWrites = 'quota-exceeded'));
    await page.locator('.choice[data-answer="true"]').click();
    const toast = page.locator('.toast');
    await expect(toast).toContainText('An answer was not saved.');
    // Pre-reader toast: icon buttons, no button text.
    await expect(toast.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Try again' })).toHaveText('');
    await expect(toast.getByRole('button', { name: 'Dismiss' })).toHaveText('');
  });

  test('a refused write (permission-denied) says "Couldn\'t save. Tap to update or try again." with an Update button', async ({ page }) => {
    await seed(page, 'prereader');
    await page.goto('/');
    await page.locator('.kid-card', { hasText: KID_NAME }).click();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.early-numerals')).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __failWrites: string }).__failWrites = 'permission-denied'));
    await page.locator('.choice[data-answer="true"]').click();
    const toast = page.locator('.toast');
    await expect(toast).toContainText("Couldn't save. Tap to update or try again.");
    await expect(toast.getByRole('button', { name: 'Update' })).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('.toast')).toHaveCount(1); // the same message does not stack
  });
});

test.describe('the update screen', () => {
  test('a pre-reader on a behind bundle sees one big picture button and hears why, and Play starts nothing', async ({ page }) => {
    await seed(page, 'prereader');
    await page.goto('/');
    await page.locator('.kid-card', { hasText: KID_NAME }).click();
    const play = page.getByRole('button', { name: 'Play' });
    await expect(play).toBeVisible();
    await setMin(page, 200); // a release lands while the tablet is open
    await play.click();
    const screen = page.getByTestId('update-screen');
    await expect(screen).toBeVisible();
    expect((await screen.innerText()).trim()).toBe(''); // no words for a pre-reader
    const btn = page.getByRole('button', { name: 'Get the new version' });
    expect((await btn.boundingBox())!.width).toBeGreaterThan(200);
    await expect.poll(async () => (await spoken(page)).some((s) => /new version/.test(s))).toBe(true);
    await expect(page.locator('.early-numerals')).toHaveCount(0); // no run started
    // Tap: the page reloads, and while the bundle is still behind the screen comes back.
    await Promise.all([page.waitForEvent('load'), btn.click()]);
    await expect(page.getByTestId('update-screen')).toBeVisible();
  });

  test('a reader on a behind bundle sees New version, Update, and Start Quest starts nothing', async ({ page }) => {
    await seed(page, 'reader');
    await page.goto('/');
    await page.locator('.kid-card', { hasText: KID_NAME }).click();
    const start = page.getByRole('button', { name: 'Start Quest' });
    await expect(start).toBeVisible();
    await setMin(page, 200);
    await start.click();
    await expect(page.getByRole('heading', { name: 'New version' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
    await expect(page.locator('.keypad')).toHaveCount(0);
  });

  test('a behind bundle is stopped at launch, before any screen', async ({ page }) => {
    await seed(page, 'reader');
    await page.addInitScript(([k]) => localStorage.setItem(k as string, '200'), [MIN_KEY]);
    await page.goto('/');
    await expect(page.getByTestId('update-screen')).toBeVisible();
    await expect(page.locator('.kid-card')).toHaveCount(0);
  });

  for (const v of [100, 50, null] as const) {
    test(`minVersion ${v === null ? 'missing' : `${v} (build is 100)`} lets the run start`, async ({ page }) => {
      await seed(page, 'reader');
      await page.goto('/');
      await page.locator('.kid-card', { hasText: KID_NAME }).click();
      await setMin(page, v);
      await page.getByRole('button', { name: 'Start Quest' }).click();
      await expect(page.locator('.keypad')).toBeVisible();
      await expect(page.getByTestId('update-screen')).toHaveCount(0);
    });
  }
});

test.describe('a release during a run', () => {
  test('minVersion bumped mid-run: the run goes on, saves, and the update prompt shows on the summary', async ({ page }) => {
    await seed(page, 'prereader');
    await page.goto('/');
    await page.locator('.kid-card', { hasText: KID_NAME }).click();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.early-numerals')).toBeVisible();
    await setMin(page, 200); // a deploy lands, then the tablet comes back to the front
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    await expect(page.getByTestId('update-screen')).toHaveCount(0); // never mid-round
    await expect(page.locator('.early-numerals')).toBeVisible();
    for (let i = 0; i < 40; i++) {
      if (await page.locator('.big-stars').count()) break;
      await page.locator('.choice[data-answer="true"]').click();
      await expect
        .poll(async () => (await page.locator('.big-stars').count()) > 0 || (await page.locator('.early-check').count()) === 0, { timeout: 8000 })
        .toBe(true);
    }
    await expect(page.locator('.big-stars')).toBeVisible();
    await expect(page.locator('.toast', { hasText: /save/i })).toHaveCount(0); // no "Couldn't save"
    await expect(page.getByTestId('update-prompt')).toBeVisible(); // after the summary
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mathquest:v1:kids')!)[0].game.xp as number);
    expect(stored).toBeGreaterThan(0); // the run saved
  });
});
