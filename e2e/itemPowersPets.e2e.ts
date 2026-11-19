import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FACTS } from '../src/engine/modules/facts';
import { DEFAULT_SETTINGS } from '../src/engine/models';
import { chestCountFor } from '../src/game/overworld/chests';
import { MAPS, findTiles, heroStart, type RegionId } from '../src/game/overworld/maps';
import { ladderCards } from '../src/game/overworld/regions';

/**
 * Item powers, pets PR. Pip is a reader (times tables, keypad), Wren a pre-reader (picture choices). Names and ids are made up.
 * The Dog hides one bonus chest, the Beetle digs one gem a trip, the Owl rings the lair door, the Pup plays an animation. No pet adds
 * a chest or a question, and a pet that is owned but not equipped does nothing.
 * ITEM_SHOTS=1 writes screenshots to /Users/christianbourlier/_mainframe/apps/item-powers-shots-g138/ (fixture names in the file names).
 */
const SHOTS = process.env.ITEM_SHOTS ? (process.env.ITEM_SHOTS_DIR ?? '/Users/christianbourlier/_mainframe/apps/item-powers-shots-g138') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidpets000000000000001';
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

async function seed(page: Page, who: Who, items: string[], pet?: string, region: RegionId = 'meadow') {
  const p = profile(who);
  const s = heroStart(MAPS[region]);
  await page.addInitScript(
    ({ kid, name, settings, cards, world, items, pet }) => {
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
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name, createdAt: 1, settings, game: { xp: 0, gems: 5, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight', items, ...(pet ? { equipped: { pet } } : {}) } }]));
        localStorage.setItem(`mathquest:v1:cards:${kid}`, JSON.stringify(cards));
        localStorage.setItem(`mathquest:v1:world:${kid}`, JSON.stringify(world));
      }
    },
    { kid: KID, name: who, settings: p.settings, cards: cardsOf(Date.now(), p.ids), world: { region, x: s.x, y: s.y, facing: 'right', openedChests: [], bossesDefeated: [], keys: 0, version: 1, updatedAt: 1 }, items, pet },
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

      test('a pet that is owned but not equipped does nothing', async ({ page }) => {
        await seed(page, who, ['p-dog', 'p-beetle', 'p-owl', 'p-pup']);
        await openAdventure(page, who);
        const s = await state(page);
        expect(s.pet).toBeNull();
        expect(s.mound).toBeNull();
        expect(s.entities.some((e: St) => e.dog)).toBe(false);
        expect(s.spots.some((x: St) => x.power)).toBe(false);
        expect(s.spots).toHaveLength(chestCountFor(s.trip.tripId, 'meadow', who === 'Wren'));
      });

      test('Beetle: one dig a trip, 1 gem, and a second walk over the tile pays nothing', async ({ page }) => {
        await seed(page, who, ['p-beetle'], 'p-beetle');
        await openAdventure(page, who);
        const s = await state(page);
        expect(s.pet).toBe('beetle');
        expect(s.mound).toBeTruthy();
        expect(s.spots).toHaveLength(chestCountFor(s.trip.tripId, 'meadow', who === 'Wren'));
        await shot(page, who, vp, 'beetle-mound');
        const m = s.mound;
        const before = await gems(page);
        await teleport(page, m.x, m.y - 2);
        await tap(page, m.x, m.y);
        await expect.poll(() => gems(page), { timeout: 15_000 }).toBe(before + 1);
        await shot(page, who, vp, 'beetle-dug');
        expect((await state(page)).mound).toBeNull();
        await teleport(page, m.x, m.y - 2);
        await tap(page, m.x, m.y);
        await page.waitForTimeout(1200);
        expect(await gems(page)).toBe(before + 1);
      });

      test('Dog: the bonus chest stands out of sight, shows near the hero, and pays through the usual question', async ({ page }) => {
        await seed(page, who, ['p-dog'], 'p-dog');
        await openAdventure(page, who);
        const s = await state(page);
        expect(s.pet).toBe('dog');
        expect(s.spots).toHaveLength(chestCountFor(s.trip.tripId, 'meadow', who === 'Wren'));
        const spot = s.spots.find((x: St) => x.power === 'dog');
        expect(spot).toBeTruthy();
        const ent = s.entities.find((e: St) => e.spotId === spot.id);
        expect(ent.shown).toBe(false);
        await teleport(page, spot.x, spot.y - 6);
        await page.waitForTimeout(400);
        expect((await state(page)).entities.find((e: St) => e.spotId === spot.id).shown).toBe(false);
        await teleport(page, spot.x, spot.y - 3);
        await expect.poll(async () => (await state(page)).entities.find((e: St) => e.spotId === spot.id).shown, { timeout: 5000 }).toBe(true);
        await shot(page, who, vp, 'dog-found');
        const before = await gems(page);
        await tap(page, spot.x, spot.y);
        await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
        await answer(page, who);
        await expect.poll(async () => (await state(page)).trip.opened, { timeout: 15_000 }).toContain(spot.id);
        await expect.poll(() => gems(page), { timeout: 15_000 }).toBeGreaterThan(before);
        await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 12_000 });
      });

      for (const [item, name] of [['p-owl', 'owl-ring'], ['p-pup', 'pup-fire']] as const) {
        test(`${name}: the ${item === 'p-owl' ? 'ring' : 'animation'} draws and nothing about the trip changes`, async ({ page }) => {
          await seed(page, who, [item], item);
          await openAdventure(page, who);
          const s = await state(page);
          expect(s.pet).toBe(item === 'p-owl' ? 'owl' : 'pup');
          expect(s.spots).toHaveLength(chestCountFor(s.trip.tripId, 'meadow', who === 'Wren'));
          expect(s.mound).toBeNull();
          expect(s.entities.some((e: St) => e.dog)).toBe(false);
          if (item === 'p-owl') {
            const boss = findTiles(MAPS.meadow, 'boss')[0]!;
            await teleport(page, boss.x - 2, boss.y);
          } else await page.evaluate(() => (window as unknown as { __ow: { playPupFx(k: string): void } }).__ow.playPupFx('fire'));
          await page.waitForTimeout(300);
          await shot(page, who, vp, name);
        });
      }
    });
  }
}
