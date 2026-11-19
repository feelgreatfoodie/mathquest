import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FACTS } from '../src/engine/modules/facts';
import { DEFAULT_SETTINGS } from '../src/engine/models';
import { canPlaceAt } from '../src/game/overworld/camp';
import { MAPS, findTiles, heroStart } from '../src/game/overworld/maps';
import { ladderCards } from '../src/game/overworld/regions';

/**
 * Camp: the kid marks and decorates the map. A tent, up to 3 flags in each land, a camp button in the Adventure HUD. Pip is a reader
 * (times tables), Wren a pre-reader (picture questions, no sentences). Names and ids are made up. The camp lives in its own save (the
 * local mirror of world/camp), never in the world save. CAMP_SHOTS=1 writes screenshots to /Users/christianbourlier/_mainframe/apps/pause-shots-camp-g135/.
 */
const SHOTS = process.env.CAMP_SHOTS ? (process.env.CAMP_SHOTS_DIR ?? '/Users/christianbourlier/_mainframe/apps/pause-shots-camp-g135') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidcamp00000000000001';
const DAY = 86_400_000;
const SIZES = [
  { name: '820x1180', width: 820, height: 1180 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '393x852', width: 393, height: 852 },
];

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

async function seed(page: Page, who: Who, world: object = {}) {
  const p = profile(who);
  const s = heroStart(MAPS.meadow);
  await page.addInitScript(
    ({ kid, name, settings, cards, w }) => {
      const win = window as unknown as Record<string, unknown>;
      class Utter { text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      win.SpeechSynthesisUtterance = Utter;
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
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name, createdAt: 1, settings, game: { xp: 0, gems: 5, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } }]));
        localStorage.setItem(`mathquest:v1:cards:${kid}`, JSON.stringify(cards));
        localStorage.setItem(`mathquest:v1:world:${kid}`, JSON.stringify(w));
      }
    },
    { kid: KID, name: who, settings: p.settings, cards: cardsOf(Date.now(), p.ids), w: { region: 'meadow', x: s.x, y: s.y, facing: 'down', openedChests: [], bossesDefeated: [], keys: 0, version: 1, updatedAt: 1, ...world } },
  );
}

type St = { hero: { x: number; y: number }; camp: { placed: Array<{ region: string; kind: string; x: number; y: number }> }; lair: unknown; world: Record<string, unknown> };
const state = (page: Page): Promise<St> => page.evaluate(() => (window as unknown as { __ow: { state(): unknown } }).__ow.state()) as Promise<St>;
const clientOf = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as unknown as { __ow: { clientOf(x: number, y: number): { x: number; y: number } } }).__ow.clientOf(a!, b!), [x, y]);

async function openAdventure(page: Page, who: Who) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: who }).click();
  if (who === 'Wren') await page.getByRole('button', { name: 'Adventure' }).click();
  else await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
}

/** A grass tile near the hero where a tap lands on the map (not under the pad, the tray or the HUD), nearest first, above the hero first. */
async function openTile(page: Page, taken: Array<{ x: number; y: number }> = []): Promise<{ x: number; y: number }> {
  const h = (await state(page)).hero;
  const map = MAPS.meadow;
  const cands: Array<{ x: number; y: number; d: number }> = [];
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      if (!canPlaceAt(map, x, y) || taken.some((t) => t.x === x && t.y === y)) continue;
      const dx = x - h.x;
      const dy = y - h.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 4) continue;
      cands.push({ x, y, d: Math.abs(dx) + Math.abs(dy) + (dy > 0 ? 3 : 0) });
    }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    const p = await clientOf(page, c.x, c.y);
    const onMap = await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.classList.contains('ow-canvas') ?? false, [p.x, p.y]);
    if (onMap) return { x: c.x, y: c.y };
  }
  throw new Error('no open grass tile in view');
}

async function clickTile(page: Page, t: { x: number; y: number }) {
  const p = await clientOf(page, t.x, t.y);
  await page.mouse.click(p.x, p.y);
}

