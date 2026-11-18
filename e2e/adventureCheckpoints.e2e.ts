import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Adventure trips checkpoint a session at 820x1180, system Chrome, touch, local data. A pre-reader and a reader answer in
 * Adventure, leave without the campfire (pagehide), resume, camp, and the parent area shows one Adventure run. Fixture names only.
 * SCREENSHOTS=1 writes PNGs under docs/screenshots/adventure-checkpoints.
 */
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/adventure-checkpoints' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidchk00000000000001';
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

async function holdCamp(page: Page) {
  const house = (await page.getByRole('button', { name: 'Hold to go to camp' }).boundingBox())!;
  await page.mouse.move(house.x + house.width / 2, house.y + house.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
}

const pagehide = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

async function parentRuns(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /parent/i }).first().click();
  for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await expect(page.locator('.parent')).toBeVisible();
  await page.locator('.tabs .tab', { hasText: 'Pip' }).click();
  await expect(page.getByRole('heading', { name: 'Recent runs' })).toBeVisible();
}

test.use({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });

for (const learner of ['prereader', 'reader'] as const) {
  test(`${learner}: leave at a pagehide, resume the same trip, camp: one session doc, finished, XP credited once; the parent sees an Adventure run`, async ({ page }) => {
    await seed(page, learner === 'prereader' ? PRE : READER);
    await openAdventure(page, learner);
    await answerOne(page, learner);
    // Leaving without the campfire: a pagehide is a checkpoint.
    await pagehide(page);
    await expect.poll(async () => (await logs(page))?.length ?? 0).toBe(1);
    const first = (await logs(page))![0]!;
    expect(first).toMatchObject({ mode: 'overworld', finished: false, graded: 1 });
    expect(first.xpCredited).toBeGreaterThan(0);
    expect(await kidXp(page)).toBe(first.xpCredited);

    // Come back: the same trip resumes, a second answer, then the campfire.
    await page.reload();
    await page.locator('.kid-card', { hasText: 'Pip' }).click();
    if (learner === 'prereader') await page.getByRole('button', { name: 'Adventure' }).click();
    else await page.locator('.mode-card[data-mode="overworld"]').click();
    await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
    await answerOne(page, learner);
    await holdCamp(page);
    await expect.poll(async () => (await logs(page))![0]!.finished).toBe(true);
    const all = (await logs(page))!;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: first.id, finished: true, endedBy: 'camp', mode: 'overworld', graded: 2 });
    expect(await kidXp(page)).toBe(all[0]!.xpCredited);
    expect(all[0]!.xpCredited).toBeGreaterThan(first.xpCredited!);

    // The parent area: recent runs lists it as an Adventure run, and the map line reads world/main.
    await parentRuns(page);
    const row = page.locator('[data-testid=run-mode][data-mode="overworld"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Adventure · meadow · 2 answers · finished');
    await expect(page.getByTestId('adventure-line')).toContainText('Adventure: reached the');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/recent-runs-${learner}-820x1180.png`, fullPage: true });
  });
}

test('an Adventure trip left open shows in progress in the parent area, with its answers', async ({ page }) => {
  await seed(page, PRE);
  await openAdventure(page, 'prereader');
  await answerOne(page, 'prereader');
  await pagehide(page);
  await expect.poll(async () => (await logs(page))?.length ?? 0).toBe(1);
  await parentRuns(page);
  await expect(page.locator('[data-testid=run-mode][data-mode="overworld"]')).toContainText('Adventure · meadow · 1 answer · in progress');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/recent-runs-in-progress-820x1180.png`, fullPage: true });
});

test('Picture Run tags its session log mode prereader', async ({ page }) => {
  await seed(page, PRE);
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.locator('.early-run .choice[data-answer="true"]').click();
  await expect(page.locator('.early-run .math-answer')).not.toHaveText('?');
  const house = (await page.getByRole('button', { name: 'Hold to leave' }).boundingBox())!;
  await page.mouse.move(house.x + house.width / 2, house.y + house.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2300);
  await page.mouse.up();
  await expect.poll(async () => (await logs(page))?.length ?? 0, { timeout: 10_000 }).toBe(1);
  expect((await logs(page))![0]!.mode).toBe('prereader');
});
