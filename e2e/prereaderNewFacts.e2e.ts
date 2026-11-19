import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * The four new pre-reader modules (Make 10, Missing number, Doubles, Addition within 20): each question shows its own
 * picture or strategy, with 4 close choices, and the pad reaches 20 for doubles and addition within 20. Targets are 120 px
 * or more at 820x1180 and 1024x768. Names and ids are made up. The voice is stubbed.
 * FACTS_SHOTS=<dir> writes PNGs there (keep them local).
 */
const KID_ID = 'kidfacts0000000000001';
const SHOTS = process.env.FACTS_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const DAY = 86_400_000;

type Level = 'dots' | 'numerals' | 'pad';

/** One seen, Solid, due card at `level`, in a run of 1, so the first question is that fact. */
async function seed(page: Page, o: { cardId: string; module: string; level?: Level; muted?: boolean; run?: number }) {
  await page.addInitScript(
    ({ kidId, cardId, module, level, muted, run }) => {
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
      if (localStorage.getItem('mathquest:v1:kids')) return;
      const now = Date.now();
      const settings = { learner: 'prereader', modules: { add10: false, [module]: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 1, maxNew: 0, factGroupsUnlocked: 1, paceMultiplier: 3 };
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
      localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kidId, name: 'Pip', createdAt: 1, settings, game: { xp: 0, gems: 0, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
      const card: Record<string, unknown> = {
        id: cardId, attempts: 6, correct: 6, recentMs: [2000, 2100, 1900], lastRating: 3, updatedAt: now - 30 * 86_400_000,
        fsrs: { due: now - 86_400_000, stability: 30, difficulty: 3, elapsed_days: 30, scheduled_days: 30, learning_steps: 0, reps: 5, lapses: 0, state: 2, last_review: now - 30 * 86_400_000 },
      };
      if (level) { card.supportLevel = level; card.supportRun = run ?? 0; card.supportHold = 0; }
      localStorage.setItem(`mathquest:v1:cards:${kidId}`, JSON.stringify({ [cardId]: card }));
      if (muted) localStorage.setItem(`mathquest:v1:mute:${kidId}`, '1');
    },
    { kidId: KID_ID, cardId: o.cardId, module: o.module, level: o.level ?? null, muted: !!o.muted, run: o.run ?? 0 },
  );
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
const stored = (page: Page, id: string) => page.evaluate(([k, c]) => (JSON.parse(localStorage.getItem(`mathquest:v1:cards:${k}`) ?? '{}') as Record<string, Record<string, unknown>>)[c!], [KID_ID, id]);

async function toRun(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.early-numerals')).toBeVisible();
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Every box is at least 120 px square and inside the viewport width. */
async function bigEnough(page: Page, sel: string, count: number, vpW: number) {
  const els = page.locator(sel);
  await expect(els).toHaveCount(count);
  for (let i = 0; i < count; i++) {
    const b = (await els.nth(i).boundingBox())!;
    expect(b.width, `${sel} #${i} width`).toBeGreaterThanOrEqual(119.5);
    expect(b.height, `${sel} #${i} height`).toBeGreaterThanOrEqual(119.5);
    expect(b.x, `${sel} #${i} left`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${sel} #${i} right`).toBeLessThanOrEqual(vpW + 0.5);
  }
}

const noSideScroll = async (page: Page) => {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.iw);
};

const TABLETS = [{ w: 820, h: 1180 }, { w: 1024, h: 768 }];

const QUESTIONS = [
  { name: 'bonds10', cardId: 'bond:3', sel: '[data-gap-frame]', gaps: 7 },
  { name: 'missing10', cardId: 'miss:4+_=7', sel: '[data-gap-frame]', gaps: 3 },
  { name: 'doubles', cardId: 'dbl:7', sel: '[data-cue="double"]', gaps: 0 },
  { name: 'neardoubles', cardId: 'near:6', sel: '[data-cue="neardouble"]', gaps: 0 },
  { name: 'add20', cardId: 'a20:5+8', sel: '[data-cue="split10"]', gaps: 2 },
] as const;

for (const vp of TABLETS) {
  for (const q of QUESTIONS) {
    test(`${q.name} question at ${vp.w}x${vp.h}: its own picture, 4 close choices, targets 120 px or more`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await seed(page, { cardId: q.cardId, module: q.name === 'neardoubles' ? 'doubles' : q.name, level: 'dots' });
      await toRun(page);
      await expect(page.locator(q.sel)).toBeVisible();
      // A missing addend reads "3 + ? = 10": the blank sits in the middle and the total after the equals sign.
      if (q.name === 'bonds10') await expect(page.locator('.early-numerals')).toHaveText(/^3\s*\+\s*\?\s*=\s*10$/);
      if (q.gaps) await expect(page.locator(`${q.sel} .tf-cell.is-gap`)).toHaveCount(q.gaps);
      await bigEnough(page, '.choice', 4, vp.w);
      const nums = await page.locator('.choice').evaluateAll((els) => els.map((e) => Number(e.getAttribute('aria-label'))));
      expect(new Set(nums).size).toBe(4);
      for (const n of nums) expect(n >= 0 && n <= 20).toBe(true);
      await noSideScroll(page);
      await shot(page, `question-${q.name}-${vp.w}x${vp.h}`);
    });
  }
}

test('a missing addend: a right answer is Hit, and a wrong one counts the gap out loud', async ({ page }) => {
  await seed(page, { cardId: 'bond:3', module: 'bonds10', level: 'dots' });
  await toRun(page);
  await expect.poll(async () => (await spoken(page)).some((s) => /three plus what makes ten/.test(s))).toBe(true);
  await page.locator('.choice[data-answer="false"]').first().click();
  await expect(page.locator('.choice.is-guide')).toHaveCount(1);
  await expect.poll(async () => page.locator('.tf-num').count(), { timeout: 15_000 }).toBe(7);
  await expect.poll(async () => (await spoken(page)).some((s) => /Three plus seven makes ten/.test(s)), { timeout: 15_000 }).toBe(true);
  await shot(page, 'bonds10-wrong-counted-1024x768');
});

test('a right answer on a missing addend says the whole sentence', async ({ page }) => {
  await seed(page, { cardId: 'miss:4+_=7', module: 'missing10', level: 'dots' });
  await toRun(page);
  await page.locator('.choice[data-answer="true"]').click();
  await expect(page.locator('.early-check')).toBeVisible();
  await expect.poll(async () => (await spoken(page)).some((s) => /^Yes! Four plus three makes seven\.$/.test(s))).toBe(true);
});

test('numerals level on a missing addend: no pictures and no dots on the buttons, Help gives the gap', async ({ page }) => {
  await seed(page, { cardId: 'bond:3', module: 'bonds10', level: 'numerals' });
  await toRun(page);
  await expect(page.locator('[data-gap-frame]')).toHaveCount(0);
  await expect(page.locator('.choice-dot')).toHaveCount(0);
  await page.getByTestId('help').click();
  await expect(page.locator('[data-gap-frame] .tf-cell.is-gap')).toHaveCount(7);
});

for (const vp of TABLETS) {
  test(`pad to 20 for doubles at ${vp.w}x${vp.h}: 21 number keys, clear and OK, all 120 px or more and on screen`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await seed(page, { cardId: 'dbl:7', module: 'doubles', level: 'pad' });
    await toRun(page);
    await bigEnough(page, '.numpad-key', 23, vp.w);
    await noSideScroll(page);
    for (const n of [0, 10, 14, 20]) await expect(page.getByRole('button', { name: String(n), exact: true })).toBeVisible();
    const ok = (await page.getByRole('button', { name: 'OK' }).boundingBox())!;
    expect(ok.y + ok.height, 'OK key is on screen').toBeLessThanOrEqual(vp.h);
    // The Help button sits beside the sum, so it never covers a key.
    const help = (await page.getByTestId('help').boundingBox())!;
    const pad = (await page.locator('.numpad').boundingBox())!;
    expect(help.y + help.height, 'Help ends above the pad').toBeLessThanOrEqual(pad.y + 0.5);
    await page.getByRole('button', { name: '14', exact: true }).click();
    await expect(page.locator('.math-answer')).toHaveText('14');
    await shot(page, `pad20-doubles-${vp.w}x${vp.h}`);
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('.early-check')).toBeVisible();
  });
}

test('the pad for add10 still stops at 10', async ({ page }) => {
  await seed(page, { cardId: 'add:3+4', module: 'add10', level: 'pad' });
  await toRun(page);
  await bigEnough(page, '.numpad-key', 13, 1024);
});

test('the new modules stay off for a player who has only add10: every question is an add10 card', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('mathquest:v1:kids')) return;
    localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
    localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: 'kidfacts0000000000001', name: 'Pip', createdAt: 1, settings: { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }, game: { xp: 0, gems: 0, streakDays: 0, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
  });
  await toRun(page);
  for (let i = 0; i < 3; i++) {
    await page.locator('.choice[data-answer="true"]').click();
    await expect(page.locator('.early-check')).toBeVisible();
    await expect(page.locator('.early-check')).toHaveCount(0, { timeout: 8000 });
  }
  const ids = await page.evaluate((k) => Object.keys(JSON.parse(localStorage.getItem(`mathquest:v1:cards:${k}`) ?? '{}')), KID_ID);
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) expect(id.startsWith('add:'), id).toBe(true);
});
