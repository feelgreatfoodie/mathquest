import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Adventure for every player, at 820x1180, system Chrome, touch. A pre-reader (no `modes` field in the doc) sees two
 * buttons on Home, walks the map, opens one encounter, answers it with a big choice button, camps, and the trip saves.
 * Readers keep the keypad. Names and ids are made up. The voice and WebAudio are stubbed.
 * SCREENSHOTS=1 writes PNGs under docs/screenshots/adventure-all-players.
 */
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/adventure-all-players' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidadv00000000000001';

const PRE = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const READER = { tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 8, maxNew: 2, factGroupsUnlocked: 1, paceMultiplier: 3 };

async function seed(page: Page, settings: object) {
  await page.addInitScript(
    ({ kid, settings }) => {
      const w = window as unknown as Record<string, unknown>;
      class Utter { text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      w.__spoken = [] as string[];
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: { speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } },
      });
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
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name: 'Pip', createdAt: 1, settings, game: { xp: 0, gems: 5, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
      }
    },
    { kid: KID, settings },
  );
}

type Ow = {
  state(): { entities: Array<{ id: string; kind: string; x: number; y: number; shown: boolean; cardId: string }>; paused: boolean };
  modalAnswer(): number | null;
  tapTile(x: number, y: number): void;
};
const ow = <T,>(page: Page, f: (o: Ow) => T) => page.evaluate((src) => new Function('o', `return (${src})(o)`)((window as unknown as { __ow: Ow }).__ow) as T, f.toString());
const read = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);

test.use({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });

test('a pre-reader sees Play and Adventure at 120 px or more, plays one Adventure encounter with big choices, camps, and the trip saves', async ({ page }) => {
  await seed(page, PRE);
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();

  const play = page.getByRole('button', { name: 'Play' });
  const adventure = page.getByRole('button', { name: 'Adventure' });
  await expect(play).toBeVisible();
  await expect(adventure).toBeVisible();
  for (const b of [play, adventure]) {
    const box = (await b.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(120);
    expect(box.height).toBeGreaterThanOrEqual(120);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/prereader-home-820x1180.png` });

  await adventure.click();
  expect(await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toContain('Adventure!');
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/prereader-map-820x1180.png` });

  // The movement controls: measured, not changed.
  const sizes: Record<string, { w: number; h: number }> = {};
  for (const d of ['up', 'left', 'down', 'right']) {
    const box = (await page.getByRole('button', { name: `Walk ${d}` }).boundingBox())!;
    sizes[d] = { w: Math.round(box.width), h: Math.round(box.height) };
  }
  const camp = (await page.getByRole('button', { name: 'Hold to go to camp' }).boundingBox())!;
  console.log(`MOVEMENT_CONTROLS_820x1180 ${JSON.stringify({ ...sizes, camp: { w: Math.round(camp.width), h: Math.round(camp.height) } })}`);

  // Open one encounter: walk to the first shown monster or chest.
  const target = (await ow(page, (o) => o.state())).entities.find((e) => e.shown) ?? (await ow(page, (o) => o.state())).entities[0]!;
  await ow(page, (o) => o.tapTile(0, 0)); // warm the hook; the real tap follows
  await page.evaluate(([x, y]) => (window as unknown as { __ow: Ow }).__ow.tapTile(x!, y!), [target.x, target.y]);
  await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });

  // A pre-reader gets the picture panel, never the keypad, and 3 choices of at least 120 px.
  await expect(page.locator('.question-modal .keypad')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Walk' })).toHaveCount(0); // the pad hides so it never covers a choice
  const choices = page.locator('.question-modal .choice');
  await expect(choices).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const box = (await choices.nth(i).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(120);
    expect(box.height).toBeGreaterThanOrEqual(120);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/prereader-question-820x1180.png` });
  await page.locator('.question-modal .choice[data-answer="true"]').click();
  await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 10_000 });

  // Camp: hold the house for 1 s. The trip saves the session, the card and the world.
  const house = (await page.getByRole('button', { name: 'Hold to go to camp' }).boundingBox())!;
  await page.mouse.move(house.x + house.width / 2, house.y + house.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await expect.poll(async () => ((await read(page, `mathquest:v1:sessions:${KID}`)) as unknown[] | null)?.length ?? 0, { timeout: 10_000 }).toBe(1);
  const sessions = (await read(page, `mathquest:v1:sessions:${KID}`)) as Array<{ answered: number; correct: number }>;
  expect(sessions[0]!.answered).toBe(1);
  expect(sessions[0]!.correct).toBe(1);
  expect(Object.keys((await read(page, `mathquest:v1:cards:${KID}`)) ?? {}).length).toBeGreaterThan(0);
  expect(await read(page, `mathquest:v1:world:${KID}`)).toMatchObject({ region: 'meadow', version: 1 });
  const kids = (await read(page, 'mathquest:v1:kids')) as Array<{ game: { xp: number } }>;
  expect(kids[0]!.game.xp).toBeGreaterThan(0);
});

test('a reader with no modes field sees Dungeon Run and Adventure, and Adventure still asks on the keypad', async ({ page }) => {
  await seed(page, READER);
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await expect(page.locator('.mode-card')).toHaveCount(2);
  await expect(page.locator('.mode-card[data-mode="dungeon"]')).toBeVisible();
  await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
  const e = (await ow(page, (o) => o.state())).entities.find((x) => x.shown)!;
  await page.evaluate(([x, y]) => (window as unknown as { __ow: Ow }).__ow.tapTile(x!, y!), [e.x, e.y]);
  await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
  const teach = page.getByRole('button', { name: 'Let me try one!' });
  if (await teach.isVisible()) await teach.click();
  await expect(page.locator('.question-modal .keypad')).toBeVisible();
  await expect(page.locator('.question-modal .choice')).toHaveCount(0);
});

test('a pre-reader whose parent turned Adventure off sees Play only', async ({ page }) => {
  await seed(page, { ...PRE, modes: { overworld: false } });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adventure' })).toHaveCount(0);
});
