import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * The pre-reader fade: dots, then numerals with 4 close choices and a Help button, then a number pad. Help shows a
 * strategy first, then the dots, and counts as right-with-help. Targets are 120 px or more at 820x1180, 1024x768 and
 * on a phone (375, 393 and 430 wide, where the 4 choices wrap 2 by 2). Names and ids are made up. The voice is stubbed.
 * FADE_SHOTS=<dir> writes PNGs there (keep them local).
 */
const KID_ID = 'kidfade00000000000001';
const SHOTS = process.env.FADE_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const DAY = 86_400_000;

type Level = 'dots' | 'numerals' | 'pad';

/** One seen, Solid, due card at `level`, in a run of 1, so the first question is that fact. */
async function seed(page: Page, o: { cardId: string; level?: Level; muted?: boolean; run?: number }) {
  await page.addInitScript(
    ({ kidId, cardId, level, muted, run }) => {
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
      const settings = { learner: 'prereader', modules: { add10: true, sub10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 1, maxNew: 0, factGroupsUnlocked: 1, paceMultiplier: 3 };
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
    { kidId: KID_ID, cardId: o.cardId, level: o.level ?? null, muted: !!o.muted, run: o.run ?? 0 },
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
const PHONES = [{ w: 375, h: 812 }, { w: 393, h: 852 }, { w: 430, h: 932 }];

for (const vp of TABLETS) {
  test(`dots level at ${vp.w}x${vp.h}: pictures, 4 distinct choices, no Help button`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await seed(page, { cardId: 'add:1+2', level: 'dots' });
    await toRun(page);
    await expect(page.locator('.early-question')).toHaveAttribute('data-support', 'dots');
    await expect(page.locator('.early-question')).toHaveAttribute('data-mode', 'groups');
    await expect(page.getByTestId('help')).toHaveCount(0);
    await bigEnough(page, '.choice', 4, vp.w);
    await expect(page.locator('.choice-dot').first()).toBeVisible();
    const nums = await page.locator('.choice').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(new Set(nums).size).toBe(4);
    // All four in one row on a tablet.
    const tops = await page.locator('.choice').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    await noSideScroll(page);
    await shot(page, `support-dots-${vp.w}x${vp.h}`);
  });

  test(`numerals level at ${vp.w}x${vp.h}: no pictures, Help gives the strategy, then the dots`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await seed(page, { cardId: 'add:3+4', level: 'numerals' });
    await toRun(page);
    await expect(page.locator('.early-question')).toHaveAttribute('data-support', 'numerals');
    await expect(page.locator('.early-question')).toHaveAttribute('data-mode', 'numerals');
    await expect(page.locator('.og-item')).toHaveCount(0);
    await bigEnough(page, '[data-testid="help"]', 1, vp.w);
    await bigEnough(page, '.choice', 4, vp.w);
    // No dots on the buttons either: the numerals are all there is to match.
    await expect(page.locator('.choice-dot')).toHaveCount(0);
    await shot(page, `support-numerals-${vp.w}x${vp.h}`);
    // First help: the strategy (count on from the bigger number).
    await page.getByTestId('help').click();
    await expect(page.locator('[data-cue="counton"]')).toBeVisible();
    await expect(page.locator('.og-item')).toHaveCount(0);
    await shot(page, `support-numerals-help-cue-${vp.w}x${vp.h}`);
    // Second help: the full dots.
    await page.getByTestId('help').click();
    await expect(page.locator('.og-item')).toHaveCount(7);
    await expect(page.locator('.choice-dot').first()).toBeVisible();
    await expect(page.getByTestId('help')).toHaveCount(0);
    await shot(page, `support-numerals-help-dots-${vp.w}x${vp.h}`);
  });

  test(`pad level at ${vp.w}x${vp.h}: keys 0 to 10, clear and OK, all 120 px or more`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await seed(page, { cardId: 'add:3+4', level: 'pad' });
    await toRun(page);
    await expect(page.locator('.early-question')).toHaveAttribute('data-support', 'pad');
    await expect(page.locator('.choice')).toHaveCount(0);
    await bigEnough(page, '.numpad-key', 13, vp.w);
    await noSideScroll(page);
    for (let n = 0; n <= 10; n++) await expect(page.getByRole('button', { name: String(n), exact: true })).toBeVisible();
    await page.getByRole('button', { name: '7', exact: true }).click();
    await expect(page.locator('.math-answer')).toHaveText('7');
    await shot(page, `support-pad-${vp.w}x${vp.h}`);
    // The OK key stays on screen without scrolling.
    const ok = (await page.getByRole('button', { name: 'OK' }).boundingBox())!;
    expect(ok.y + ok.height).toBeLessThanOrEqual(vp.h);
  });
}

test('the pad grades by number: a right key is Hit, a wrong key drops the fact to numerals with the choices back', async ({ page }) => {
  await seed(page, { cardId: 'add:3+4', level: 'pad' });
  await toRun(page);
  await page.getByRole('button', { name: '7', exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.early-check')).toBeVisible();
  expect((await stored(page, 'add:3+4')).supportLevel).toBe('pad');
});

test('a wrong pad answer drops the fact to numerals', async ({ page }) => {
  await seed(page, { cardId: 'add:3+4', level: 'pad' });
  await toRun(page);
  await page.getByRole('button', { name: '5', exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  // After a miss only the right answer is live.
  await expect(page.locator('.choice')).toHaveCount(1);
  await expect(page.locator('.choice')).toHaveAttribute('data-answer', 'true');
  await expect.poll(async () => (await stored(page, 'add:3+4')).supportLevel).toBe('numerals');
  expect((await stored(page, 'add:3+4')).supportHold).toBe(2);
});

test('the pad says each key out loud, and says nothing while muted', async ({ page }) => {
  await seed(page, { cardId: 'add:3+4', level: 'pad' });
  await toRun(page);
  const before = (await spoken(page)).length;
  await page.getByRole('button', { name: '9', exact: true }).click();
  await expect.poll(async () => (await spoken(page)).slice(before)).toContain('nine');
});

test('a muted pad key makes no sound', async ({ page }) => {
  await seed(page, { cardId: 'add:3+4', level: 'pad', muted: true });
  await toRun(page);
  const before = (await spoken(page)).length;
  await page.getByRole('button', { name: '9', exact: true }).click();
  await page.waitForTimeout(400);
  expect((await spoken(page)).length).toBe(before);
});

test('a second right answer in a row without help moves a fact from dots to numerals', async ({ page }) => {
  await seed(page, { cardId: 'add:1+2', level: 'dots', run: 1 });
  await toRun(page);
  await page.locator('.choice[data-answer="true"]').click();
  await expect(page.locator('.early-check')).toBeVisible();
  const c = await stored(page, 'add:1+2');
  expect(c.supportLevel).toBe('numerals');
  expect(c.supportRun).toBe(0);
});

test('a first right answer without help keeps the fact on dots and counts 1 toward numerals', async ({ page }) => {
  await seed(page, { cardId: 'add:1+2', level: 'dots' });
  await toRun(page);
  await page.locator('.choice[data-answer="true"]').click();
  await expect(page.locator('.early-check')).toBeVisible();
  const c = await stored(page, 'add:1+2');
  expect(c.supportLevel).toBe('dots');
  expect(c.supportRun).toBe(1);
});

test('a right answer with help is rated Hard and sends the fact back to dots', async ({ page }) => {
  await seed(page, { cardId: 'add:1+2', level: 'numerals', run: 1 });
  await toRun(page);
  await page.getByTestId('help').click();
  await expect(page.locator('.og-item')).toHaveCount(3);
  await page.locator('.choice[data-answer="true"]').click();
  await expect(page.locator('.early-check')).toBeVisible();
  const c = await stored(page, 'add:1+2');
  expect(c.supportLevel).toBe('dots');
  expect(c.supportRun).toBe(0);
  expect(c.lastRating).toBe(2);
});

test('strategy cues: a double, and make 10 with the gap', async ({ page }) => {
  await seed(page, { cardId: 'add:4+4', level: 'dots' });
  await toRun(page);
  await expect(page.locator('[data-cue="double"]')).toContainText('4 + 4, double!');
  await shot(page, 'cue-double-1024x768');
});

test('strategy cue: make 10 shows a ten-frame with the gap highlighted', async ({ page }) => {
  await seed(page, { cardId: 'add:4+5', level: 'dots' });
  await toRun(page);
  await expect(page.locator('[data-cue="make10"] .tf-cell.is-gap')).toHaveCount(1);
  await expect(page.locator('[data-cue="make10"] .tf-cell.is-on')).toHaveCount(9);
  await shot(page, 'cue-make10-1024x768');
});

test('an old card with no support field shows dots', async ({ page }) => {
  await seed(page, { cardId: 'add:1+2' });
  await toRun(page);
  await expect(page.locator('.early-question')).toHaveAttribute('data-support', 'dots');
});

for (const vp of PHONES) {
  test(`4 choices wrap 2 by 2 at ${vp.w} px wide, every button 120 px or more, no side scroll`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await seed(page, { cardId: 'add:1+2', level: 'numerals' });
    await toRun(page);
    await bigEnough(page, '.choice', 4, vp.w);
    const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).map((e) => `${e.tagName}.${(e as HTMLElement).className} ${Math.round(e.getBoundingClientRect().right)}`).slice(0, 6));
    console.log('WIDE', vp.w, JSON.stringify(wide));
    await noSideScroll(page);
    const rects = await page.locator('.choice').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; }));
    expect(new Set(rects.map((r) => r.y)).size).toBe(2);
    expect(new Set(rects.map((r) => r.x)).size).toBe(2);
    await shot(page, `choices-2x2-${vp.w}x${vp.h}`);
    await page.getByTestId('help').click();
    await page.locator('.choice[data-answer="true"]').click();
    await expect(page.locator('.early-check')).toBeVisible();
  });
}
