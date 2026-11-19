import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FACTS } from '../src/engine/modules/facts';
import { DEFAULT_SETTINGS } from '../src/engine/models';
import { chestCountFor, tripChestSpots } from '../src/game/overworld/chests';
import { MAPS, findTiles, heroStart, type RegionId } from '../src/game/overworld/maps';
import { ladderCards } from '../src/game/overworld/regions';

/**
 * Item powers, map PR. Pip is a reader (times tables, keypad), Wren a pre-reader (picture choices). Names and ids are made up.
 * The Key opens a side room with a chest, the Bridge Kit reaches an island chest, Fast Boots only walk faster. No power adds a chest
 * or a question: the trip holds the same number of chests with and without the items.
 * ITEM_SHOTS=1 writes screenshots to /Users/christianbourlier/_mainframe/apps/item-powers-shots-g136/ (fixture names in the file names).
 */
const SHOTS = process.env.ITEM_SHOTS ? (process.env.ITEM_SHOTS_DIR ?? '/Users/christianbourlier/_mainframe/apps/item-powers-shots-g136') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidpower00000000000001';
const DAY = 86_400_000;
const VIEWPORTS = [{ w: 820, h: 1180 }, { w: 1024, h: 768 }, { w: 393, h: 852 }];

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
type Who = 'Pip' | 'Wren';
const profile = (who: Who) => (who === 'Pip' ? { settings: PIP, ids: PIP_CARDS } : { settings: WREN, ids: WREN_CARDS });

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

async function seed(page: Page, who: Who, items: string[], region: RegionId = 'meadow') {
  const p = profile(who);
  const s = heroStart(MAPS[region]);
  await page.addInitScript(
    ({ kid, name, settings, cards, world, items }) => {
      const w = window as unknown as Record<string, unknown>;
      class Utter { text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
      let a = 99;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      if (!localStorage.getItem('mathquest:v1:kids')) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name, createdAt: 1, settings, game: { xp: 0, gems: 5, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight', items } }]));
        localStorage.setItem(`mathquest:v1:cards:${kid}`, JSON.stringify(cards));
        localStorage.setItem(`mathquest:v1:world:${kid}`, JSON.stringify(world));
      }
    },
    { kid: KID, name: who, settings: p.settings, cards: cardsOf(Date.now(), p.ids), world: { region, x: s.x, y: s.y, facing: 'right', openedChests: [], bossesDefeated: [], keys: 0, version: 1, updatedAt: 1 }, items },
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type St = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ow = <T,>(page: Page, f: (o: any) => T) => page.evaluate((src) => new Function('o', `return (${src})(o)`)((window as unknown as { __ow: Record<string, unknown> }).__ow) as T, f.toString());
const state = (page: Page): Promise<St> => ow(page, (o) => o.state());
const gems = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!).find((x: { id: string }) => x.id === k).game.gems as number, KID);
const tap = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as unknown as { __ow: { tapTile(x: number, y: number): void } }).__ow.tapTile(a!, b!), [x, y]);
const teleport = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as unknown as { __ow: { teleport(x: number, y: number): void } }).__ow.teleport(a!, b!), [x, y]);

async function openAdventure(page: Page, who: Who) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: who }).click();
  if (who === 'Wren') await page.getByRole('button', { name: 'Adventure' }).click();
  else await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
}

async function answer(page: Page, who: Who) {
  if (who === 'Pip') {
    const teach = page.getByRole('button', { name: 'Let me try one!' });
    if (await teach.isVisible()) await teach.click();
    await expect(page.locator('.question-modal .keypad .key:not([disabled])').first()).toBeVisible({ timeout: 25_000 });
    const ans = await page.evaluate(() => (window as unknown as { __ow: { modalAnswer(): number | null } }).__ow.modalAnswer());
    for (const d of String(ans)) await page.locator('.question-modal .keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
    await page.locator('.question-modal .key-go').click();
  } else {
    await expect(page.locator('.question-modal .choice').first()).toBeVisible({ timeout: 25_000 });
    await page.locator('.question-modal .choice[data-answer="true"]').click();
  }
}

const shot = async (page: Page, who: Who, vp: { w: number; h: number }, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${who}-${vp.w}x${vp.h}-${name}.png` });
};

for (const vp of VIEWPORTS) {
  for (const who of ['Pip', 'Wren'] as const) {
    test.describe(`${who} at ${vp.w}x${vp.h}`, () => {
      test.use({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });

      test('with no item the trip has no power chest and the key door and the spans stay shut', async ({ page }) => {
        await seed(page, who, []);
        await openAdventure(page, who);
        const s = await state(page);
        expect(s.spots.some((x: St) => x.power)).toBe(false);
        expect(s.spots).toHaveLength(chestCountFor(s.trip.tripId, 'meadow', who === 'Wren'));
        const door = findTiles(MAPS.meadow, 'door').find((d) => d.x === 35)!;
        await teleport(page, door.x, door.y - 1);
        await tap(page, door.x, door.y);
        await page.waitForTimeout(600);
        const after = await state(page);
        expect(after.hero.y).toBeLessThan(door.y);
        const span = findTiles(MAPS.meadow, 'span')[0]!;
        await teleport(page, span.x - 1, span.y);
        await tap(page, span.x, span.y);
        await page.waitForTimeout(600);
        expect((await state(page)).hero.x).toBeLessThan(span.x);
      });

      test('with the key and the bridge kit: the same number of chests, 1 in the key room and 1 on the island, and the key room chest opens and pays', async ({ page }) => {
        await seed(page, who, ['a-key', 'a-bridge', 'a-boots']);
        await openAdventure(page, who);
        const s = await state(page);
        const base = tripChestSpots(s.trip.tripId, 'meadow', who === 'Wren');
        expect(s.spots).toHaveLength(base.length);
        const keySpot = s.spots.find((x: St) => x.power === 'key');
        const bridgeSpot = s.spots.find((x: St) => x.power === 'bridge');
        expect(keySpot && bridgeSpot).toBeTruthy();
        await shot(page, who, vp, 'meadow-start');
        // The key room: the hero walks through the door and the chest asks its question.
        const before = await gems(page);
        await teleport(page, keySpot.x, keySpot.y - 3);
        await tap(page, keySpot.x, keySpot.y);
        await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
        await shot(page, who, vp, 'key-room-question');
        await answer(page, who);
        await expect.poll(async () => (await state(page)).trip.opened, { timeout: 15_000 }).toContain(keySpot.id);
        await expect.poll(() => gems(page), { timeout: 15_000 }).toBeGreaterThan(before);
        // The island: across the spans.
        await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 12_000 });
        const before2 = await gems(page);
        await teleport(page, bridgeSpot.x - 3, bridgeSpot.y);
        await tap(page, bridgeSpot.x, bridgeSpot.y);
        await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
        await shot(page, who, vp, 'island-question');
        await answer(page, who);
        await expect.poll(async () => (await state(page)).trip.opened, { timeout: 15_000 }).toContain(bridgeSpot.id);
        await expect.poll(() => gems(page), { timeout: 15_000 }).toBeGreaterThan(before2);
        await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 12_000 });
        await shot(page, who, vp, 'island-opened');
      });
    });
  }
}
