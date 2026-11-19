import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Pre-reader flow at iPad size on a synthetic profile with only add10 on.
 * Names, ids and the parent PIN are made up per run. The voice and WebAudio are stubbed.
 * SCREENSHOTS=1 writes the PNGs under docs/screenshots/.
 */
const KID_ID = 'kidpreread0000000001';
const KID_NAME = 'Pip';
const PARENT_PIN = String(randomInt(1000, 10000));
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function seed(page: Page, learner: 'prereader' | 'reader' = 'prereader') {
  const settings =
    learner === 'prereader'
      ? { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }
      : { modes: { overworld: false }, tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
  await page.addInitScript(
    ({ kidId, name, settings, pinHash }) => {
      // The voice and WebAudio, stubbed: record what is said and played.
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
      w.__tones = 0;
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
          speak(u: Utter) { (w.__spoken as string[]).push(u.text.trim() ? `${u.text}|${u.lang}|${u.rate}` : ''); setTimeout(() => u.onend?.(), 15); },
          cancel() {},
          getVoices() { return []; },
        },
      });
      w.AudioContext = class {
        currentTime = 0;
        destination = {};
        resume() { return Promise.resolve(); }
        createOscillator() { (w.__tones as number)++; return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
        localStorage.setItem(
          'mathquest:v1:kids',
          JSON.stringify([
            { id: kidId, name, createdAt: 1, settings, game: { xp: 0, gems: 0, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } },
          ]),
        );
      }
    },
    { kidId: KID_ID, name: KID_NAME, settings, pinHash: sha(`mathquest:local:${PARENT_PIN}`) },
  );
}

const spoken = (page: Page) => page.evaluate(() => ((window as unknown as { __spoken: string[] }).__spoken).map((s) => s.split('|')[0]!));

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Reads "a + b" from the numeral row. */
async function readSum(page: Page): Promise<[number, number]> {
  const txt = (await page.locator('.early-numerals').innerText()).replace(/\s+/g, ' ');
  const m = /(\d+) \+ (\d+)/.exec(txt);
  if (!m) throw new Error(`no sum in "${txt}"`);
  return [Number(m[1]), Number(m[2])];
}

async function holdHouse(page: Page) {
  const b = page.getByRole('button', { name: 'Hold to leave' });
  const box = (await b.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2300);
  await page.mouse.up();
}

