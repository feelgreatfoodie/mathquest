import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FACTS } from '../src/engine/modules/facts';
import { DEFAULT_SETTINGS } from '../src/engine/models';
import { LAIRS, MAPS, findTiles, heroStart, isWalkable, type RegionId } from '../src/game/overworld/maps';
import { ladderCards } from '../src/game/overworld/regions';

/**
 * Lairs: a walkable dungeon behind each boss door. Pip is a reader (times tables, keypad), Wren a pre-reader (add, subtract, make 10,
 * missing number; picture choices). Names and ids are made up. The dev hook window.__ow reads the plan and moves the boss clock.
 * LAIR_SHOTS=1 writes screenshots of each lair and fight to /Users/christianbourlier/_mainframe/apps/pause-shots-lair-g132/.
 */
const SHOTS = process.env.LAIR_SHOTS ? (process.env.LAIR_SHOTS_DIR ?? '/Users/christianbourlier/_mainframe/apps/pause-shots-lair-g132') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidlair00000000000001';
const DAY = 86_400_000;
const REGIONS: RegionId[] = ['meadow', 'forest', 'castle'];

const PIP = { modes: { overworld: true }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 4, maxNew: 0, factGroupsUnlocked: 5, paceMultiplier: 3 };
const WREN = {
  learner: 'prereader',
  modules: { add10: true, sub10: true, bonds10: true, missing10: true, facts: false },
  tracks: { facts: false, multidigit: false, fractions: false },
  sessionSize: 10,
  maxNew: 4,
  factGroupsUnlocked: 1,
  paceMultiplier: 3,
};
const PIP_CARDS = FACTS.groups!.flatMap((g) => g.cardIds);
const WREN_CARDS = [...new Set(ladderCards({ ...DEFAULT_SETTINGS, ...WREN, modules: { ...DEFAULT_SETTINGS.modules, ...WREN.modules } } as never))];

function cardsOf(now: number, ids: string[]) {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        id, attempts: 4, correct: 4, recentMs: [2500, 2600], lastRating: 3, updatedAt: now - 3 * DAY, day: '2000-01-01', dayGraded: 1, lastResults: [true, true],
        fsrs: { due: now + 5 * DAY, stability: 5, difficulty: 5, elapsed_days: 3, scheduled_days: 5, learning_steps: 0, reps: 3, lapses: 0, state: 2, last_review: now - 3 * DAY },
      },
    ]),
  );
}

type Who = 'Pip' | 'Wren';
const profile = (who: Who) => (who === 'Pip' ? { settings: PIP, ids: PIP_CARDS } : { settings: WREN, ids: WREN_CARDS });

const door = (r: RegionId) => findTiles(MAPS[r], 'boss')[0]!;
const bossTile = (r: RegionId) => findTiles(LAIRS[r].map, 'boss')[0]!;
/** A walkable tile beside the boss tile inside the lair. */
const bossSide = (r: RegionId) => {
  const b = bossTile(r);
  const map = LAIRS[r].map;
  return [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }].map((d) => ({ x: b.x + d.x, y: b.y + d.y })).find((p) => isWalkable(map, p.x, p.y, { gateOpen: false, hasKey: false, hasBridgeKit: false, roomsCleared: 9 }))!;
};
const exitTile = (r: RegionId) => findTiles(LAIRS[r].map, 'exit')[0]!;
const firstDoor = (r: RegionId) => findTiles(LAIRS[r].map, 'rdoor').find((p) => LAIRS[r].map.rows[p.y]![p.x] === '1')!;

