import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type CDPSession, type Page } from '@playwright/test';

/**
 * The Home (hold) button, at 820 x 1180 with touch. Made-up names and ids only.
 * Touches go through CDP so the page sees real touch pointer events.
 * SCREENSHOTS=1 writes the PNGs under docs/screenshots/.
 */
const KID_ID = 'kidhold000000000001';
const PARENT_PIN = String(randomInt(1000, 10000));
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

test.use({ viewport: { width: 820, height: 1180 } });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function seed(page: Page, learner: 'prereader' | 'reader') {
  const settings =
    learner === 'prereader'
      ? { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }
      : { modes: { overworld: false }, tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
  await page.addInitScript(
    ({ kidId, settings, pinHash }) => {
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
        value: {
          speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); },
          cancel() {},
          getVoices() { return []; },
        },
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
          JSON.stringify([{ id: kidId, name: 'Pip', createdAt: 1, settings, game: { xp: 0, gems: 0, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]),
        );
      }
    },
    { kidId: KID_ID, settings, pinHash: sha(`mathquest:local:${PARENT_PIN}`) },
  );
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

async function intoRun(page: Page, learner: 'prereader' | 'reader') {
  await seed(page, learner);
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: learner === 'prereader' ? 'Play' : 'Start Quest' }).click();
  await expect(page.getByRole('button', { name: 'Hold to leave' })).toBeVisible();
}

const home = (page: Page, learner: 'prereader' | 'reader') =>
  page.getByRole('button', { name: learner === 'prereader' ? 'Play' : 'Start Quest' });

/** A finger on the Home button: real touch events from CDP. */
class Finger {
  private constructor(private cdp: CDPSession, private x: number, private y: number) {}
  static async on(page: Page): Promise<Finger> {
    const box = (await page.getByRole('button', { name: 'Hold to leave' }).boundingBox())!;
    return new Finger(await page.context().newCDPSession(page), box.x + box.width / 2, box.y + box.height / 2);
  }
  private send(type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: boolean) {
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points ? [{ x: this.x, y: this.y, id: 1 }] : [] });
  }
  down() { return this.send('touchStart', true); }
  async drift(dx: number) { this.x += dx; await this.send('touchMove', true); }
  up() { return this.send('touchEnd', false); }
}

/** A pointercancel the browser could fire in the middle of a long press. */
const cancelPointer = (page: Page) =>
  page.getByRole('button', { name: 'Hold to leave' }).evaluate((el) => {
    el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'touch' }));
  });

for (const learner of ['prereader', 'reader'] as const) {
  test.describe(`${learner}: Home hold`, () => {
    test('a tap shows the hint bubble, says it, and the run continues', async ({ page }) => {
      await intoRun(page, learner);
      const f = await Finger.on(page);
      await f.down();
      await page.waitForTimeout(150);
      await f.up();
      await expect(page.locator('.hold-hint')).toBeVisible();
      await expect(page.locator('.hold-btn.is-wiggle')).toHaveCount(1);
      await expect.poll(async () => (await spoken(page)).includes('Hold the house to go home.')).toBe(true);
      await expect(page.getByRole('button', { name: 'Hold to leave' })).toBeVisible(); // still in the run
      await expect(home(page, learner)).toHaveCount(0);
      if (learner === 'prereader') {
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/hold-hint.png` });
      }
    });

    test('holding 1.3 s leaves', async ({ page }) => {
      await intoRun(page, learner);
      const f = await Finger.on(page);
      await f.down();
      await page.waitForTimeout(1300);
      await expect(home(page, learner)).toBeVisible({ timeout: 300 });
      await f.up();
    });

    test('a 20 px drift does not cancel the hold', async ({ page }) => {
      await intoRun(page, learner);
      const f = await Finger.on(page);
      await f.down();
      await page.waitForTimeout(300);
      await f.drift(20);
      await page.waitForTimeout(1000);
      await expect(home(page, learner)).toBeVisible({ timeout: 300 });
      await f.up();
    });

    test('a synthetic pointercancel at 500 ms does not abort the hold', async ({ page }) => {
      await intoRun(page, learner);
      const f = await Finger.on(page);
      await f.down();
      await page.waitForTimeout(500);
      await cancelPointer(page);
      await page.waitForTimeout(850);
      await expect(home(page, learner)).toBeVisible({ timeout: 300 });
      await f.up();
    });

    test('a pointercancel inside the first 300 ms cancels', async ({ page }) => {
      await intoRun(page, learner);
      const f = await Finger.on(page);
      await f.down();
      await page.waitForTimeout(100);
      await cancelPointer(page);
      await page.waitForTimeout(1500);
      await expect(page.getByRole('button', { name: 'Hold to leave' })).toBeVisible();
      await expect(home(page, learner)).toHaveCount(0);
      await f.up();
    });

    test('a drift of 60 px cancels', async ({ page }) => {
      await intoRun(page, learner);
      const f = await Finger.on(page);
      await f.down();
      await page.waitForTimeout(300);
      await f.drift(60);
      await page.waitForTimeout(1500);
      await expect(home(page, learner)).toHaveCount(0);
      await f.up();
    });
  });
}

test('a pre-reader hold after an answer still exits when saving throws', async ({ page }) => {
  await intoRun(page, 'prereader');
  await page.locator('.choice[data-answer="true"]').click();
  await expect(page.locator('.early-check')).toBeVisible();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new Error('storage is full'); };
  });
  const f = await Finger.on(page);
  await f.down();
  await page.waitForTimeout(1400);
  await f.up();
  // Out of the run: either the summary or home.
  await expect(page.getByRole('button', { name: 'Hold to leave' }).and(page.locator('.early-top *'))).toHaveCount(0, { timeout: 300 });
});
