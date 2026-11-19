import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { getModule } from '../src/engine/modules';
import { keypadReady } from './harness/keypadReady';

/**
 * coverage-1 at 820x1180 (iPad portrait) on synthetic profiles: a reader with group 1 seen and group 2 locked, and a
 * pre-reader with the first addition group seen. Previews show the hint (reader) or the pictures (pre-reader),
 * and a preview miss does not look like a miss. The voice and WebAudio are stubbed. SCREENSHOTS=1 writes the PNGs.
 */
test.use({ viewport: { width: 820, height: 1180 } });
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID_ID = 'kidcover00000000001';
const PARENT_PIN = String(randomInt(1000, 10000));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const DAY = 86_400_000;

function seenCards(ids: string[]) {
  const now = Date.now();
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        id,
        attempts: 2,
        correct: 2,
        recentMs: [2000, 2100],
        lastRating: 3,
        updatedAt: now - 2 * DAY,
        // Seen two days ago, low stability: in review rotation but not "reviewing", so the next group stays locked.
        fsrs: { due: now + 30 * DAY, stability: 1.5, difficulty: 5, elapsed_days: 0, scheduled_days: 2, learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: now - 2 * DAY },
        lastResults: [true, false],
        day: '2000-01-01',
        dayGraded: 1,
      },
    ]),
  );
}

async function seed(page: Page, who: 'reader' | 'prereader') {
  const facts = getModule('facts')!;
  const add = getModule('add10')!;
  const settings =
    who === 'reader'
      ? { modes: { overworld: false }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 12, maxNew: 0, factGroupsUnlocked: 1, paceMultiplier: 3 }
      : { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 0, factGroupsUnlocked: 1, paceMultiplier: 3 };
  const ids = who === 'reader' ? facts.groups![0]!.cardIds : add.groups![0]!.cardIds;
  await page.addInitScript(
    ({ kidId, settings, cards, pinHash }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
      class Utter { text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
      w.AudioContext = class { currentTime = 0; destination = {}; resume() { return Promise.resolve(); } createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kidId, name: 'Pip', createdAt: 1, settings, game: { xp: 0, gems: 0, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
        localStorage.setItem(`mathquest:v1:cards:${kidId}`, JSON.stringify(cards));
      }
    },
    { kidId: KID_ID, settings, cards: seenCards(ids), pinHash: sha(`mathquest:local:${PARENT_PIN}`) },
  );
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('a reader preview shows its hint first, and a miss on it is not a red miss', async ({ page }) => {
  await seed(page, 'reader');
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: 'Start Quest' }).click();
  await keypadReady(page);
  const hint = page.getByTestId('preview-hint');
  // Answer correctly until a preview appears (2 per run, spread through the run).
  for (let i = 0; i < 16 && !(await hint.count()); i++) {
    const q = (await page.locator('.panel.question').innerText()).replace(/\s+/g, ' ');
    const m = /(\d+) × (\d+)/.exec(q);
    if (!m) throw new Error(`no sum in "${q}"`);
    await page.keyboard.type(String(Number(m[1]) * Number(m[2])));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
  }
  await expect(hint).toBeVisible();
  await expect(page.locator('.pixel.tag', { hasText: 'A new one to try' })).toBeVisible();
  expect((await hint.innerText()).length).toBeGreaterThan(10);
  await shot(page, 'coverage-reader-preview');
  // Miss it on purpose: neutral feedback, no red.
  await page.keyboard.type('7');
  await page.getByRole('button', { name: 'GO' }).click(); // a keyboard Enter would also press the Got it button that takes focus
  await expect(page.locator('.feedback.almost')).toBeVisible();
  await expect(page.locator('.feedback.bad')).toHaveCount(0);
  await expect(page.locator('.feedback-title')).toContainText('Now you know');
});

test('a pre-reader preview shows the pictures, one per run', async ({ page }) => {
  await seed(page, 'prereader');
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.early-numerals')).toBeVisible();
  const seen = new Set<string>();
  for (let guard = 0; guard < 16; guard++) {
    if (await page.locator('.big-stars').count()) break;
    const marker = page.locator('.early-question[data-preview="true"]');
    if (await marker.count()) {
      const key = (await page.locator('.early-numerals').innerText()).replace(/\s+/g, ' ');
      if (!seen.size) {
        await expect(page.locator('.object-groups')).toBeVisible(); // pictures, whatever the card level
        await shot(page, 'coverage-prereader-preview');
      }
      seen.add(key);
    }
    await page.locator('.choice[data-answer="true"]').click();
    await expect.poll(async () => (await page.locator('.big-stars').count()) > 0 || (await page.locator('.early-check').count()) === 0, { timeout: 8000 }).toBe(true);
  }
  expect(seen.size).toBe(1);
});

test('the parent area shows a coverage line', async ({ page }) => {
  await seed(page, 'reader');
  await page.goto('/');
  await page.getByRole('button', { name: 'Grown-ups area' }).click();
  for (const d of PARENT_PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await expect(page.getByRole('heading', { name: 'Grown-ups area' })).toBeVisible();
  await page.locator('.kid-card, .kid-row, button', { hasText: 'Pip' }).first().click().catch(() => undefined);
  const line = page.locator('[data-coverage="facts"]');
  await expect(line).toBeVisible();
  await expect(line).toContainText('Times tables: seen 55 of 91');
  await expect(line).toContainText('not started');
  await shot(page, 'coverage-parent-line');
});
