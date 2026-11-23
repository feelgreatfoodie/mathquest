import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FACTS } from '../src/engine/modules/facts';

/**
 * A question before every chest, at 1024x768 and 820x1180, for a reader (keypad) and a picture player (big choices).
 * One chest opens with a right answer and pays; one stays shut after a wrong answer, with the teach card. Names and ids are made up.
 * SCREENSHOTS=1 writes the chest question of each learner at each size under docs/screenshots/chest-question.
 */
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/chest-question' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidcq100000000000001';
const DAY = 86_400_000;
const READER = { modes: { overworld: true }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 8, maxNew: 4, factGroupsUnlocked: 5, paceMultiplier: 3 };
const PICTURE = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const SIZES = [{ w: 1024, h: 768 }, { w: 820, h: 1180 }] as const;

function allSeen(now: number) {
  return Object.fromEntries(
    FACTS.cards.map((c) => [c.id, { id: c.id, attempts: 6, correct: 6, recentMs: [2000, 2100], lastRating: 3, updatedAt: now - DAY, day: '2000-01-01', dayGraded: 1, lastResults: [true, true], fsrs: { due: now + 9 * DAY, stability: 9, difficulty: 5, elapsed_days: 1, scheduled_days: 9, learning_steps: 0, reps: 4, lapses: 0, state: 2, last_review: now - DAY } }]),
  );
}

async function seed(page: Page, settings: object, cards: object) {
  await page.addInitScript(
    ({ kid, settings, cards }) => {
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
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name: 'Ada', createdAt: 1, settings, game: { xp: 0, gems: 5, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
        localStorage.setItem(`mathquest:v1:cards:${kid}`, JSON.stringify(cards));
        localStorage.setItem(`mathquest:v1:world:${kid}`, JSON.stringify({ region: 'meadow', x: 3, y: 14, facing: 'right', openedChests: [], bossesDefeated: [], keys: 0, version: 1, updatedAt: 1 }));
        const t = Date.now();
        const totals = { answered: 0, graded: 0, correct: 0, fast: 0, newLearned: 0, xp: 0, bestCombo: 0, medianMs: 0, missed: [] };
        localStorage.setItem(`mathquest:v1:trip:${kid}`, JSON.stringify({ tripId: 'trip-chest-question', startedAt: t, seq: 0, updatedAt: t, finished: false, totals, chests: { opened: [] } }));
      }
    },
    { kid: KID, settings, cards },
  );
}

type Ent = { id: string; kind: string; x: number; y: number; spotId?: string };
type Ow = { state(): { entities: Ent[]; trip: { opened: string[] } | null; hero: { x: number; y: number }; moving: boolean }; modalAnswer(): number | null; tapTile(x: number, y: number): void };
const ow = <T,>(page: Page, f: (o: Ow) => T) => page.evaluate((src) => new Function('o', `return (${src})(o)`)((window as unknown as { __ow: Ow }).__ow) as T, f.toString());
const gems = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!)[0].game.gems as number | undefined, KID);

async function walkToChest(page: Page, e: Ent) {
  await page.evaluate(([x, y]) => (window as unknown as { __ow: Ow }).__ow.tapTile(x!, y!), [e.x, e.y]);
  await expect(page.locator('.question-modal')).toBeVisible({ timeout: 40_000 });
}

for (const learner of ['reader', 'picture'] as const) {
  for (const size of SIZES) {
    test(`${learner} at ${size.w}x${size.h}: a chest asks a question first, a right answer opens it and pays, a wrong answer keeps it shut`, async ({ page }) => {
      await page.setViewportSize({ width: size.w, height: size.h });
      await seed(page, learner === 'reader' ? READER : PICTURE, learner === 'reader' ? allSeen(Date.now()) : {});
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Ada' }).click();
      await (learner === 'reader' ? page.locator('.mode-card[data-mode="overworld"]') : page.getByRole('button', { name: 'Adventure' })).click();
      await expect(page.getByTestId('overworld')).toBeVisible();
      await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);

      const chests = (await ow(page, (o) => o.state())).entities.filter((e) => e.kind === 'chest');
      expect(chests.length).toBeGreaterThanOrEqual(2);
      const [good, bad] = [chests[0]!, chests[1]!];
      const gems0 = (await gems(page)) ?? 5;

      const answerRight = async () => {
        if (learner === 'reader') {
          const ans = await ow(page, (o) => o.modalAnswer());
          for (const d of String(ans)) await page.locator('.question-modal .keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
          await page.locator('.question-modal .key-go').click();
        } else await page.locator('.question-modal .choice[data-answer="true"]').click();
      };
      const answerWrong = async () => {
        if (learner === 'reader') {
          const ans = (await ow(page, (o) => o.modalAnswer()))!;
          for (const d of String(ans + 1)) await page.locator('.question-modal .keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
          await page.locator('.question-modal .key-go').click();
        } else await page.locator('.question-modal .choice:not([data-answer="true"])').first().click();
      };

      // A right answer: the question comes first, then the chest opens and pays.
      await walkToChest(page, good);
      if (learner === 'reader') await expect(page.locator('.question-modal .keypad')).toBeVisible();
      else await expect(page.locator('.question-modal .choice')).not.toHaveCount(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${learner}-${size.w}x${size.h}.png` });
      expect((await ow(page, (o) => o.state())).trip!.opened).toEqual([]);
      await answerRight();
      await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 12_000 });
      expect((await ow(page, (o) => o.state())).trip!.opened).toEqual([good.spotId]);
      await expect.poll(async () => (await gems(page)) ?? 5, { timeout: 8000 }).toBeGreaterThan(gems0);
      const gems1 = (await gems(page))!;

      // A wrong answer: the teach card shows, the chest stays shut, nothing is paid.
      await walkToChest(page, bad);
      await answerWrong();
      if (learner === 'reader') {
        await expect(page.locator('.question-modal .feedback.bad, .question-modal .feedback.almost')).toBeVisible({ timeout: 10_000 });
        await page.locator('.question-modal .feedback button', { hasText: 'Got it' }).click();
      } else {
        // The picture teach step: tapping the right choice goes on.
        await expect(page.locator('.question-modal .choice.is-guide')).toHaveCount(1);
        await page.locator('.question-modal .choice.is-guide').click({ force: true }); // it pulses, so it is never "stable"
      }
      await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 12_000 });
      const after = await ow(page, (o) => o.state());
      expect(after.trip!.opened).toEqual([good.spotId]);
      expect(after.entities.filter((e) => e.kind === 'chest').map((e) => e.spotId)).not.toContain(bad.spotId);
      expect(await gems(page)).toBe(gems1);

      // A reload on the same day: the opened chest stays open and the shut one is offered again on a new trip.
      await page.evaluate((k) => localStorage.removeItem(`mathquest:v1:trip:${k}`), KID);
      await page.reload();
      await page.locator('.kid-card', { hasText: 'Ada' }).click();
      await (learner === 'reader' ? page.locator('.mode-card[data-mode="overworld"]') : page.getByRole('button', { name: 'Adventure' })).click();
      await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
      const next = await ow(page, (o) => o.state());
      expect(next.trip!.opened).toContain(good.spotId);
    });
  }
}
