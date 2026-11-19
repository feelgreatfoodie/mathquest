import { createHash, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * A grown-up's pause in Adventure: the question on screen finishes, the trip is checkpointed (one in-progress run with the answer
 * and its XP), the world is saved, then the break screen blocks. Resume lets the kid back in. Fixture names only.
 */
const KID = 'kidpau00000000000001';
const PIN = String(randomInt(1000, 10000));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PRE = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const READER = { tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 8, maxNew: 2, factGroupsUnlocked: 1, paceMultiplier: 3 };

async function seed(page: Page, settings: object) {
  await page.addInitScript(
    ({ kid, settings, pinHash }) => {
      const w = window as unknown as Record<string, unknown>;
      class Utter { text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
      w.AudioContext = class {
        currentTime = 0; destination = {};
        resume() { return Promise.resolve(); }
        createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      };
      let a = 99;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name: 'Pip', createdAt: 1, settings, game: { xp: 0, gems: 5, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
      }
    },
    { kid: KID, settings, pinHash: sha(`mathquest:local:${PIN}`) },
  );
}

type Ow = { state(): { entities: Array<{ id: string; kind: string; x: number; y: number; shown: boolean }> }; modalAnswer(): number | null; tapTile(x: number, y: number): void };
const ow = <T,>(page: Page, f: (o: Ow) => T) => page.evaluate((src) => new Function('o', `return (${src})(o)`)((window as unknown as { __ow: Ow }).__ow) as T, f.toString());
const read = <T,>(page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null') as T, key);
type Log = { id: string; graded: number; xp: number; xpCredited?: number; mode?: string; finished?: boolean; endedBy?: string };
const logs = (page: Page) => read<Log[]>(page, `mathquest:v1:sessions:${KID}`);
const kidXp = async (page: Page) => (await read<Array<{ game: { xp: number } }>>(page, 'mathquest:v1:kids'))![0]!.game.xp;

async function openAdventure(page: Page, learner: 'prereader' | 'reader') {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  if (learner === 'prereader') await page.getByRole('button', { name: 'Adventure' }).click();
  else await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
}

/** Walks to the first shown encounter and answers it right, through the choice buttons or the keypad. */
async function answerOne(page: Page, learner: 'prereader' | 'reader') {
  const target = (await ow(page, (o) => o.state())).entities.find((e) => e.shown) ?? (await ow(page, (o) => o.state())).entities[0]!;
  await page.evaluate(([x, y]) => (window as unknown as { __ow: Ow }).__ow.tapTile(x!, y!), [target.x, target.y]);
  await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
  const teach = page.getByRole('button', { name: 'Let me try one!' });
  if (await teach.isVisible()) await teach.click();
  if (learner === 'prereader') await page.locator('.question-modal .choice[data-answer="true"]').click();
  else {
    const ans = await ow(page, (o) => o.modalAnswer());
    for (const d of String(ans)) await page.locator('.question-modal .keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
    await page.locator('.question-modal .key-go').click();
  }
  await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 10_000 });
}


async function setPause(page: Page, pause: object | null) {
  await page.evaluate(
    ({ kid, pause }) => {
      const kids = JSON.parse(localStorage.getItem('mathquest:v1:kids') ?? '[]') as { id: string; settings: Record<string, unknown> }[];
      for (const k of kids) if (k.id === kid) (pause ? (k.settings.pause = pause) : delete k.settings.pause);
      localStorage.setItem('mathquest:v1:kids', JSON.stringify(kids));
    },
    { kid: KID, pause },
  );
}

test('a pause in Adventure lets the question finish, checkpoints the trip, then blocks; resume opens it again', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await seed(page, PRE);
  await openAdventure(page, 'prereader');
  const target = (await ow(page, (o) => o.state())).entities.find((e) => e.shown) ?? (await ow(page, (o) => o.state())).entities[0]!;
  await page.evaluate(([x, y]) => (window as unknown as { __ow: Ow }).__ow.tapTile(x!, y!), [target.x, target.y]);
  await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
  await setPause(page, { on: true, setAt: Date.now() });
  await page.waitForTimeout(3300); // the listener has it; the open question is not cut off
  await expect(page.getByTestId('pause-screen')).toHaveCount(0);
  await expect(page.locator('.question-modal')).toBeVisible();
  const teach = page.getByRole('button', { name: 'Let me try one!' });
  if (await teach.isVisible()) await teach.click();
  await page.locator('.question-modal .choice[data-answer="true"]').click();
  await expect(page.getByTestId('pause-screen')).toBeVisible({ timeout: 15_000 });
  const l = (await logs(page))!;
  expect(l).toHaveLength(1);
  expect(l[0]!.mode).toBe('overworld');
  expect(l[0]!.graded).toBeGreaterThanOrEqual(1);
  expect(l[0]!.finished).toBeFalsy(); // a checkpoint, not a closed trip
  expect(await kidXp(page)).toBeGreaterThan(0);
  await setPause(page, null);
  await expect(page.getByTestId('pause-screen')).toHaveCount(0, { timeout: 6000 });
  await expect(page.getByRole('button', { name: 'Adventure' })).toBeVisible();
});
