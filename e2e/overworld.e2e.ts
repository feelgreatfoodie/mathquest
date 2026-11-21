import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FACTS } from '../src/engine/modules/facts';

/**
 * Adventure (the Overworld) at 820x1180, system Chrome, touch. Names and ids are made up.
 * The dev server exposes window.__ow (state, tapTile, teleport, answerOf, clientOf) so the spec can read the map;
 * every question is answered through the real keypad. SCREENSHOTS=1 writes PNGs under docs/screenshots/overworld.
 */
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/overworld' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidow10000000000001';
const DAY = 86_400_000;

const settings = (over: object = {}) => ({
  tracks: { facts: true, multidigit: false, fractions: false },
  sessionSize: 8,
  maxNew: 2,
  factGroupsUnlocked: 1,
  paceMultiplier: 3,
  ...over,
});
const game = { xp: 0, gems: 5, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' };

/** Seen, due cards for the first `n` facts (or the first groups), so the trip is monsters, not chests. */
function dueCards(ids: string[], now: number, dueIn = -DAY) {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        id, attempts: 4, correct: 4, recentMs: [2500, 2600], lastRating: 3, updatedAt: now - 3 * DAY, day: '2000-01-01', dayGraded: 1, lastResults: [true, true],
        fsrs: { due: now + dueIn, stability: 5, difficulty: 5, elapsed_days: 3, scheduled_days: 5, learning_steps: 0, reps: 3, lapses: 0, state: 2, last_review: now - 3 * DAY },
      },
    ]),
  );
}

async function seed(page: Page, opts: { settings?: object; cards?: Record<string, unknown>; extraGame?: object; tripId?: string } = {}) {
  await page.addInitScript(
    ({ kid, settings, game, cards, tripId }) => {
      let a = 99;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name: 'Ada', createdAt: 1, settings, game }]));
        if (cards) localStorage.setItem(`mathquest:v1:cards:${kid}`, JSON.stringify(cards));
        // A stored open trip under 24 h old resumes, so its id (and with it the chest spots) is fixed.
        if (tripId) {
          const t = Date.now();
          const totals = { answered: 0, graded: 0, correct: 0, fast: 0, newLearned: 0, xp: 0, bestCombo: 0, medianMs: 0, missed: [] };
          localStorage.setItem(`mathquest:v1:trip:${kid}`, JSON.stringify({ tripId, startedAt: t, seq: 0, updatedAt: t, finished: false, totals, chests: { opened: [] } }));
        }
      }
    },
    { kid: KID, settings: settings(opts.settings), game: { ...game, ...opts.extraGame }, cards: opts.cards ?? null, tripId: opts.tripId ?? null },
  );
}

type Ow = {
  state(): { region: string; hero: { x: number; y: number }; moving: boolean; paused: boolean; entities: Array<{ id: string; kind: string; x: number; y: number; shown: boolean; cardId: string }>; world: { openedChests: string[]; keys: number; bossesDefeated: string[] } };
  answerOf(id: string): number | null;
  modalAnswer(): number | null;
  tapTile(x: number, y: number): void;
  teleport(x: number, y: number): void;
  clientOf(x: number, y: number): { x: number; y: number };
};
const ow = <T,>(page: Page, f: (o: Ow) => T) => page.evaluate((src) => new Function('o', `return (${src})(o)`)((window as unknown as { __ow: Ow }).__ow) as T, f.toString());

async function openAdventure(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Ada' }).click();
  await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
}

async function typeAnswer(page: Page, n: number) {
  for (const d of String(n)) await page.locator('.question-modal .keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await page.locator('.question-modal .key-go').click();
}

/** Walks to a monster or chest, answers it right through the keypad, waits for the modal to close. */
async function clear(page: Page, id: string, tapReal = false) {
  const e = (await ow(page, (o) => o.state())).entities.find((x) => x.id === id)!;
  if (tapReal) {
    const p = await ow(page, (o) => o.clientOf(0, 0)); // keeps the helper warm
    expect(p).toBeDefined();
    const c = await page.evaluate(([x, y]) => (window as unknown as { __ow: Ow }).__ow.clientOf(x!, y!), [e.x, e.y]);
    await page.touchscreen.tap(c.x, c.y);
  } else await page.evaluate(([x, y]) => (window as unknown as { __ow: Ow }).__ow.tapTile(x!, y!), [e.x, e.y]);
  await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
  const teach = page.getByRole('button', { name: 'Let me try one!' });
  if (await teach.isVisible()) await teach.click();
  // Walking over another monster opens that one first, so the answer comes from the question that is open.
  await expect(page.locator('.question-modal .keypad .key:not([disabled])').first()).toBeVisible();
  const ans = await page.evaluate(() => (window as unknown as { __ow: Ow }).__ow.modalAnswer());
  await typeAnswer(page, ans!);
  await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 8000 });
}

test.use({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });

