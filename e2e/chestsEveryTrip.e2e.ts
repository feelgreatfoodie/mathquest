import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FACTS } from '../src/engine/modules/facts';

/**
 * chests-every-trip at 820x1180: a player who has seen every fact still finds 3 to 5 chests in each land, an opened chest stays
 * open for the trip, a new trip refills them, and the key from a chest opens the Meadow door. Names and ids are made up.
 * SCREENSHOTS=1 writes one PNG per fixture under docs/screenshots/chests-every-trip, named after the fixture.
 */
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/chests-every-trip' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidce100000000000001';
const DAY = 86_400_000;
const SETTINGS = { modes: { overworld: true }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 8, maxNew: 4, factGroupsUnlocked: 5, paceMultiplier: 3 };

/** Every fact seen and not due for 9 days: no new card, no preview, nothing to review. */
function allSeen(now: number) {
  return Object.fromEntries(
    FACTS.cards.map((c) => [c.id, { id: c.id, attempts: 6, correct: 6, recentMs: [2000, 2100], lastRating: 3, updatedAt: now - DAY, day: '2000-01-01', dayGraded: 1, lastResults: [true, true], fsrs: { due: now + 9 * DAY, stability: 9, difficulty: 5, elapsed_days: 1, scheduled_days: 9, learning_steps: 0, reps: 4, lapses: 0, state: 2, last_review: now - DAY } }]),
  );
}

async function seed(page: Page, world: object = {}, tripId?: string) {
  const now = Date.now();
  await page.addInitScript(
    ({ kid, settings, cards, world, tripId }) => {
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
        localStorage.setItem(`mathquest:v1:world:${kid}`, JSON.stringify({ region: 'meadow', x: 3, y: 14, facing: 'right', openedChests: [], bossesDefeated: [], keys: 0, version: 1, updatedAt: 1, ...world }));
        // A stored open trip under 24 h old resumes, so its id, and with it the chest spots, is fixed.
        if (tripId) {
          const t = Date.now();
          const totals = { answered: 0, graded: 0, correct: 0, fast: 0, newLearned: 0, xp: 0, bestCombo: 0, medianMs: 0, missed: [] };
          localStorage.setItem(`mathquest:v1:trip:${kid}`, JSON.stringify({ tripId, startedAt: t, seq: 0, updatedAt: t, finished: false, totals, chests: { opened: [] } }));
        }
      }
    },
    { kid: KID, settings: SETTINGS, cards: allSeen(now), world, tripId: tripId ?? null },
  );
}

type Ent = { id: string; kind: string; x: number; y: number; shown: boolean; spotId?: string; key?: boolean };
type St = { region: string; hero: { x: number; y: number }; entities: Ent[]; world: { openedChests: string[]; keys: number }; trip: { tripId: string; opened: string[] } | null; spots: Array<{ id: string; key: boolean }>; lifetime: number };
const state = (page: Page) => page.evaluate(() => (window as unknown as { __ow: { state(): St } }).__ow.state());
const chestsOf = (s: St) => s.entities.filter((e) => e.kind === 'chest');

async function openAdventure(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Ada' }).click();
  await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
}

async function openChest(page: Page, e: Ent, shot?: string) {
  await page.evaluate(([x, y]) => (window as unknown as { __ow: { tapTile(x: number, y: number): void } }).__ow.tapTile(x!, y!), [e.x, e.y]);
  await expect(page.locator('.question-modal')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.question-modal .keypad .key:not([disabled])').first()).toBeVisible();
  await expect(page.getByTestId('riddle-story')).toBeVisible();
  if (SHOTS && shot) await page.screenshot({ path: `${SHOTS}/${shot}-820x1180.png` });
  const ans = await page.evaluate(() => (window as unknown as { __ow: { modalAnswer(): number } }).__ow.modalAnswer());
  for (const d of String(ans)) await page.locator('.question-modal .keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await page.locator('.question-modal .key-go').click();
  await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 8000 });
}

