import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FACTS } from '../src/engine/modules/facts';
import { DEFAULT_SETTINGS } from '../src/engine/models';
import { reachableWithoutItems } from '../src/game/overworld/chests';
import { LAIRS, MAPS, findTiles, heroStart, type RegionId } from '../src/game/overworld/maps';
import { clearShot } from '../src/game/overworld/weapons';
import { ladderCards } from '../src/game/overworld/regions';

/**
 * Item powers, weapons and looks PR. Pip is a reader (times tables, keypad), Wren a pre-reader (picture choices). Names and ids are made up.
 * The Bow starts a fight from up to 3 tiles away, the Boomerang does it after 5 right answers in a row, worn items show on the hero, the legendary
 * items glow and give a title, and the Dino Hood roars on a boss win. Nothing here changes a question or its grade.
 * ITEM_SHOTS=1 writes screenshots to /Users/christianbourlier/_mainframe/apps/item-powers-shots-g179/ (fixture names in the file names).
 */
const SHOTS = process.env.ITEM_SHOTS ? (process.env.ITEM_SHOTS_DIR ?? '/Users/christianbourlier/_mainframe/apps/item-powers-shots-g179') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidlooks00000000000001';
const DAY = 86_400_000;
const VIEWPORTS = [{ w: 820, h: 1180 }, { w: 1024, h: 768 }, { w: 393, h: 852 }];