async function seed(page: Page, who: Who, opts: { region?: RegionId; settings?: object; world?: object } = {}) {
  const region = opts.region ?? 'meadow';
  const d = door(region);
  const p = profile(who);
  await page.addInitScript(
    ({ kid, name, settings, cards, world }) => {
      const w = window as unknown as Record<string, unknown>;
      class Utter { text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      w.__spoken = [] as string[];
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
      let a = 99;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name, createdAt: 1, settings, game: { xp: 0, gems: 5, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
        localStorage.setItem(`mathquest:v1:cards:${kid}`, JSON.stringify(cards));
        localStorage.setItem(`mathquest:v1:world:${kid}`, JSON.stringify(world));
      }
    },
    {
      kid: KID,
      name: who,
      settings: { ...p.settings, ...opts.settings },
      cards: cardsOf(Date.now(), p.ids),
      world: { region, x: d.x, y: d.y + 1, facing: 'up', openedChests: [], bossesDefeated: [], keys: 0, version: 1, updatedAt: 1, ...opts.world },
    },
  );
}

type Ow = Record<string, (...a: never[]) => unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type St = any;
const ow = <T,>(page: Page, f: (o: any) => T) => page.evaluate((src) => new Function('o', `return (${src})(o)`)((window as unknown as { __ow: Ow }).__ow) as T, f.toString());
const state = (page: Page): Promise<St> => ow(page, (o) => o.state());
const gems = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!).find((x: { id: string }) => x.id === k).game.gems as number, KID);

async function openAdventure(page: Page, who: Who) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: who }).click();
  if (who === 'Wren') await page.getByRole('button', { name: 'Adventure' }).click();
  else await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
}

/** Taps the lair door in the overworld and waits for the lair. */
async function enterLair(page: Page, region: RegionId) {
  const d = door(region);
  await page.evaluate(([x, y]) => (window as unknown as { __ow: { tapTile(x: number, y: number): void } }).__ow.tapTile(x!, y!), [d.x, d.y]);
  await expect(page.getByTestId('lair-hud')).toBeVisible();
}

const tap = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as unknown as { __ow: { tapTile(x: number, y: number): void } }).__ow.tapTile(a!, b!), [x, y]);
const teleport = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as unknown as { __ow: { teleport(x: number, y: number): void } }).__ow.teleport(a!, b!), [x, y]);

async function typeAnswer(page: Page, n: number) {
  for (const d of String(n)) await page.locator('.question-modal .keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await page.locator('.question-modal .key-go').click();
}

/** One question of a reader, answered on the real keypad. A wrong one types the answer plus 1 and presses Got it. */
async function readerAnswer(page: Page, right = true) {
  const teach = page.getByRole('button', { name: 'Let me try one!' });
  if (await teach.isVisible()) await teach.click();
  await expect(page.locator('.question-modal .keypad .key:not([disabled])').first()).toBeVisible({ timeout: 25_000 });
  const ans = await page.evaluate(() => (window as unknown as { __ow: { modalAnswer(): number | null } }).__ow.modalAnswer());
  await typeAnswer(page, right ? ans! : ans! + 1);
  if (!right) await page.getByRole('button', { name: 'Got it' }).click({ timeout: 8000 }).catch(() => {});
}

/** One question of a pre-reader: tap the right picture, or a wrong one and then the highlighted right one. */
async function preAnswer(page: Page, right = true) {
  await expect(page.locator('.question-modal .choice').first()).toBeVisible({ timeout: 25_000 });
  if (right) await page.locator('.question-modal .choice[data-answer="true"]').click();
  else {
    await page.locator('.question-modal .choice[data-answer="false"]').first().click();
    await page.locator('.question-modal .choice.is-guide').click({ force: true });
  }
}
const answer = (page: Page, who: Who, right = true) => (who === 'Pip' ? readerAnswer(page, right) : preAnswer(page, right));

/** Answers the next question of the fight and waits until the game has counted it. */
async function fightStep(page: Page, who: Who, right: boolean) {
  const before = ((await state(page)).lair.fight?.answered ?? 0) as number;
  await answer(page, who, right);
  await expect.poll(async () => ((await state(page)).lair?.fight?.answered ?? before + 1) as number, { timeout: 20_000 }).toBeGreaterThan(before);
}

/** Starts the fight: the hero goes beside the boss (the rooms' doors are walked in another test) and taps it. */
async function startFight(page: Page, region: RegionId) {
  const s = bossSide(region);
  const b = bossTile(region);
  await teleport(page, s.x, s.y);
  await tap(page, b.x, b.y);
  await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
}

/** Answers and walks until every plain monster and guard of the room is done. */
async function clearRoom(page: Page, who: Who, room: number) {
  for (let guard = 0; guard < 40; guard++) {
    const s = await state(page);
    if (s.lair.cleared > room) return;
    const e = (s.entities as St[]).find((x) => x.room === room && x.kind === 'monster' && !x.trap && x.shown);
    if (!e) throw new Error(`no monster left in room ${room}`);
    await tap(page, e.x, e.y);
    await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
    await answer(page, who, true);
    await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 12_000 });
  }
  throw new Error('room not cleared');
}

