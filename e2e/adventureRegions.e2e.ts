import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * adventure-regions at 820x1180: the Meadow, the Forest and the Castle each look and lay out differently, and a world saved
 * before the redraw loads. Names and ids are made up. SCREENSHOTS=1 writes one PNG per fixture under
 * docs/screenshots/adventure-regions, named after the fixture.
 */
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/adventure-regions' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidar100000000000001';
const READER = { modes: { overworld: true }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 8, maxNew: 4, factGroupsUnlocked: 5, paceMultiplier: 3 };

type Fixture = { name: string; world: Record<string, unknown>; expectHero: { x: number; y: number } };
const world = (over: Record<string, unknown>) => ({ region: 'meadow', x: 3, y: 14, facing: 'right', openedChests: [], bossesDefeated: [], keys: 0, version: 1, updatedAt: 1, ...over });

/** The castle start is (3,14). The save at (6,8) was a camp tile in the old Castle; it is moat now. */
const FIXTURES: Fixture[] = [
  { name: 'meadow-start', world: world({}), expectHero: { x: 3, y: 14 } },
  { name: 'forest-start', world: world({ region: 'forest' }), expectHero: { x: 3, y: 14 } },
  { name: 'forest-trail-and-stream', world: world({ region: 'forest', x: 20, y: 10, facing: 'right' }), expectHero: { x: 20, y: 10 } },
  { name: 'castle-start', world: world({ region: 'castle' }), expectHero: { x: 3, y: 14 } },
  { name: 'castle-old-save-6-8', world: world({ region: 'castle', x: 6, y: 8, facing: 'left', openedChests: ['mul:6x7'], bossesDefeated: ['meadow'], keys: 1 }), expectHero: { x: 3, y: 14 } },
  { name: 'castle-courtyard', world: world({ region: 'castle', x: 20, y: 14 }), expectHero: { x: 20, y: 14 } },
];

async function seed(page: Page, w: object) {
  await page.addInitScript(
    ({ kid, settings, w }) => {
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
        localStorage.setItem(`mathquest:v1:world:${kid}`, JSON.stringify(w));
      }
    },
    { kid: KID, settings: READER, w },
  );
}

type Ow = { state(): { region: string; hero: { x: number; y: number }; world: { openedChests: string[]; keys: number; bossesDefeated: string[]; x: number; y: number } } };
const state = (page: Page) => page.evaluate(() => (window as unknown as { __ow: Ow }).__ow.state());

test.use({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });

for (const f of FIXTURES)
  test(`${f.name}: loads in the right region, the hero stands on a walkable tile, the rest of the save is kept`, async ({ page }) => {
    await seed(page, f.world);
    await page.goto('/');
    await page.locator('.kid-card', { hasText: 'Ada' }).click();
    await page.locator('.mode-card[data-mode="overworld"]').click();
    await expect(page.getByTestId('overworld')).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
    await page.waitForTimeout(500);
    const s = await state(page);
    expect(s.region).toBe(f.world.region);
    expect(s.hero).toEqual(f.expectHero);
    expect(s.world.openedChests).toEqual(f.world.openedChests);
    expect(s.world.keys).toBe(f.world.keys);
    expect(s.world.bossesDefeated).toEqual(f.world.bossesDefeated);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${f.name}-820x1180.png` });
  });