test.use({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });

test('all-seen-meadow: a player who has seen every fact finds 3 to 5 closed chests, with the count in the top bar', async ({ page }) => {
  await seed(page);
  await openAdventure(page);
  const s = await state(page);
  const n = chestsOf(s).length;
  expect(n).toBeGreaterThanOrEqual(3);
  expect(n).toBeLessThanOrEqual(5);
  expect(s.spots).toHaveLength(n);
  expect(s.spots.filter((x) => x.key)).toHaveLength(1);
  await expect(page.getByTestId('ow-chests')).toContainText(`0 of ${n}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/all-seen-meadow-820x1180.png` });
});

test('all-seen-forest and all-seen-castle: each land has its own 3 to 5 chests', async ({ page }) => {
  for (const region of ['forest', 'castle'] as const) {
    const p = await page.context().newPage();
    await seed(p, { region });
    await openAdventure(p);
    const n = chestsOf(await state(p)).length;
    expect(n, region).toBeGreaterThanOrEqual(3);
    expect(n, region).toBeLessThanOrEqual(5);
    await expect(p.getByTestId('ow-chests')).toContainText(`0 of ${n}`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/all-seen-${region}-820x1180.png` });
    await p.close();
  }
});

test('key chest: a riddle pays 1 or 2 gems and a key, stays open, survives a reopen, and the key opens the Meadow door; a new trip refills', async ({ page }) => {
  // Fixed trip id: a chest on the walk to the door would open its own question and stop the hero.
  await seed(page, {}, 'trip-key-chest');
  await openAdventure(page);
  const s0 = await state(page);
  const total = chestsOf(s0).length;
  const keyChest = chestsOf(s0).find((e) => e.key)!;
  expect(s0.world.keys).toBe(0);
  await openChest(page, keyChest, 'riddle-question');
  const gems = await page.evaluate((k) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!)[0].game.gems as number, KID);
  expect([6, 7]).toContain(gems);
  const s1 = await state(page);
  expect(s1.world.keys).toBe(1);
  expect(s1.lifetime).toBe(1);
  expect(s1.trip!.opened).toEqual([keyChest.spotId]);
  expect(chestsOf(s1)).toHaveLength(total - 1);
  await expect(page.getByTestId('ow-chests')).toContainText(`1 of ${total}`);
  await expect(page.getByTestId('ow-keys')).toContainText('1');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/all-seen-one-open-820x1180.png` });
  // The key opens the Meadow door at (20,23).
  await page.evaluate(() => (window as unknown as { __ow: { tapTile(x: number, y: number): void } }).__ow.tapTile(20, 23));
  await expect.poll(async () => (await state(page)).hero, { timeout: 40_000 }).toEqual({ x: 20, y: 23 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/key-door-open-820x1180.png` });
  // Leave and come back within the trip: the open chest stays open and pays nothing again.
  await page.reload();
  await page.locator('.kid-card', { hasText: 'Ada' }).click();
  await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
  const s2 = await state(page);
  expect(s2.trip!.tripId).toBe(s1.trip!.tripId);
  expect(s2.trip!.opened).toEqual([keyChest.spotId]);
  expect(chestsOf(s2).map((e) => e.spotId)).not.toContain(keyChest.spotId);
  await expect(page.getByTestId('ow-chests')).toContainText(`1 of ${total}`);
  // A new trip (the old one ended) refills every chest.
  await page.evaluate((k) => localStorage.removeItem(`mathquest:v1:trip:${k}`), KID);
  await page.reload();
  await page.locator('.kid-card', { hasText: 'Ada' }).click();
  await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
  const s3 = await state(page);
  expect(s3.trip!.tripId).not.toBe(s1.trip!.tripId);
  expect(s3.trip!.opened).toEqual([]);
  expect(chestsOf(s3).length).toBeGreaterThanOrEqual(3);
  expect(s3.lifetime).toBe(1);
});