const PIP = { modes: { overworld: true }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 14, maxNew: 0, factGroupsUnlocked: 5, paceMultiplier: 3 };
const WREN = {
  learner: 'prereader',
  modules: { add10: true, sub10: true, bonds10: true, missing10: true, facts: false },
  tracks: { facts: false, multidigit: false, fractions: false },
  sessionSize: 14,
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

async function seed(page: Page, who: Who, items: string[], equipped: Record<string, string> = {}, opts: { lair?: boolean } = {}) {
  const p = profile(who);
  const s = opts.lair ? { x: findTiles(MAPS.meadow, 'boss')[0]!.x, y: findTiles(MAPS.meadow, 'boss')[0]!.y + 1 } : heroStart(MAPS.meadow);
  await page.addInitScript(
    ({ kid, name, settings, cards, world, items, equipped }) => {
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
        localStorage.setItem('mathquest:v1:kids', JSON.stringify([{ id: kid, name, createdAt: 1, settings, game: { xp: 0, gems: 5, streakDays: 2, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight', items, equipped } }]));
        localStorage.setItem(`mathquest:v1:cards:${kid}`, JSON.stringify(cards));
        localStorage.setItem(`mathquest:v1:world:${kid}`, JSON.stringify(world));
      }
    },
    { kid: KID, name: who, settings: p.settings, cards: cardsOf(Date.now(), p.ids), world: { region: 'meadow', x: s.x, y: s.y, facing: opts.lair ? 'up' : 'right', openedChests: [], bossesDefeated: [], keys: 0, version: 1, updatedAt: 1 }, items, equipped },
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type St = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ow = <T,>(page: Page, f: (o: any) => T) => page.evaluate((src) => new Function('o', `return (${src})(o)`)((window as unknown as { __ow: Record<string, unknown> }).__ow) as T, f.toString());
const state = (page: Page): Promise<St> => ow(page, (o) => o.state());
const tapTile = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as unknown as { __ow: { tapTile(x: number, y: number): void } }).__ow.tapTile(a!, b!), [x, y]);
const teleport = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as unknown as { __ow: { teleport(x: number, y: number): void } }).__ow.teleport(a!, b!), [x, y]);
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
const clientOf = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as unknown as { __ow: { clientOf(x: number, y: number): { x: number; y: number } } }).__ow.clientOf(a!, b!), [x, y]);

async function toHome(page: Page, who: Who) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: who }).click();
}
async function openAdventure(page: Page, who: Who) {
  await toHome(page, who);
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

/** Tiles the hero reaches with no item, `d` tiles from the spot by Manhattan distance, on no entity, with a clear line to the spot. */
function standList(spot: { x: number; y: number }, d: number, taken: { x: number; y: number }[] = []) {
  const reach = reachableWithoutItems(MAPS.meadow);
  const all = [...reach].map((k) => k.split(',').map(Number) as [number, number]);
  return all
    .filter(([x, y]) => Math.abs(x - spot.x) + Math.abs(y - spot.y) === d && !taken.some((t) => t.x === x && t.y === y) && clearShot(MAPS.meadow, { x, y }, spot))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .map(([x, y]) => ({ x, y }));
}

/** A stand tile at `d` tiles from the spot with the canvas, not a button, under the spot's center. Teleports there. */
async function standWhereVisible(page: Page, spot: { x: number; y: number }, d: number, taken: { x: number; y: number }[]) {
  for (const at of standList(spot, d, taken)) {
    await teleport(page, at.x, at.y);
    await page.waitForTimeout(80);
    const c = await clientOf(page, spot.x, spot.y);
    const tag = await page.evaluate(([x, y]) => (document.elementFromPoint(x!, y!) as HTMLElement | null)?.tagName ?? '', [c.x, c.y]);
    if (tag === 'CANVAS') return { at, c };
  }
  throw new Error(`no visible stand tile at ${d} from ${spot.x},${spot.y}`);
}

const shot = async (page: Page, who: Who, vp: { w: number; h: number }, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${who}-${vp.w}x${vp.h}-${name}.png` });
};

/** The shown monsters of the land, not on the hero. */
const monsters = (s: St) => (s.entities as St[]).filter((e) => e.kind === 'monster' && e.shown);

for (const vp of VIEWPORTS) {
  for (const who of ['Pip', 'Wren'] as const) {
    test.describe(`${who} at ${vp.w}x${vp.h}`, () => {
      test.use({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      test.setTimeout(240_000);

      test('Bow: a tap on a monster 3 tiles away shoots, and the same question opens with no walk', async ({ page }) => {
        await seed(page, who, ['w-bow'], { weapon: 'w-bow' });
        await openAdventure(page, who);
        const s0 = await state(page);
        expect(s0.weapon).toBe('bow');
        const m = monsters(s0)[0];
        const taken = (s0.entities as St[]);
        const { at, c } = await standWhereVisible(page, m, 3, taken);
        await shot(page, who, vp, 'bow-aim');
        await page.mouse.click(c.x, c.y);
        await expect.poll(async () => (await state(page)).shot?.kind, { timeout: 2000 }).toBe('arrow');
        await shot(page, who, vp, 'bow-arrow');
        await expect(page.locator('.question-modal')).toBeVisible({ timeout: 6000 });
        expect((await state(page)).hero).toEqual(at);
        expect(await spoken(page)).toContain('Twang!');
        await answer(page, who);
        await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 12_000 });
        expect((await state(page)).entities.some((e: St) => e.id === m.id)).toBe(false);
      });

      test('Bow: a 120 px target. A tap 50 px from a monster 3 tiles away shoots it', async ({ page }) => {
        await seed(page, who, ['w-bow'], { weapon: 'w-bow' });
        await openAdventure(page, who);
        const s0 = await state(page);
        const m = monsters(s0)[0];
        const { c } = await standWhereVisible(page, m, 3, s0.entities);
        const offsets = [[50, 0], [-50, 0], [0, 50], [0, -50]];
        const hits = await page.evaluate(([x, y, list]) => (list as number[][]).map(([dx, dy]) => (document.elementFromPoint(x! + dx!, y! + dy!) as HTMLElement | null)?.tagName ?? ''), [c.x, c.y, offsets] as [number, number, number[][]]);
        const i = hits.findIndex((t) => t === 'CANVAS');
        expect(i, 'the canvas is under the finger 50 px from the monster').toBeGreaterThanOrEqual(0);
        await page.mouse.click(c.x + offsets[i]![0]!, c.y + offsets[i]![1]!);
        await expect.poll(async () => (await state(page)).shot?.kind, { timeout: 2000 }).toBe('arrow');
      });

      test('Bow: an owned Bow that is not equipped shoots nothing', async ({ page }) => {
        await seed(page, who, ['w-bow']);
        await openAdventure(page, who);
        const s0 = await state(page);
        expect(s0.weapon).toBeNull();
        const m = monsters(s0)[0];
        const { c } = await standWhereVisible(page, m, 3, s0.entities);
        await page.mouse.click(c.x, c.y);
        await page.waitForTimeout(150);
        expect((await state(page)).shot).toBeNull();
      });

      test('Bow: out of reach, the tap walks like any tap', async ({ page }) => {
        await seed(page, who, ['w-bow'], { weapon: 'w-bow' });
        await openAdventure(page, who);
        const s0 = await state(page);
        const m = monsters(s0)[0];
        const { c } = await standWhereVisible(page, m, 5, s0.entities);
        await page.mouse.click(c.x, c.y);
        await page.waitForTimeout(150);
        const s1 = await state(page);
        expect(s1.shot).toBeNull();
        expect(s1.moving).toBe(true);
      });

      test('Boomerang: 5 right answers in a row arm it, the next right answer sends it to a monster within 3 tiles and that monster still asks its question', async ({ page }) => {
        await seed(page, who, ['w-boomerang'], { weapon: 'w-boomerang' });
        await openAdventure(page, who);
        expect((await state(page)).weapon).toBe('boomerang');
        // 5 right answers, each a walk to the next thing on the map. No throw before the streak.
        for (let i = 1; i <= 5; i++) {
          const s = await state(page);
          const e = (s.entities as St[]).find((x) => x.shown && !x.dog)!;
          const at = standList(e, 1, s.entities)[0]!;
          await teleport(page, at.x, at.y);
          await tapTile(page, e.x, e.y);
          await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
          await answer(page, who);
          await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 12_000 });
          const after = await state(page);
          expect(after.shot, `no throw after answer ${i}`).toBeNull();
          expect(after.boomArmed, `armed after answer ${i}`).toBe(i === 5);
        }
        // The 6th right answer: put a second monster 2 tiles from the hero's stand tile first.
        const s = await state(page);
        const mons = monsters(s);
        const a = (s.entities as St[]).find((x) => x.shown && !x.dog)!;
        const b = mons.find((x) => x.id !== a.id)!;
        const stand = standList(a, 1, s.entities)[0]!;
        await teleport(page, stand.x, stand.y);
        const near = standList(stand, 2, s.entities).find((t) => !(t.x === a.x && t.y === a.y))!;
        await page.evaluate(([id, x, y]) => (window as unknown as { __ow: { placeEntity(i: string, x: number, y: number): void } }).__ow.placeEntity(id as string, x as number, y as number), [b.id, near.x, near.y]);
        await tapTile(page, a.x, a.y);
        await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
        await answer(page, who);
        // The throw lasts 450 ms, so it is read from the voice line it makes, not from a poll on the flight.
        await expect.poll(() => spoken(page), { timeout: 15_000 }).toContain('Boomerang!');
        // The thrown-at monster is not cleared: its question is asked next.
        // The nearest monster in reach is the one it clears (another monster may stand closer than the one placed), and it is still on the map.
        await expect.poll(async () => (await state(page)).modalId, { timeout: 8000 }).not.toBeNull();
        const hit = (await state(page)).modalId as string;
        const st = await state(page);
        const target = (st.entities as St[]).find((e) => e.id === hit)!;
        expect(target.kind).toBe('monster');
        expect(Math.abs(target.x - stand.x) + Math.abs(target.y - stand.y)).toBeLessThanOrEqual(3);
        expect(st.boomArmed).toBe(false);
        await answer(page, who);
        await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 12_000 });
        expect((await state(page)).entities.some((e: St) => e.id === hit)).toBe(false);
      });

      test('worn items show on the map hero, and an owned item that is not worn does not', async ({ page }) => {
        await seed(page, who, ['g-cape', 'g-wizhat', 'w-sword'], { gear: 'g-wizhat', weapon: 'w-sword' });
        await openAdventure(page, who);
        expect((await state(page)).worn).toEqual({ gear: 'g-wizhat', weapon: 'w-sword' });
        expect((await state(page)).glow).toBeNull();
        await page.waitForTimeout(300);
        await shot(page, who, vp, 'worn-wizhat-sword');
      });

      test('the legendary armor and staff glow on the map and give a title on Home', async ({ page }) => {
        await seed(page, who, ['g-goldarmor', 'w-crystalstaff'], { gear: 'g-goldarmor', weapon: 'w-crystalstaff' });
        await toHome(page, who);
        const title = page.getByTestId('kid-title');
        await expect(title).toBeVisible();
        await shot(page, who, vp, 'home-title');
        if (who === 'Wren') {
          const box = (await title.boundingBox())!;
          expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(120);
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('[data-testid="kid-title"]'), [cx, cy])).toBe(true);
          await title.click();
          await expect.poll(() => spoken(page)).toContain(`Sir ${who}!`);
        } else await expect(title).toContainText(`Sir ${who}`);
        await expect(page.locator('.hero-fig[data-glow="gold"]').first()).toBeVisible();
        if (who === 'Wren') await page.getByRole('button', { name: 'Adventure' }).click();
        else await page.locator('.mode-card[data-mode="overworld"]').click();
        await expect(page.getByTestId('overworld')).toBeVisible();
        await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
        expect((await state(page)).glow).toBe('gold');
        await page.waitForTimeout(300);
        await shot(page, who, vp, 'glow-gold-map');
      });

      test('the staff alone gives the Archmage title and a cyan glow; with nothing legendary there is no title', async ({ page }) => {
        await seed(page, who, ['w-crystalstaff'], { weapon: 'w-crystalstaff' });
        await toHome(page, who);
        await expect(page.getByTestId('kid-title')).toBeVisible();
        if (who === 'Pip') await expect(page.getByTestId('kid-title')).toContainText(`Archmage ${who}`);
        await expect(page.locator('.hero-fig[data-glow="cyan"]').first()).toBeVisible();
      });

      test('no legendary item: no title and no glow', async ({ page }) => {
        await seed(page, who, ['g-cape', 'w-sword'], { gear: 'g-cape', weapon: 'w-sword' });
        await toHome(page, who);
        await expect(page.locator('.px-camp-name, .early-home').first()).toBeVisible();
        await expect(page.getByTestId('kid-title')).toHaveCount(0);
        await expect(page.locator('.hero-fig[data-glow]:not([data-glow=""])')).toHaveCount(0);
      });

      test('Dino Hood: a boss win roars (voice and picture) while the hood is worn', async ({ page }) => {
        await seed(page, who, ['g-dinohood'], { gear: 'g-dinohood' }, { lair: true });
        await openAdventure(page, who);
        const d = findTiles(MAPS.meadow, 'boss')[0]!;
        await tapTile(page, d.x, d.y);
        await expect(page.getByTestId('lair-hud')).toBeVisible();
        const b = findTiles(LAIRS.meadow.map, 'boss')[0]!;
        const side = { x: b.x, y: b.y + 1 };
        await teleport(page, side.x, side.y);
        await tapTile(page, b.x, b.y);
        await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
        // Five right answers win for a reader, six for a pre-reader. Each step waits until the game has counted the answer.
        for (let i = 0; i < (who === 'Pip' ? 5 : 6); i++) {
          const before = ((await state(page)).lair.fight?.answered ?? 0) as number;
          await answer(page, who);
          await expect.poll(async () => ((await state(page)).lair?.fight?.answered ?? before + 1) as number, { timeout: 20_000 }).toBeGreaterThan(before);
        }
        await expect(page.getByTestId('boss-win')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('boss-roar')).toBeVisible();
        expect((await spoken(page)).some((t) => /Roar!/.test(t))).toBe(true);
        await shot(page, who, vp, 'dino-roar');
      });
    });
  }
}