test('the picker shows one start button with Adventure off and two mode cards with it on', async ({ page }) => {
  await seed(page, { settings: { modes: { overworld: false } } });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Ada' }).click();
  await expect(page.getByRole('button', { name: 'Start Quest' })).toBeVisible();
  await expect(page.locator('.mode-card')).toHaveCount(0);
  const ctx2 = await page.context().browser()!.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  const p2 = await ctx2.newPage();
  await seed(p2, { settings: { modes: { overworld: true } } });
  await p2.goto('/');
  await p2.locator('.kid-card', { hasText: 'Ada' }).click();
  await expect(p2.locator('.mode-card')).toHaveCount(2);
  await expect(p2.getByRole('button', { name: 'Start Quest' })).toHaveCount(0);
  if (SHOTS) await p2.screenshot({ path: `${SHOTS}/home-two-modes-820x1180.png` });
});

test('tap a monster: the hero walks, the panel opens, a correct answer defeats it, the card saves', async ({ page }) => {
  const now = Date.now();
  await seed(page, { settings: { modes: { overworld: true } }, cards: dueCards(FACTS.groups![0]!.cardIds.slice(0, 10), now), tripId: 'trip-tap-a-monster' });
  await openAdventure(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/map-820x1180.png` });
  const s0 = await ow(page, (o) => o.state());
  // Nearest first: the camera follows the hero, so a monster far up the map can sit above the screen and a real tap on it hits nothing.
  const monsters = s0.entities.filter((e) => e.kind === 'monster' && e.shown).sort((p, q) => Math.abs(p.x - s0.hero.x) + Math.abs(p.y - s0.hero.y) - (Math.abs(q.x - s0.hero.x) + Math.abs(q.y - s0.hero.y)));
  expect(monsters.length).toBeLessThanOrEqual(6);
  expect(monsters.length).toBeGreaterThan(0);
  await clear(page, monsters[0]!.id, true);
  const s1 = await ow(page, (o) => o.state());
  expect(s1.entities.find((e) => e.id === monsters[0]!.id)).toBeUndefined();
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(`mathquest:v1:cards:${k}`) ?? '{}'), KID);
  const card = stored[monsters[0]!.cardId];
  expect(card.updatedAt).toBeGreaterThan(now - 5000);
  expect(card.attempts).toBe(5);
});

test('walking adds nothing to graded time: the clock starts when the panel opens', async ({ page }) => {
  const now = Date.now();
  await seed(page, { settings: { modes: { overworld: true } }, cards: dueCards(FACTS.groups![0]!.cardIds.slice(0, 10), now) });
  await openAdventure(page);
  const m = (await ow(page, (o) => o.state())).entities.find((e) => e.kind === 'monster' && e.shown)!;
  const t0 = Date.now();
  await page.evaluate(([x, y]) => (window as unknown as { __ow: Ow }).__ow.tapTile(x!, y!), [m.x, m.y]);
  await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
  const walked = Date.now() - t0;
  expect(walked).toBeGreaterThan(1500); // the walk took real time
  const ans = await page.evaluate(() => (window as unknown as { __ow: Ow }).__ow.modalAnswer());
  const card = await page.evaluate(() => (document.querySelector('.question-modal .math')?.textContent ?? ''));
  expect(card).toMatch(/\d/);
  await typeAnswer(page, ans!);
  await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 8000 });
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(`mathquest:v1:cards:${k}`) ?? '{}'), KID);
  const ms = (Object.values(stored) as Array<{ recentMs: number[]; updatedAt: number }>).sort((a, b) => b.updatedAt - a.updatedAt)[0]!.recentMs.at(-1) as number;
  expect(ms).toBeLessThan(walked - 1000); // the answer took well under the walk
});

test('a chest holds a new card: opening it and answering right adds 1 or 2 gems and counts the chest', async ({ page }) => {
  await seed(page, { settings: { modes: { overworld: true }, maxNew: 2, sessionSize: 4 } });
  await openAdventure(page);
  const chest = (await ow(page, (o) => o.state())).entities.find((e) => e.kind === 'chest')!;
  expect(chest).toBeDefined();
  // The trip id is random, so the chest can sit behind a monster. The walk stops on any monster it crosses and opens that
  // one first, so the chest is tapped again until it is gone from the map.
  for (let guard = 0; guard < 4; guard++) {
    await clear(page, chest.id);
    if (!(await ow(page, (o) => o.state())).entities.some((e) => e.id === chest.id)) break;
  }
  // The gem grant is an async write that lands after the modal closes, so the stored count is polled, not read once.
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!)[0].game.gems as number, KID), { timeout: 8000 })
    .toBeGreaterThan(5);
  const gems = await page.evaluate((k) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!)[0].game.gems as number, KID);
  expect([6, 7]).toContain(gems); // 5 + 1 or 2
  const s = await ow(page, (o) => o.state());
  expect(s.world.openedChests).toEqual(['#1']);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-chest-820x1180.png` });
});

