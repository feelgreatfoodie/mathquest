import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';

/**
 * Before and after screenshots for the style PRs. Skipped unless STYLE_SHOTS_DIR is set:
 *   STYLE_SHOTS_DIR=/path/to/dir npx playwright test styleShots
 * Demo family only (Pip, a reader; Wren, a pre-reader). Each PNG has a .txt beside it with the page text,
 * so the shots can be leak-scanned as text (node scripts/check-private-ids.mjs --text <file>).
 */
const DIR = process.env.STYLE_SHOTS_DIR;
const LANDING_PORT = Number(process.env.E2E_LANDING_PORT) || 5198;
const SIZES = [
  { tag: '820x1180', width: 820, height: 1180 },
  { tag: '1024x768', width: 1024, height: 768 },
  { tag: '393x852', width: 393, height: 852 },
];

const PIN = '2468'; // made up
const PIN_HASH = createHash('sha256').update(`mathquest:local:${PIN}`).digest('hex');

async function seedDemoFamily(page: Page) {
  await page.addInitScript((pinHash) => {
    // The voice and WebAudio are stubbed so a Picture Run question does not wait on a real voice.
    const w = window as unknown as Record<string, unknown>;
    class Utter {
      text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null;
      onend: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(t: string) { this.text = t; }
    }
    w.SpeechSynthesisUtterance = Utter;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
    w.AudioContext = class {
      currentTime = 0; destination = {};
      resume() { return Promise.resolve(); }
      createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    };
    let a = 1234567;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    if (localStorage.getItem('mathquest:v1:kids')) return;
    const game = (hero: string) => ({ xp: 240, gems: 31, streakDays: 3, lastPlayedDay: null, bestCombo: 5, heroes: [hero], hero });
    const reader = { modes: { overworld: false }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 12, maxNew: 6, factGroupsUnlocked: 1, paceMultiplier: 3 };
    const pre = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
    localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1, tourSeen: true }));
    localStorage.setItem(
      'mathquest:v1:kids',
      JSON.stringify([
        { id: 'kidshots0000000001', name: 'Pip', createdAt: 1, settings: reader, game: game('knight') },
        { id: 'kidshots0000000002', name: 'Wren', createdAt: 2, settings: pre, game: game('knight') },
      ]),
    );
  }, PIN_HASH);
}

async function shot(page: Page, tag: string, name: string) {
  mkdirSync(join(DIR!, tag), { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(DIR!, tag, `${name}.png`) });
  writeFileSync(join(DIR!, tag, `${name}.txt`), await page.evaluate(() => document.body.innerText));
}

for (const s of SIZES) {
  test.describe(`style shots ${s.tag}`, () => {
    test.skip(!DIR, 'set STYLE_SHOTS_DIR');
    test.use({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 });

    test('landing, kid and grown-ups', async ({ page }) => {
      await page.goto(`http://localhost:${LANDING_PORT}/`);
      await page.waitForSelector('.landing-tab, [data-testid="title-screen"]');
      await shot(page, s.tag, 'landing');
      if (await page.getByTestId('title-intro').count()) {
        await page.getByTestId('title-intro').click();
        await page.locator('.intro-card img').first().waitFor();
        await page.waitForTimeout(600);
        await shot(page, s.tag, 'intro-1');
        for (let i = 0; i < 3; i++) await page.getByTestId('intro-next').click();
        await page.waitForTimeout(1200);
        await shot(page, s.tag, 'intro-4');
        await page.getByTestId('intro-back').click();
        for (let i = 0; i < 3; i++) await page.getByTestId('intro-back').click().catch(() => undefined);
        await page.goto(`http://localhost:${LANDING_PORT}/`);
        await page.getByTestId('title-play').click();
        await shot(page, s.tag, 'landing-kid');
      }
      const tab = page.locator('#landing-tab-parent');
      if (await tab.count()) {
        await tab.click();
        await shot(page, s.tag, 'landing-grownups');
      }
    });

    test('picker, home, question, miss, teach, end', async ({ page }) => {
      await seedDemoFamily(page);
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).waitFor();
      await shot(page, s.tag, 'picker');
      await page.locator('.kid-card', { hasText: 'Pip' }).click();
      await shot(page, s.tag, 'home-pip');
      await page.getByRole('button', { name: 'Start Quest' }).click();
      const teach = page.getByRole('button', { name: 'Let me try one!' });
      if (await teach.isVisible().catch(() => false)) {
        await shot(page, s.tag, 'teach-pip');
        await teach.click();
      }
      await page.locator('.keypad').waitFor();
      await shot(page, s.tag, 'question-pip');
      for (const d of '9999') await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
      await page.locator('.key-go').click();
      await page.locator('.feedback.bad').waitFor();
      await shot(page, s.tag, 'miss-pip');
      await page.getByRole('button', { name: 'Got it' }).click();
      await holdQuit(page);
      await page.locator('.summary').waitFor();
      await shot(page, s.tag, 'end-pip');
      await page.goto('/');
      await page.getByRole('button', { name: /(grown-ups|parent) area/i }).click();
      for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
      await page.locator('.parent').waitFor();
      await page.waitForTimeout(600);
      await shot(page, s.tag, 'grownups-area');
      if (await page.getByTestId('tour-button').count()) {
        await page.getByTestId('tour-button').click();
        await page.waitForTimeout(700);
        await shot(page, s.tag, 'tour-1-players');
        for (let i = 0; i < 2; i++) await page.getByTestId('tour-next').click();
        await page.waitForTimeout(900);
        await shot(page, s.tag, 'tour-3-pause');
        await page.getByTestId('tour-next').click();
        await page.waitForTimeout(900);
        await shot(page, s.tag, 'tour-4-progress');
      }
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Wren' }).click();
      await shot(page, s.tag, 'home-wren');
      await page.getByRole('button', { name: 'Play' }).click();
      await page.locator('.early-numerals').waitFor();
      await shot(page, s.tag, 'question-wren');
      await page.locator('.choice[data-answer="false"]').first().click();
      await page.waitForTimeout(300);
      await shot(page, s.tag, 'miss-wren');
      for (let guard = 0; guard < 600; guard++) {
        if (await page.locator('.big-stars').count()) break;
        const right = page.locator('.choice[data-answer="true"]');
        if (await right.count()) await right.first().click({ force: true, timeout: 500 }).catch(() => undefined);
        await page.waitForTimeout(60);
      }
      await page.locator('.big-stars').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(3500);
      await shot(page, s.tag, 'end-wren');
    });
  });
}

/** Holds the Home button until the run ends. */
async function holdQuit(page: Page) {
  const b = (await page.locator('.hold-btn').first().boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1600);
  await page.mouse.up();
}
