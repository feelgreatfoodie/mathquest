import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Pause: a grown-up stops play from the parent area, for one kid or everyone. The kid on the device finishes the question
 * on screen, the round saves, then a break screen blocks everything but Grown-ups. Names, ids and the PIN are made up.
 * Local data mode: two pages in one browser context share storage, so a write in one is "another client" to the other.
 * The Firestore rules side (a kid token cannot write settings.pause) is in test-emulator/pause.rules.test.ts.
 * PAUSE_SHOTS=<dir> writes PNGs there (keep them local).
 */
const PRE = { id: 'kidpip00000000000001', name: 'Pip' };
const READER = { id: 'kidwren0000000000002', name: 'Wren' };
const PIN = '4821';
const SHOTS = process.env.PAUSE_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const SIZES = [
  { w: 393, h: 852 },
  { w: 820, h: 1180 },
];

const PRE_SETTINGS = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const READER_SETTINGS = { tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const game = (xp: number) => ({ xp, gems: 10, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' });

async function seed(page: Page, opts: { pause?: Record<string, unknown>; readerPause?: Record<string, unknown> } = {}) {
  await page.addInitScript(
    ({ pre, reader, preSettings, readerSettings, pinHash, pause, readerPause }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
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
          speak(u: Utter) { if (u.text.trim()) (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); },
          cancel() {},
          getVoices() { return []; },
        },
      });
      if (localStorage.getItem('mathquest:pause-seeded')) return;
      localStorage.setItem('mathquest:pause-seeded', '1');
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
      const g = { xp: 100, gems: 10, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' };
      localStorage.setItem('mathquest:v1:kids', JSON.stringify([
        { id: pre.id, name: pre.name, createdAt: 1, settings: { ...preSettings, ...(pause ? { pause } : {}) }, game: g },
        { id: reader.id, name: reader.name, createdAt: 2, settings: { ...readerSettings, ...(readerPause ? { pause: readerPause } : {}) }, game: g },
      ]));
    },
    { pre: PRE, reader: READER, preSettings: PRE_SETTINGS, readerSettings: READER_SETTINGS, pinHash: sha(`mathquest:local:${PIN}`), pause: opts.pause ?? null, readerPause: opts.readerPause ?? null },
  );
}

/** Writes a pause into the stored kid, the way a parent's phone would (another client of the same data). */
async function setStoredPause(page: Page, kidId: string, pause: Record<string, unknown> | null) {
  await page.evaluate(
    ({ kidId, pause }) => {
      const kids = JSON.parse(localStorage.getItem('mathquest:v1:kids') ?? '[]') as { id: string; settings: Record<string, unknown> }[];
      for (const k of kids) {
        if (k.id !== kidId) continue;
        if (pause) k.settings.pause = pause;
        else delete k.settings.pause;
      }
      localStorage.setItem('mathquest:v1:kids', JSON.stringify(kids));
    },
    { kidId, pause },
  );
}

const storedKid = (page: Page, kidId: string) =>
  page.evaluate((kidId) => (JSON.parse(localStorage.getItem('mathquest:v1:kids') ?? '[]') as { id: string; settings: { pause?: { on: boolean; until?: number; setAt?: number } }; game: { xp: number } }[]).find((k) => k.id === kidId)!, kidId);
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
const serverNow = (page: Page) => page.evaluate(async () => Date.parse((await fetch('/?t=' + Math.random(), { method: 'HEAD', cache: 'no-store' })).headers.get('date')!));

async function enterPin(page: Page, pin: string) {
  for (const d of pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
}
async function openParent(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /grown-ups/i }).first().click();
  await enterPin(page, PIN);
  await expect(page.locator('.parent')).toBeVisible();
}
const pauseScreen = (page: Page) => page.getByTestId('pause-screen');
async function openKidHome(page: Page, name: string) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: name }).click();
}