test.use({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });

test.describe('reader (Pip)', () => {
  test.setTimeout(240_000);

  test('enter the Meadow lair, clear a room, the door opens, leave by the exit tile, come back to the same room', async ({ page }) => {
    await seed(page, 'Pip');
    await openAdventure(page, 'Pip');
    await enterLair(page, 'meadow');
    let s = await state(page);
    expect(s.lair).toMatchObject({ region: 'meadow', size: 24, bossItems: 6, cleared: 0, total: 30, answered: 0 });
    expect(s.lair.roomItems.reduce((a: number, b: number) => a + b, 0)).toBe(24);
    expect(s.lair.forms).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('lair-count')).toHaveText('Lair: 0 of 30');
    expect(s.hero).toEqual(heroStart(LAIRS.meadow.map));
    expect(s.world.x).toBe(door('meadow').x); // the saved place stays the overworld door
    // Monsters of the second room wait behind the door; the corridor past door 1 is shut.
    const d1 = firstDoor('meadow');
    const beyond = { x: LAIRS.meadow.rooms[1]!.x, y: d1.y };
    expect((s.entities as St[]).filter((e) => e.room === 1).every((e) => !e.shown)).toBe(true);
    await tap(page, beyond.x, beyond.y);
    await expect(page.getByTestId('ow-msg')).toContainText("can't walk there");
    await clearRoom(page, 'Pip', 0);
    s = await state(page);
    expect(s.lair.cleared).toBe(1);
    expect(s.lair.answered).toBeGreaterThanOrEqual(s.lair.roomItems[0] - 3);
    await expect(page.getByTestId('lair-count')).toContainText('Lair:');
    await tap(page, beyond.x, beyond.y);
    await expect.poll(async () => (await state(page)).hero).toEqual(beyond);
    await expect(page.getByTestId('lair-map').locator('[data-state="cleared"]')).toHaveCount(1);
    await expect(page.getByTestId('lair-map').locator('[data-state="here"]')).toHaveCount(1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/lair-pip-meadow-room2-820x1180.png` });
    // Leave: the exit tile returns the hero to the overworld beside the door and saves.
    const x = exitTile('meadow');
    // A chest or a riddle trap on the way opens too: answer it and walk on.
    for (let i = 0; i < 12 && (await state(page)).lair; i++) {
      await tap(page, x.x, x.y);
      await page.waitForTimeout(1500);
      if (await page.locator('.question-modal').isVisible()) {
        await readerAnswer(page, true);
        await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 12_000 });
      }
    }
    expect((await state(page)).lair).toBeNull();
    s = await state(page);
    expect(s.hero).toEqual({ x: door('meadow').x, y: door('meadow').y + 1 });
    expect(s.world).toMatchObject({ region: 'meadow', x: door('meadow').x, y: door('meadow').y + 1 });
    // Back in the same day: the same plan and the same cleared room.
    await enterLair(page, 'meadow');
    const again = await state(page);
    expect(again.lair).toMatchObject({ cleared: 1, size: 24 });
    expect(again.lair.done.length).toBeGreaterThan(0);
    expect((again.entities as St[]).filter((e) => e.room === 0 && e.kind === 'monster' && !e.trap)).toHaveLength(0);
  });

  test('the boss: the first win pays 10 gems, a key and the trophy once, a replay pays 3 and "Beaten N times" grows', async ({ page }) => {
    await seed(page, 'Pip');
    await openAdventure(page, 'Pip');
    await enterLair(page, 'meadow');
    const first = await state(page);
    await startFight(page, 'meadow');
    // The shared countdown: a bar and whole seconds above the question.
    const bar = page.getByTestId('boss-bar');
    await expect(bar).toBeVisible();
    const s0 = await state(page);
    expect(s0.lair.timerOn).toBe(true);
    expect(s0.lair.budgetMs).toBeGreaterThanOrEqual(30_000);
    expect(s0.lair.budgetMs).toBeLessThanOrEqual(90_000);
    test.info().annotations.push({ type: 'boss budget ms (Pip, normal)', description: String(s0.lair.budgetMs) });
    expect(Number(await bar.getAttribute('data-secs'))).toBeGreaterThan(Math.round(s0.lair.budgetMs / 1000) - 3);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/boss-pip-meadow-820x1180.png` });
    for (let i = 0; i < 5; i++) await fightStep(page, 'Pip', true);
    await expect(page.getByTestId('boss-win')).toBeVisible({ timeout: 15_000 });
    expect(await gems(page)).toBe(15);
    await page.getByTestId('boss-continue').click();
    let s = await state(page);
    expect(s.lair).toBeNull();
    expect(s.world.keys).toBe(1);
    expect(s.world.bossesDefeated).toEqual(['meadow']);
    await expect(page.getByTestId('lair-door')).toContainText('Beaten 1 time');
    // Replay: a fresh plan of 24, a win pays 3 gems and no second key.
    await enterLair(page, 'meadow');
    const again = await state(page);
    expect(again.lair.seq).toBeGreaterThan(first.lair.seq);
    expect(again.lair).toMatchObject({ size: 24, cleared: 0, answered: 0, bossDone: false });
    await startFight(page, 'meadow');
    for (let i = 0; i < 5; i++) await fightStep(page, 'Pip', true);
    await expect(page.getByTestId('boss-win')).toBeVisible({ timeout: 15_000 });
    expect(await gems(page)).toBe(18);
    await page.getByTestId('boss-continue').click();
    s = await state(page);
    expect(s.world.keys).toBe(1);
    await expect(page.getByTestId('lair-door')).toContainText('Beaten 2 times');
    // After a reload the count comes from the saved logs.
    await openAdventure(page, 'Pip');
    await expect(page.getByTestId('lair-door')).toContainText('Beaten 2 times');
  });

  test('the clock runs out: "The boss drove you out!", back at the entrance, a fresh plan of 12, nothing paid', async ({ page }) => {
    await seed(page, 'Pip', { region: 'forest' });
    await openAdventure(page, 'Pip');
    await enterLair(page, 'forest');
    await startFight(page, 'forest');
    await fightStep(page, 'Pip', true);
    await ow(page, (o) => o.fastForwardBoss(120_000));
    await expect(page.getByTestId('boss-lose')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('boss-lose')).toContainText('The boss drove you out!');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/boss-lose-pip-forest-820x1180.png` });
    await page.getByTestId('boss-continue').click();
    const s = await state(page);
    expect(s.hero).toEqual(heroStart(LAIRS.forest.map));
    expect(s.lair.size).toBe(12);
    expect(s.lair.roomItems.reduce((a: number, b: number) => a + b, 0)).toBe(12);
    expect(s.lair).toMatchObject({ cleared: 0, answered: 0, bossItems: 6 });
    expect(s.world.bossesDefeated).toEqual([]);
    expect(s.world.keys).toBe(0);
    expect(await gems(page)).toBe(5);
    // The answer given before the clock ran out was kept.
    const cards = await page.evaluate((k) => JSON.parse(localStorage.getItem(`mathquest:v1:cards:${k}`)!), KID);
    expect(Object.values(cards as Record<string, { attempts: number }>).some((c) => c.attempts > 4)).toBe(true);
  });

  test('2 wrong answers end the fight at 4 of 6 or less: it exits at once', async ({ page }) => {
    await seed(page, 'Pip', { region: 'castle' });
    await openAdventure(page, 'Pip');
    await enterLair(page, 'castle');
    await startFight(page, 'castle');
    await fightStep(page, 'Pip', true);
    await fightStep(page, 'Pip', false);
    await expect(page.getByTestId('boss-lose')).toHaveCount(0);
    await expect(page.locator('.question-modal')).toBeVisible();
    await fightStep(page, 'Pip', true);
    await fightStep(page, 'Pip', false);
    await expect(page.getByTestId('boss-lose')).toBeVisible({ timeout: 15_000 });
    const s = await state(page);
    expect(s.lair).toMatchObject({ size: 12, cleared: 0 });
    expect(s.hero).toEqual(heroStart(LAIRS.castle.map));
  });
});

test.describe('pre-reader (Wren)', () => {
  test.setTimeout(240_000);

  test('with the timer off there is no bar and no fail: six wrong answers still win, with 120 px picture choices and the voice', async ({ page }) => {
    await seed(page, 'Wren');
    await openAdventure(page, 'Wren');
    await enterLair(page, 'meadow');
    const s = await state(page);
    expect(s.lair).toMatchObject({ size: 18, bossItems: 6, forms: 0, total: 24, timerOn: false });
    await expect(page.getByTestId('lair-count')).toHaveText('Lair: 0 of 24');
    await startFight(page, 'meadow');
    await expect(page.getByTestId('boss-bar')).toHaveCount(0);
    const boxes = await page.locator('.question-modal .choice').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })));
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (const b of boxes) expect(Math.min(b.w, b.h)).toBeGreaterThanOrEqual(120);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/boss-wren-meadow-820x1180.png` });
    for (let i = 0; i < 6; i++) await fightStep(page, 'Wren', i % 2 === 1 ? false : true);
    await expect(page.getByTestId('boss-win')).toBeVisible({ timeout: 20_000 });
    expect(await gems(page)).toBe(15);
    expect(await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length)).toBeGreaterThan(0);
  });

  test('with the parent timer on there is a bar, a x2 budget, and 4 of 6 wins', async ({ page }) => {
    await seed(page, 'Wren', { settings: { bossTimerPre: true } });
    await openAdventure(page, 'Wren');
    await enterLair(page, 'meadow');
    expect((await state(page)).lair.timerOn).toBe(true);
    await startFight(page, 'meadow');
    await expect(page.getByTestId('boss-bar')).toBeVisible();
    const st = await state(page);
    test.info().annotations.push({ type: 'boss budget ms (Wren, timer on, normal)', description: String(st.lair.budgetMs) });
    expect(st.lair.budgetMs).toBeGreaterThanOrEqual(60_000);
    expect(st.lair.budgetMs).toBeLessThanOrEqual(180_000);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/boss-wren-timer-meadow-820x1180.png` });
    await fightStep(page, 'Wren', true);
    await fightStep(page, 'Wren', false);
    await fightStep(page, 'Wren', true);
    await fightStep(page, 'Wren', false);
    await fightStep(page, 'Wren', true);
    await fightStep(page, 'Wren', true);
    await expect(page.getByTestId('boss-win')).toBeVisible({ timeout: 20_000 });
  });
});

// Screenshots: every lair and a boss fight for both learners at 820x1180 and 1024x768.
const VIEWS = [{ w: 820, h: 1180 }, { w: 1024, h: 768 }];
for (const who of SHOTS ? (['Pip', 'Wren'] as Who[]) : []) {
  for (const region of REGIONS) {
    for (const v of VIEWS) {
      test(`shots: ${who} ${region} ${v.w}x${v.h}`, async ({ page }) => {
        await page.setViewportSize({ width: v.w, height: v.h });
        await seed(page, who, { region });
        await openAdventure(page, who);
        await page.waitForTimeout(300);
        // The door in the world, with its label once the lair has been beaten.
        await enterLair(page, region);
        await page.waitForTimeout(400);
        const tag = `${who.toLowerCase()}-${region}-${v.w}x${v.h}`;
        await page.screenshot({ path: `${SHOTS}/lair-${tag}.png` });
        // A second room, to show a cleared map: walk to the middle of room 2 with the doors open.
        const room = LAIRS[region].rooms[1]!;
        await teleport(page, room.x + 1, room.y + 1);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/lair-room2-${tag}.png` });
        await startFight(page, region);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/boss-${tag}.png` });
      });
    }
  }
}
