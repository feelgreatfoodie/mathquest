import { expect, test, type Page } from '@playwright/test';
import { keypadReady } from './harness/keypadReady';

/**
 * Visual baselines for the Dungeon run and the pre-reader run.
 * Baselines were re-taken on main e6b5e0a (after #12 added the hold bubble button, before the mode layer) and must not change in PR 1a.
 * Math.random is seeded so the questions, icons and monsters are the same every run.
 * Update on purpose with `npx playwright test visual --update-snapshots`.
 */
const SIZES = [
  { tag: '820x1180', width: 820, height: 1180 },
  { tag: '1180x820', width: 1180, height: 820 },
  { tag: '390x844', width: 390, height: 844 },
];

const KID_ID = 'kidvisual0000000001';

type Who = 'reader' | 'skills' | 'prereader';

async function seed(page: Page, who: Who) {
  const settings = {
    reader: { modes: { overworld: false }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 12, maxNew: 6, factGroupsUnlocked: 1, paceMultiplier: 3 },
    skills: { modes: { overworld: false }, tracks: { facts: false, multidigit: true, fractions: false }, sessionSize: 12, maxNew: 6, factGroupsUnlocked: 1, paceMultiplier: 3 },
    prereader: { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 },
  }[who];
  await page.addInitScript(
    ({ kidId, settings }) => {
      // Seeded Math.random (mulberry32).
      let a = 1234567;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const w = window as unknown as Record<string, unknown>;
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
        value: { speak(u: Utter) { setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } },
      });
      w.AudioContext = class {
        currentTime = 0;
        destination = {};
        resume() { return Promise.resolve(); }
        createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
        localStorage.setItem(
          'mathquest:v1:kids',
          JSON.stringify([{ id: kidId, name: 'Pip', createdAt: 1, settings, game: { xp: 0, gems: 0, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]),
        );
      }
    },
    { kidId: KID_ID, settings },
  );
}

async function start(page: Page, button: 'Start Quest' | 'Play') {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: button }).click();
}

for (const s of SIZES) {
  test.describe(s.tag, () => {
    test.use({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 });

    test('dungeon: question, wrong answer', async ({ page }) => {
      await seed(page, 'reader');
      await start(page, 'Start Quest');
      await keypadReady(page);
      await expect(page).toHaveScreenshot(`dungeon-question-${s.tag}.png`);
      // 9999 is never a times-table answer in the first group.
      for (const d of '9999') await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
      await expect(page).toHaveScreenshot(`dungeon-typed-${s.tag}.png`);
      await page.locator('.key-go').click();
      await expect(page.locator('.feedback.bad')).toBeVisible();
      await expect(page).toHaveScreenshot(`dungeon-wrong-${s.tag}.png`);
    });

    test('dungeon: teach card', async ({ page }) => {
      await seed(page, 'skills');
      await start(page, 'Start Quest');
      await expect(page.locator('.panel.teach')).toBeVisible();
      await expect(page).toHaveScreenshot(`dungeon-teach-${s.tag}.png`);
    });

    test('pre-reader: question, wrong answer counted up', async ({ page }) => {
      await seed(page, 'prereader');
      await start(page, 'Play');
      await expect(page.locator('.early-numerals')).toBeVisible();
      await expect(page).toHaveScreenshot(`prereader-question-${s.tag}.png`);
      const txt = (await page.locator('.early-numerals').innerText()).replace(/\s+/g, ' ');
      const m = /(\d+) \+ (\d+)/.exec(txt)!;
      await page.locator('.choice[data-answer="false"]').first().click();
      await expect.poll(async () => page.locator('.og-num').count(), { timeout: 15_000 }).toBe(Number(m[1]) + Number(m[2]));
      await expect(page).toHaveScreenshot(`prereader-wrong-${s.tag}.png`);
    });
  });
}