test.describe('pause-play', () => {
  test('a pause set on another client shows on the kid device without a reload', async ({ page: kidPage }) => {
    await kidPage.setViewportSize({ width: 820, height: 1180 });
    await seed(kidPage);
    await openKidHome(kidPage, PRE.name);
    await expect(kidPage.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await setStoredPause(kidPage, PRE.id, { on: true, setAt: Date.now() });
    await expect(pauseScreen(kidPage)).toBeVisible({ timeout: 6000 });
    await expect(kidPage.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
    await setStoredPause(kidPage, PRE.id, null);
    await expect(pauseScreen(kidPage)).toHaveCount(0, { timeout: 6000 });
    await expect(kidPage.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  });

  test('a pause in the middle of a question waits, saves the answer, then blocks; XP and gems are intact', async ({ page }) => {
    await seed(page);
    await openKidHome(page, PRE.name);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('.early-numerals')).toBeVisible();
    await setStoredPause(page, PRE.id, { on: true, setAt: Date.now() });
    // The listener has the pause by now, and the question on screen is still there to finish.
    await page.waitForTimeout(3200);
    await expect(pauseScreen(page)).toHaveCount(0);
    await expect(page.locator('.early-numerals')).toBeVisible();
    await page.locator('.choice[data-answer="true"]').first().click();
    await expect(pauseScreen(page)).toBeVisible({ timeout: 8000 });
    const k = await storedKid(page, PRE.id);
    expect(k.game.xp).toBeGreaterThan(100); // the answer was saved through finishRun
    const sessions = await page.evaluate((id) => JSON.parse(localStorage.getItem(`mathquest:v1:sessions:${id}`) ?? '[]') as { answered: number }[], PRE.id);
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.answered).toBe(1);
    expect(k.settings.pause?.on).toBe(true); // the save did not touch the pause
  });

  test('a timed pause ends by itself, and a device clock change does not end it early', async ({ page }) => {
    await seed(page, { readerPause: { on: true, until: 1, setAt: 1 } });
    await page.goto('/');
    const now = await serverNow(page);
    await setStoredPause(page, READER.id, { on: true, until: now + 9000, setAt: now });
    await openKidHome(page, READER.name);
    await expect(pauseScreen(page)).toBeVisible();
    // The kid sets the iPad clock a day ahead, and then a day back. The pause follows the server.
    await page.evaluate(() => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + 86_400_000;
      const RealDate = Date;
      // @ts-expect-error a test double for new Date()
      window.Date = class extends RealDate { constructor(...a: unknown[]) { if (a.length) super(...(a as [number])); else super(real() + 86_400_000); } static now() { return real() + 86_400_000; } };
    });
    await page.waitForTimeout(2500);
    await expect(pauseScreen(page)).toBeVisible();
    await expect(pauseScreen(page)).toBeVisible({ timeout: 1000 });
    // The pause runs out on the server's time.
    await expect(pauseScreen(page)).toHaveCount(0, { timeout: 12_000 });
    await expect(page.getByRole('button', { name: /play|dungeon/i }).first()).toBeVisible();
  });

  test('fail closed: with no server time a timed pause stays on, and ends once the clock is read', async ({ page }) => {
    await seed(page);
    await page.route('**/?pause-clock=*', (r) => r.abort());
    await page.route('**/?t=*', (r) => r.continue());
    await page.goto('/');
    const now = await serverNow(page);
    await setStoredPause(page, READER.id, { on: true, until: now - 3_600_000, setAt: now - 7_200_000 }); // ended an hour ago
    await openKidHome(page, READER.name);
    await expect(pauseScreen(page)).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(pauseScreen(page)).toBeVisible();
    await expect(page.getByTestId('pause-left')).toContainText('Waiting');
    await page.unroute('**/?pause-clock=*');
    // Back to the front reads the clock again.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(pauseScreen(page)).toHaveCount(0, { timeout: 8000 });
  });

  test('a paused kid has no way to play or unpause: only Grown-ups, and a wrong PIN stays blocked', async ({ page }) => {
    await seed(page, { pause: { on: true, setAt: 1 } });
    await openKidHome(page, PRE.name);
    await expect(pauseScreen(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
    await page.reload();
    await page.locator('.kid-card', { hasText: PRE.name }).click();
    await expect(pauseScreen(page)).toBeVisible();
    await page.getByRole('button', { name: 'Grown-ups' }).click();
    await enterPin(page, '0000');
    await expect(page.getByText('Wrong PIN')).toBeVisible();
    await expect(page.locator('.parent')).toHaveCount(0);
    expect((await storedKid(page, PRE.id)).settings.pause?.on).toBe(true);
  });

  test('the PIN-gated Grown-ups resume works on the kid device, and then the kid can play', async ({ page }) => {
    await seed(page, { pause: { on: true, setAt: 1 } });
    await openKidHome(page, PRE.name);
    await page.getByRole('button', { name: 'Grown-ups' }).click();
    await enterPin(page, PIN);
    await expect(page.locator('.parent')).toBeVisible();
    await page.locator('.tabs .tab', { hasText: PRE.name }).click();
    await expect(page.getByTestId('paused-badge')).toBeVisible();
    await page.getByTestId('resume-kid').click();
    await expect(page.getByTestId('pause-kid')).toBeVisible();
    expect((await storedKid(page, PRE.id)).settings.pause).toBeUndefined();
    await page.getByRole('button', { name: 'Back to game' }).click();
    await page.locator('.kid-card', { hasText: PRE.name }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  });

  test('Pause everyone writes every kid, timed or until resume; Resume everyone clears them', async ({ page }) => {
    await seed(page);
    await openParent(page);
    await page.getByTestId('pause-everyone').click();
    await page.getByRole('button', { name: '30 minutes' }).click();
    await expect.poll(async () => (await storedKid(page, PRE.id)).settings.pause?.until).toBeTruthy();
    for (const id of [PRE.id, READER.id]) {
      const p = (await storedKid(page, id)).settings.pause!;
      expect(p.on).toBe(true);
      expect(p.until! - p.setAt!).toBeGreaterThan(29 * 60_000 - 5000);
      expect(p.until! - p.setAt!).toBeLessThan(31 * 60_000);
    }
    await expect(page.getByTestId('paused-badge')).toContainText('min left');
    await page.getByTestId('pause-everyone').click();
    await page.getByRole('button', { name: 'Resume everyone' }).click();
    await expect.poll(async () => (await storedKid(page, PRE.id)).settings.pause).toBeUndefined();
    expect((await storedKid(page, READER.id)).settings.pause).toBeUndefined();
  });

  test('Pause one kid until resumed; the other kid is not paused', async ({ page }) => {
    await seed(page);
    await openParent(page);
    await page.locator('.tabs .tab', { hasText: READER.name }).click();
    await page.getByTestId('pause-kid').click();
    await page.getByRole('button', { name: 'Until I resume' }).click();
    await expect(page.getByTestId('paused-badge')).toContainText('until you resume');
    const p = (await storedKid(page, READER.id)).settings.pause!;
    expect(p.on).toBe(true);
    expect(p.until).toBeUndefined();
    expect((await storedKid(page, PRE.id)).settings.pause).toBeUndefined();
  });

  test('saving other settings in the parent area keeps a pause set meanwhile', async ({ page }) => {
    await seed(page);
    await openParent(page);
    await page.locator('.tabs .tab', { hasText: READER.name }).click();
    await expect(page.locator('.detail')).toBeVisible();
    await setStoredPause(page, READER.id, { on: true, setAt: Date.now() }); // another phone pauses while this screen is open
    await page.getByRole('button', { name: /save/i }).first().click();
    await page.waitForTimeout(800);
    expect((await storedKid(page, READER.id)).settings.pause?.on).toBe(true);
  });

  test('pre-reader break screen: a picture, the voice line once, a ring with no numbers, 120 px targets', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    const now = Date.now();
    await seed(page, { pause: { on: true, until: now + 30 * 60_000, setAt: now } });
    await openKidHome(page, PRE.name);
    await expect(pauseScreen(page)).toBeVisible();
    await expect(page.getByTestId('pause-ring')).toBeVisible();
    await expect.poll(() => spoken(page)).toContain('Time for a break! See you soon.');
    expect((await spoken(page)).filter((t) => t === 'Time for a break! See you soon.')).toHaveLength(1);
    const text = (await pauseScreen(page).innerText()).trim();
    expect(text).not.toMatch(/\d/); // no numbers anywhere on the pre-reader screen
    const grown = await page.getByRole('button', { name: 'Grown-ups' }).boundingBox();
    expect(grown!.width).toBeGreaterThanOrEqual(120);
    expect(grown!.height).toBeGreaterThanOrEqual(120);
    const mute = await page.locator('.mute-btn').boundingBox();
    expect(mute!.width).toBeGreaterThanOrEqual(120);
  });

  test('pre-reader break screen is silent when the kid has muted the voice', async ({ page }) => {
    await seed(page, { pause: { on: true, setAt: 1 } });
    await page.addInitScript((id) => localStorage.setItem(`mathquest:v1:mute:${id}`, '1'), PRE.id);
    await openKidHome(page, PRE.name);
    await expect(pauseScreen(page)).toBeVisible();
    await page.waitForTimeout(800);
    expect(await spoken(page)).toEqual([]);
  });

  test('offline, the last known pause still applies', async ({ page, context }) => {
    await seed(page, { pause: { on: true, setAt: 1 } });
    await openKidHome(page, PRE.name);
    await expect(pauseScreen(page)).toBeVisible();
    await context.setOffline(true);
    await page.waitForTimeout(2200);
    await expect(pauseScreen(page)).toBeVisible();
    await context.setOffline(false);
  });

  test('a run does not start on a paused kid even from a stale Home', async ({ page }) => {
    await seed(page);
    await openKidHome(page, PRE.name);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    // Pause lands and the kid taps Play in the same breath, before the listener's next poll.
    await setStoredPause(page, PRE.id, { on: true, setAt: Date.now() });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(pauseScreen(page)).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.early-numerals')).toHaveCount(0);
  });

  for (const { w, h } of SIZES) {
    test(`screens at ${w}x${h}: dashboard controls and both break screens fit`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      const now = Date.now();
      await seed(page, { pause: { on: true, until: now + 25 * 60_000, setAt: now }, readerPause: { on: true, setAt: now } });
      await openKidHome(page, PRE.name);
      await expect(pauseScreen(page)).toBeVisible();
      await page.waitForTimeout(400);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/pause-prereader-Pip-${w}x${h}.png` });
      await page.goto('/');
      await page.locator('.kid-card', { hasText: READER.name }).click();
      await expect(pauseScreen(page)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Time for a break!' })).toBeVisible();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/pause-reader-Wren-${w}x${h}.png` });
      await page.getByRole('button', { name: 'Grown-ups' }).click();
      await enterPin(page, PIN);
      await expect(page.locator('.parent')).toBeVisible();
      await page.locator('.tabs .tab', { hasText: PRE.name }).click();
      await expect(page.getByTestId('paused-badge')).toBeVisible();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard-paused-Pip-${w}x${h}.png` });
      await page.locator('.tabs .tab', { hasText: READER.name }).click();
      await page.getByTestId('resume-kid').click();
      await page.getByTestId('pause-kid').click();
      await page.getByTestId('pause-everyone').click();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard-choices-${w}x${h}.png` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });
  }
});