async function enterPin(page: Page, pin: string) {
  for (const d of pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
}

test('a pre-reader plays a first run, misses one, finishes, and the parent grid fills', async ({ page }) => {
  await seed(page);
  await page.goto('/');

  // Picker: the hero sprite is next to the name.
  await page.locator('.kid-card', { hasText: KID_NAME }).click();

  // Home: a huge Play triangle, flames, no reading.
  const play = page.getByRole('button', { name: 'Play' });
  await expect(play).toBeVisible();
  expect((await play.boundingBox())!.width).toBeGreaterThan(200);
  await expect(page.locator('.flames svg')).toHaveCount(2);
  await shot(page, 'prereader-home');
  await play.click();

  // Run: pictures, no keypad. The first question is spoken.
  await expect(page.locator('.early-numerals')).toBeVisible();
  await expect(page.locator('.keypad')).toHaveCount(0);
  // Dots, or a strategy (a double, a ten-frame, count on) in their place: a fact on dots shows one of the two.
  await expect(page.locator('.object-groups, .cue').first()).toBeVisible();
  await expect.poll(async () => (await spoken(page)).some((s) => / plus /.test(s))).toBe(true);
  const rec = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.find((s) => / plus /.test(s)));
  expect(rec).toMatch(/\|en-US\|0\.85$/);
  await shot(page, 'prereader-question');

  // The speaker button speaks the question again.
  const before = (await spoken(page)).length;
  await page.getByRole('button', { name: 'Say it again' }).click();
  await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(before);

  // Every button is at least 140 x 140.
  for (const b of await page.locator('.choice').all()) {
    const box = (await b.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(140);
    expect(box.height).toBeGreaterThanOrEqual(140);
  }

  let missedOne = false;
  let asked = 0;
  let previews = 0;
  for (let guard = 0; guard < 40; guard++) {
    if (await page.locator('.big-stars').count()) break;
    const [a, b] = await readSum(page);
    // coverage-1: one preview per run may come from the locked second group (sums up to 10).
    const isPreview = (await page.locator('.early-question[data-preview="true"]').count()) > 0;
    if (isPreview) previews++;
    else expect(a + b, `question ${asked + 1} is ${a}+${b}`).toBeLessThanOrEqual(5);
    asked++;
    if (!missedOne && a + b >= 2) {
      missedOne = true;
      // A wrong answer: only the correct button is live, and tapping it is the way on.
      const wrong = page.locator('.choice[data-answer="false"]').first();
      const pos = await page.locator('.early-pictures').boundingBox();
      expect(pos).not.toBeNull();
      await wrong.click();
      await expect(page.locator('.choice.is-guide')).toHaveCount(1);
      await expect(page.locator('.choice-arrow svg')).toHaveCount(1);
      await expect(page.locator('.choice[aria-disabled="true"]')).toHaveCount(3);
      // Another wrong tap does nothing.
      await page.locator('.choice[data-answer="false"]').last().click({ force: true });
      await expect(page.locator('.choice.is-guide')).toHaveCount(1);
      // The icons count up one by one, out loud.
      await expect(page.locator('.og-num').first()).toBeVisible();
      await expect.poll(async () => (await spoken(page)).includes("Let's count them all.")).toBe(true);
      await expect.poll(async () => page.locator('.og-num').count(), { timeout: 15_000 }).toBe(a + b);
      expect(await spoken(page)).toContain('one');
      await shot(page, 'prereader-wrong-countup');
      await page.locator('.choice.is-guide').click({ force: true }); // it pulses, so it is never "stable"
    } else {
      await page.locator('.choice[data-answer="true"]').click();
      await expect(page.locator('.early-check')).toBeVisible();
      await expect.poll(async () => (await spoken(page)).some((s) => s.startsWith('Yes!'))).toBe(true);
    }
    // Wait for the next question or the summary.
    await expect
      .poll(async () => (await page.locator('.big-stars').count()) > 0 || (await page.locator('.early-check').count()) === 0, { timeout: 8000 })
      .toBe(true);
  }

  expect(missedOne).toBe(true);
  expect(previews).toBeLessThanOrEqual(1);

  // Summary: stars, gems, a spoken line.
  await expect(page.locator('.big-stars')).toBeVisible();
  await expect.poll(async () => (await spoken(page)).some((s) => /^Great job! You got \w+ stars?!$/.test(s))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __tones: number }).__tones)).toBeGreaterThan(0);
  await shot(page, 'prereader-summary');

  // The run saved: one session, a card per question asked.
  const saved = await page.evaluate((id) => ({
    sessions: JSON.parse(localStorage.getItem(`mathquest:v1:sessions:${id}`) ?? '[]').length,
    cards: Object.keys(JSON.parse(localStorage.getItem(`mathquest:v1:cards:${id}`) ?? '{}')),
  }), KID_ID);
  expect(saved.sessions).toBe(1);
  expect(saved.cards.length).toBeGreaterThanOrEqual(10);
  expect(saved.cards.every((c) => /^add:\d\+\d$/.test(c))).toBe(true);

  // Home, then leave by holding the house for 2 s.
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.getByRole('button', { name: 'Hold to leave' }).click(); // a tap alone does not leave
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await holdHouse(page);
  await expect(page.locator('.kid-card')).toBeVisible();

  // Parent: the add10 grid has filled.
  await page.getByRole('button', { name: 'Parent area' }).click();
  await enterPin(page, PARENT_PIN);
  await expect(page.getByRole('heading', { name: 'Parent area' })).toBeVisible();
  const grid = page.getByRole('table', { name: 'Addition within 10 mastery' });
  await expect(grid).toBeVisible();
  // a + b <= 10 gives 66 squares (a and b both 0..10); a + b and b + a are one card, so 36 distinct cards.
  await expect(grid.locator('[data-card]')).toHaveCount(66);
  expect(new Set(await grid.locator('[data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')))).size).toBe(36);
  await expect.poll(async () => grid.locator('.lv1, .lv2, .lv3, .lv4').count()).toBeGreaterThanOrEqual(10);
  await grid.scrollIntoViewIfNeeded();
  await shot(page, 'parent-add10-grid');
  await expect(page.getByRole('table', { name: 'Subtraction within 10 mastery' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Times tables' })).toHaveCount(0);
});

test('Add player offers Player type, and Pre-reader applies the preset', async ({ page }) => {
  await seed(page, 'reader');
  await page.goto('/');
  await page.getByRole('button', { name: 'Parent area' }).click();
  await enterPin(page, PARENT_PIN);
  await page.getByRole('button', { name: '+ Add player' }).click();
  await expect(page.getByText('Player type')).toBeVisible();
  await page.getByLabel('Player name').fill('Zoe');
  await page.getByLabel('Pre-reader (4–6)').check();
  await shot(page, 'parent-add-player-type');
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  const kids = await page.evaluate(() => JSON.parse(localStorage.getItem('mathquest:v1:kids')!));
  const zoe = kids.find((k: { name: string }) => k.name === 'Zoe');
  expect(zoe.settings).toMatchObject({ learner: 'prereader', modules: { add10: true }, sessionSize: 10, maxNew: 4, paceMultiplier: 3 });
  const existingReader = kids.find((k: { id: string }) => k.id === KID_ID);
  expect(existingReader.settings.learner).toBeUndefined();
  expect(existingReader.settings.modules).toBeUndefined();
});

test('a reader profile still gets the keypad run and no pre-reader screen', async ({ page }) => {
  await seed(page, 'reader');
  await page.goto('/');
  await page.locator('.kid-card', { hasText: KID_NAME }).click();
  await expect(page.getByRole('button', { name: 'Start Quest' })).toBeVisible();
  await page.getByRole('button', { name: 'Start Quest' }).click();
  // The run may open on a new-skill teach card (the plan shuffles new cards in); go past it.
  const teach = page.getByRole('button', { name: 'Let me try one!' });
  if (await teach.count()) await teach.click();
  await expect(page.locator('.keypad')).toBeVisible();
  await expect(page.locator('.choices')).toHaveCount(0);
});