for (const who of ['Pip', 'Wren'] as const)
  for (const size of SIZES)
    test(`${who} at ${size.name}: place a tent and a flag, reload keeps them, the camp button`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await seed(page, who);
      await openAdventure(page, who);

      // The camp button sits in the HUD, fully on screen, and opens the tray.
      const btn = page.getByTestId('camp-btn');
      await expect(btn).toBeVisible();
      const box = (await btn.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      if (who === 'Wren') expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(100);
      await expect(page.getByTestId('camp-tray')).toHaveCount(0);
      await btn.click();
      await expect(page.getByTestId('camp-tray')).toBeVisible();
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      const tray = (await page.getByTestId('camp-tray').boundingBox())!;
      expect(tray.x).toBeGreaterThanOrEqual(0);
      expect(tray.x + tray.width).toBeLessThanOrEqual(size.width);
      if (who === 'Wren') await expect(page.getByTestId('camp-tray')).not.toContainText(/[A-Za-z]/);

      // Place the tent.
      const worldBefore = await page.evaluate((k) => localStorage.getItem(`mathquest:v1:world:${k}`), KID);
      await page.getByTestId('camp-tent').click();
      const t = await openTile(page);
      await clickTile(page, t);
      await expect.poll(async () => (await state(page)).camp.placed.length).toBe(1);
      expect((await state(page)).camp.placed[0]).toEqual({ region: 'meadow', kind: 'tent', x: t.x, y: t.y });
      // The hero did not walk to the tapped tile.
      expect((await state(page)).hero).toEqual(heroStart(MAPS.meadow));

      // Place a flag on another tile.
      await page.getByTestId('camp-flag').click();
      const f = await openTile(page, [t]);
      await clickTile(page, f);
      await expect.poll(async () => (await state(page)).camp.placed.length).toBe(2);
      const placed = (await state(page)).camp.placed;
      expect(placed).toEqual([{ region: 'meadow', kind: 'tent', x: t.x, y: t.y }, { region: 'meadow', kind: 'flag', x: f.x, y: f.y }]);

      // Stored in the camp save only: the world save is byte for byte what it was, and has no placed field.
      const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(`mathquest:v1:camp:${k}`) ?? 'null'), KID);
      expect(stored.placed).toEqual(placed);
      expect(Object.keys(stored).sort()).toEqual(['placed', 'updatedAt', 'version']);
      const worldNow = await page.evaluate((k) => localStorage.getItem(`mathquest:v1:world:${k}`), KID);
      expect(JSON.parse(worldNow!)).not.toHaveProperty('placed');
      expect(Object.keys(JSON.parse(worldNow!)).length).toBeLessThanOrEqual(10);
      expect(worldNow).toBe(worldBefore);

      // A tile that is not plain grass takes nothing (the camp fire tile, a path tile, the hero start).
      const bad = findTiles(MAPS.meadow, 'path').find((p) => Math.abs(p.x - t.x) < 6 && Math.abs(p.y - t.y) < 4) ?? findTiles(MAPS.meadow, 'path')[0]!;
      await page.evaluate(([x, y]) => (window as unknown as { __ow: { teleport(x: number, y: number): void } }).__ow.teleport(x!, y!), [bad.x, bad.y]);
      await clickTile(page, bad);
      expect((await state(page)).camp.placed).toHaveLength(2);

      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${who}-${size.name}-tray.png` });
      if (who === 'Pip') await page.getByTestId('camp-done').click();
      else await page.getByTestId('camp-btn').click();
      await expect(page.getByTestId('camp-tray')).toHaveCount(0);
      await page.evaluate(([x, y]) => (window as unknown as { __ow: { teleport(x: number, y: number): void } }).__ow.teleport(x!, y!), [t.x, t.y + 1]);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${who}-${size.name}-placed.png` });

      // A reload keeps them.
      await page.reload();
      await openAdventure(page, who);
      await expect.poll(async () => (await state(page)).camp.placed).toEqual(placed);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${who}-${size.name}-reloaded.png` });
    });

test('Pip: a 4th flag in a land is refused, picking up frees a flag, a second tent moves the first', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await seed(page, 'Pip');
  await openAdventure(page, 'Pip');
  await page.getByTestId('camp-btn').click();
  await page.getByTestId('camp-flag').click();
  const taken: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 3; i++) {
    const t = await openTile(page, taken);
    taken.push(t);
    await clickTile(page, t);
    await expect.poll(async () => (await state(page)).camp.placed.length).toBe(i + 1);
  }
  const fourth = await openTile(page, taken);
  await clickTile(page, fourth);
  await expect(page.getByTestId('ow-msg')).toContainText('3 flags');
  expect((await state(page)).camp.placed).toHaveLength(3);
  // Pick one up: the tray's pick up tool, then a tap on it.
  await page.getByTestId('camp-pick').click();
  await clickTile(page, taken[0]!);
  await expect.poll(async () => (await state(page)).camp.placed.length).toBe(2);
  await page.getByTestId('camp-flag').click();
  await clickTile(page, fourth);
  await expect.poll(async () => (await state(page)).camp.placed.length).toBe(3);
  // A second tent moves the first.
  await page.getByTestId('camp-tent').click();
  const a = await openTile(page, [...taken, fourth]);
  await clickTile(page, a);
  await expect.poll(async () => (await state(page)).camp.placed.filter((p) => p.kind === 'tent').length).toBe(1);
  const b = await openTile(page, [...taken, fourth, a]);
  await clickTile(page, b);
  await expect.poll(async () => (await state(page)).camp.placed.find((p) => p.kind === 'tent')).toEqual({ region: 'meadow', kind: 'tent', x: b.x, y: b.y });
  expect((await state(page)).camp.placed.filter((p) => p.kind === 'tent')).toHaveLength(1);
});

test('Pip: placing is overworld only. Inside a lair there is no camp button and the world save is not written', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const door = findTiles(MAPS.meadow, 'boss')[0]!;
  await seed(page, 'Pip', { x: door.x, y: door.y + 1, facing: 'up' });
  await openAdventure(page, 'Pip');
  await page.getByTestId('camp-btn').click();
  await expect(page.getByTestId('camp-tray')).toBeVisible();
  await page.evaluate(([x, y]) => (window as unknown as { __ow: { tapTile(x: number, y: number): void } }).__ow.tapTile(x!, y!), [door.x, door.y]);
  await expect(page.getByTestId('lair-hud')).toBeVisible();
  await expect(page.getByTestId('camp-btn')).toHaveCount(0);
  await expect(page.getByTestId('camp-tray')).toHaveCount(0);
  const before = await page.evaluate((k) => localStorage.getItem(`mathquest:v1:world:${k}`), KID);
  const p = await clientOf(page, (await state(page)).hero.x, (await state(page)).hero.y);
  await page.mouse.click(p.x + 40, p.y);
  expect((await state(page)).camp.placed).toHaveLength(0);
  expect(await page.evaluate((k) => localStorage.getItem(`mathquest:v1:world:${k}`), KID)).toBe(before);
  expect(await page.evaluate((k) => localStorage.getItem(`mathquest:v1:camp:${k}`), KID)).toBeNull();
});

test('Pip: a new trip in a land starts at that land’s tent, and a trip being resumed keeps its place', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await seed(page, 'Pip');
  await openAdventure(page, 'Pip');
  await page.getByTestId('camp-btn').click();
  await page.getByTestId('camp-tent').click();
  const t = await openTile(page);
  await clickTile(page, t);
  await expect.poll(async () => (await state(page)).camp.placed.length).toBe(1);
  await page.getByTestId('camp-btn').click();
  // The saved place is 3 tiles from the start. Reload with the same trip: the hero stays where it was saved.
  const away = { x: heroStart(MAPS.meadow).x + 3, y: heroStart(MAPS.meadow).y };
  await page.evaluate(([k, x, y]) => {
    const key = `mathquest:v1:world:${k}`;
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)!), x, y }));
  }, [KID, away.x, away.y] as const);
  await page.reload();
  await openAdventure(page, 'Pip');
  await expect.poll(async () => (await state(page)).camp.placed.length).toBe(1);
  expect((await state(page)).hero).toEqual(away);
  // A new trip (the old one is gone) starts at the tent.
  await page.evaluate((k) => localStorage.removeItem(`mathquest:v1:trip:${k}`), KID);
  await page.reload();
  await openAdventure(page, 'Pip');
  await expect.poll(async () => (await state(page)).hero).toEqual({ x: t.x, y: t.y });
});
