import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { getModule } from '../src/engine/modules';

/**
 * practice-credit-ui, updated by every-answer-counts: the end screen when every card already had 3 answers today (every answer counts, so no practice wording), for a
 * reader and a pre-reader, at 393x852 and 820x1180. It never reads 0/0, shows the practice line and the gems, and the
 * pre-reader hears the practice voice line. Names and ids are made up. SCREENSHOTS=1 writes the PNGs under
 * docs/screenshots/practice-credit-ui.
 */
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/practice-credit-ui' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID_ID = 'kidpractice00000000001';
const PARENT_PIN = String(randomInt(1000, 10000));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const DAY = 86_400_000;
const VIEWPORTS = [{ w: 393, h: 852 }, { w: 820, h: 1180 }];

async function seed(page: Page, who: 'reader' | 'prereader') {
  const mod = getModule(who === 'reader' ? 'facts' : 'add10')!;
  const ids = mod.groups!.flatMap((g) => g.cardIds);
  const settings =
    who === 'reader'
      ? { modes: { overworld: false }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 4, maxNew: 0, factGroupsUnlocked: 99, paceMultiplier: 3 }
      : { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 4, maxNew: 0, factGroupsUnlocked: 99, paceMultiplier: 3 };
  await page.addInitScript(
    ({ kidId, settings, ids, pinHash, day }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
      class Utter { text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
      w.AudioContext = class { currentTime = 0; destination = {}; resume() { return Promise.resolve(); } createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        const d = new Date();
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const now = Date.now();
        // Every card was seen, answered 3 times for grading today and is not due: a round can only be practice.
        const cards = Object.fromEntries(ids.map((id) => [id, {
          id, attempts: 6, correct: 6, recentMs: [1500, 1600], lastRating: 3, updatedAt: now - 3 * day, day: today, dayGraded: 3, lastResults: [true, true],
          fsrs: { due: now + 20 * day, stability: 9, difficulty: 5, elapsed_days: 1, scheduled_days: 20, learning_steps: 0, reps: 4, lapses: 0, state: 2, last_review: now - day },
        }]));
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kidId, name: 'Pip', createdAt: 1, settings, game: { xp: 0, gems: 0, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
        localStorage.setItem(`mathquest:v1:cards:${kidId}`, JSON.stringify(cards));
      }
    },
    { kidId: KID_ID, settings, ids, pinHash: sha(`mathquest:local:${PARENT_PIN}`), day: DAY },
  );
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
async function shot(page: Page, name: string, w: number, h: number) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${w}x${h}.png` });
}

for (const { w, h } of VIEWPORTS) {
  test.describe(`${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('a reader round of cards answered 3 times today ends on 4/4 with gems, no practice wording, never 0/0', async ({ page }) => {
      await seed(page, 'reader');
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).click();
      await page.getByRole('button', { name: 'Start Quest' }).click();
      for (let i = 0; i < 12 && !(await page.getByText('Quest complete!').count()); i++) {
        const q = (await page.locator('.panel.question').innerText()).replace(/\s+/g, ' ');
        const m = /(\d+) × (\d+)/.exec(q);
        if (!m) throw new Error(`no sum in "${q}"`);
        await page.keyboard.type(String(Number(m[1]) * Number(m[2])));
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
      }
      await expect(page.getByText('Quest complete!')).toBeVisible();
      const summary = page.locator('.panel.summary');
      await expect(summary).not.toContainText('0/0');
      await expect(summary.locator('.stat', { hasText: 'correct' })).toContainText('4/4');
      await expect(page.getByTestId('practice-line')).toHaveCount(0);
      await expect(summary).not.toContainText(/practice/i);
      const gems = await summary.locator('.stat', { hasText: /^\s*\+?\d*\s*gems$|gems/ }).first().innerText();
      expect(Number(/\+(\d+)/.exec(gems)?.[1])).toBeGreaterThanOrEqual(1);
      await shot(page, 'practice-round-reader', w, h);
    });

    test('a pre-reader round of cards answered 3 times today shows 4 of 4 stars and says Great job', async ({ page }) => {
      await seed(page, 'prereader');
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).click();
      await page.getByRole('button', { name: 'Play' }).click();
      for (let guard = 0; guard < 80 && !(await page.locator('.big-stars').count()); guard++) {
        const right = page.locator('.choice[data-answer="true"]');
        if (await right.count()) await right.first().click({ timeout: 500 }).catch(() => undefined);
        await page.waitForTimeout(80);
      }
      await expect(page.locator('.big-stars')).toHaveAttribute('aria-label', '4 of 4 stars');
      await expect.poll(async () => (await spoken(page)).some((t) => /^Great job! You got \w+ stars!$/.test(t))).toBe(true);
      await shot(page, 'practice-round-prereader', w, h);
    });
  });
}