test('a closed gate blocks walking and shows progress', async ({ page }) => {
  await seed(page, { settings: { modes: { overworld: true } } });
  await openAdventure(page);
  // Stand next to the forward gate and walk into it.
  await page.evaluate(() => (window as unknown as { __ow: Ow }).__ow.teleport(38, 14));
  await page.evaluate(() => (window as unknown as { __ow: Ow }).__ow.tapTile(39, 14));
  await expect(page.getByTestId('ow-msg')).toContainText('learned');
  expect((await ow(page, (o) => o.state())).region).toBe('meadow');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/closed-gate-820x1180.png` });
});

test('clearing every entry lights the campfire; walking to it ends the trip and saves a session log', async ({ page }) => {
  const now = Date.now();
  await seed(page, { settings: { modes: { overworld: true }, sessionSize: 3, maxNew: 0 }, cards: dueCards(FACTS.groups![0]!.cardIds.slice(0, 6), now) });
  await openAdventure(page);
  await expect(page.getByTestId('camp-lit')).toHaveCount(0);
  for (let guard = 0; guard < 8; guard++) {
    const left = (await ow(page, (o) => o.state())).entities.filter((e) => e.shown);
    if (!left.length) break;
    await clear(page, left[0]!.id);
  }
  await expect(page.getByTestId('camp-lit')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/camp-lit-820x1180.png` });
  await page.evaluate(() => (window as unknown as { __ow: Ow }).__ow.tapTile(6, 8));
  await expect(page.locator('.summary')).toBeVisible({ timeout: 25_000 });
  const logs = await page.evaluate((k) => JSON.parse(localStorage.getItem(`mathquest:v1:sessions:${k}`) ?? '[]'), KID);
  expect(logs.length).toBe(1);
  expect(logs[0].answered).toBeGreaterThanOrEqual(3);
  const world = await page.evaluate((k) => JSON.parse(localStorage.getItem(`mathquest:v1:world:${k}`) ?? 'null'), KID);
  expect(world).not.toBeNull();
});

test('holding the camp icon mid-trip quits and saves the answered cards', async ({ page }) => {
  const now = Date.now();
  await seed(page, { settings: { modes: { overworld: true } }, cards: dueCards(FACTS.groups![0]!.cardIds.slice(0, 10), now) });
  await openAdventure(page);
  const m = (await ow(page, (o) => o.state())).entities.find((e) => e.kind === 'monster' && e.shown)!;
  await clear(page, m.id);
  const house = page.locator('.hold-btn');
  const b = (await house.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1400);
  await page.mouse.up();
  await expect(page.locator('.summary')).toBeVisible({ timeout: 15_000 });
  const logs = await page.evaluate((k) => JSON.parse(localStorage.getItem(`mathquest:v1:sessions:${k}`) ?? '[]'), KID);
  expect(logs).toHaveLength(1);
  expect(logs[0].answered).toBe(1);
});

test('the boss: a ready lair is entered, the boss tile starts the fight, a win gives a key and 10 gems', async ({ page }) => {
  const now = Date.now();
  const ids = [...FACTS.groups![0]!.cardIds, ...FACTS.groups![1]!.cardIds];
  await seed(page, { settings: { modes: { overworld: true }, factGroupsUnlocked: 2, sessionSize: 4, maxNew: 0 }, cards: dueCards(ids, now, 5 * DAY) });
  await openAdventure(page);
  await page.evaluate(() => (window as unknown as { __ow: Ow }).__ow.teleport(33, 6));
  await page.evaluate(() => (window as unknown as { __ow: Ow }).__ow.tapTile(33, 4));
  await expect(page.getByTestId('lair-hud')).toBeVisible();
  // The boss stands in the far room; the doors are walked in the lair specs, so the hero is placed beside it here.
  await page.evaluate(() => (window as unknown as { __ow: Ow }).__ow.teleport(14, 2));
  await page.evaluate(() => (window as unknown as { __ow: Ow }).__ow.tapTile(14, 1));
  // 5 right answers win a fight of 6.
  for (let i = 0; i < 5; i++) {
    await expect(page.locator('.question-modal .keypad .key:not([disabled])').first()).toBeVisible({ timeout: 25_000 });
    const ans = await page.evaluate(() => (window as unknown as { __ow: Ow }).__ow.modalAnswer());
    await typeAnswer(page, ans!);
    if (i < 4) await expect(page.locator('.question-modal .key[disabled]').first()).toBeVisible(); // feedback, then the next question
    await page.waitForTimeout(1200);
  }
  await expect(page.getByTestId('boss-win')).toBeVisible();
  await page.getByTestId('boss-continue').click();
  await expect(page.getByTestId('ow-keys')).toContainText('1');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/boss-win-820x1180.png` });
  const gems = await page.evaluate((k) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!)[0].game.gems as number, KID);
  expect(gems).toBe(15);
});

test('the Dungeon still works with Adventure on', async ({ page }) => {
  const now = Date.now();
  await seed(page, { settings: { modes: { overworld: true } }, cards: dueCards(FACTS.groups![0]!.cardIds.slice(0, 10), now) });
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Ada' }).click();
  await page.locator('.mode-card[data-mode="dungeon"]').click();
  await expect(page.locator('.run .keypad')).toBeVisible();
  await expect(page.getByTestId('overworld')).toHaveCount(0);
});
