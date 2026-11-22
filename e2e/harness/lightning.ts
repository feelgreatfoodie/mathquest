import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';

// Shared by lightning.e2e.ts (chrome) and lightning.webkit.e2e.ts. Made-up names and ids. The voice and the sounds are stubbed.
export const READER_ID = 'kidlightning0000001';
export const PRE_ID = 'kidlightning0000002';
export const SHOTS = process.env.LIGHTNING_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
export const VIEWPORTS = [
  { name: '393x852', width: 393, height: 852 },
  { name: '820x1180', width: 820, height: 1180 },
] as const;

export type Seed = { learner: 'reader' | 'prereader'; delay?: number; make10?: boolean };

export async function seed(page: Page, o: Seed) {
  await page.addInitScript(
    ({ readerId, preId, learner, delay, make10 }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
      class Utter {
        text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null;
        onend: (() => void) | null = null; onerror: (() => void) | null = null;
        constructor(t: string) { this.text = t; }
      }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: { speak(u: Utter) { if (u.text.trim()) (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } },
      });
      w.AudioContext = class {
        currentTime = 0; destination = {};
        resume() { return Promise.resolve(); }
        createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      };
      if (localStorage.getItem('mathquest:v1:kids')) return;
      const now = Date.now();
      const day = new Date(now);
      const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const pre = learner === 'prereader';
      const kidId = pre ? preId : readerId;
      const settings = pre
        ? { learner: 'prereader', modules: make10 ? { add10: true, sub10: true, bonds10: true, missing10: true } : { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }
        : { tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 5, paceMultiplier: 3 };
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
      localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kidId, name: 'Pip', createdAt: 1, settings, game: { xp: 0, gems: 0, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
      const known = (id: string) => ({ id, attempts: 12, correct: 12, recentMs: [700, 800, 650], lastRating: 3, updatedAt: now - 86_400_000, fsrs: { due: now + 9 * 86_400_000, stability: 20, difficulty: 3, elapsed_days: 1, scheduled_days: 20, learning_steps: 0, reps: 5, lapses: 0, state: 2, last_review: now - 86_400_000 } });
      const weak = (id: string) => ({
        id, attempts: 6, correct: 3, recentMs: [5200, 4800], lastRating: 1, updatedAt: now - 3_600_000, day: today, dayGraded: 2, lastResults: [true, false], missDay: today,
        fsrs: { due: now, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 3, lapses: 1, state: 1, last_review: now - 3_600_000 },
        ...(delay ? { lightningDelayMs: delay } : {}),
      });
      const cards: Record<string, unknown> = {};
      if (pre && make10) {
        for (let a = 0; a <= 10; a++) cards[`bond:${a}`] = a % 2 ? weak(`bond:${a}`) : known(`bond:${a}`);
        for (let s = 2; s <= 7; s++) for (let a = 1; a < s; a++) cards[`miss:${a}+_=${s}`] = (a + s) % 2 ? weak(`miss:${a}+_=${s}`) : known(`miss:${a}+_=${s}`);
      } else if (pre) {
        for (let a = 1; a <= 4; a++) for (let b = 1; a + b <= 7; b++) cards[`add:${a}+${b}`] = a <= 2 ? weak(`add:${a}+${b}`) : known(`add:${a}+${b}`);
      } else {
        ['6x7', '7x8', '6x8', '7x9', '8x9', '6x9', '7x7', '8x8', '9x9', '6x6'].forEach((k) => (cards[`mul:${k}`] = weak(`mul:${k}`)));
        for (let a = 0; a <= 5; a++) for (let b = a; b <= 5; b++) cards[`mul:${a}x${b}`] = known(`mul:${a}x${b}`);
      }
      localStorage.setItem(`mathquest:v1:cards:${kidId}`, JSON.stringify(cards));
      w.__seedCards = JSON.parse(JSON.stringify(cards));
    },
    { readerId: READER_ID, preId: PRE_ID, learner: o.learner, delay: o.delay ?? 0, make10: !!o.make10 },
  );
}

export const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
export const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(700); // the end-screen stats count in
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
export const phase = (page: Page) => page.getByTestId('lightning').getAttribute('data-phase');

/** The answer to the sum on screen, read from the DOM (times, plus, minus). */
export async function answerOnScreen(page: Page): Promise<number> {
  const parts = await page.locator('.lr-card .math > span').allTextContents();
  const [a, op, b] = [Number(parts[0]), parts[1], Number(parts[2])];
  return op === '×' ? a * b : op === '+' ? a + b : a - b;
}

export async function typeAnswer(page: Page, n: number) {
  for (const d of String(n)) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).first().tap();
}

/** Holds the Home button for 1.3 s with the keyboard: the round saves and the end screen opens. */
export async function holdHome(page: Page) {
  const home = page.getByRole('button', { name: 'Hold to leave' });
  await home.focus();
  await page.keyboard.down('Enter');
  await page.waitForTimeout(1400);
  await page.keyboard.up('Enter');
}

export const stored = (page: Page, kid: string, what: 'cards' | 'sessions') => page.evaluate(([k, w]) => JSON.parse(localStorage.getItem(`mathquest:v1:${w}:${k}`) ?? 'null'), [kid, what] as const);

