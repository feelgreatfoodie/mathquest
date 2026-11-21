import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Trophy room (item powers PDR, section 5), offline mode. Pip is a reader and Wren a pre-reader; names and ids are made up.
 * Both open it from Home and come back. It fits one screen (no page scroll, no clipped tile) at the five guarded viewports, shows no
 * price, and a pre-reader's every button is 120 px or more (readers 60 px). The voice is stubbed and recorded.
 * TROPHY_SHOTS=1 writes screenshots to docs/screenshots/trophy-room (TROPHY_SHOTS_DIR overrides).
 */
const SHOTS = process.env.TROPHY_SHOTS ? (process.env.TROPHY_SHOTS_DIR ?? 'docs/screenshots/trophy-room') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PIP = 'kidtrophypip0000000001';
const WREN = 'kidtrophywren000000002';
const NEW = 'kidtrophynew0000000003';
const VIEWPORTS = [{ w: 820, h: 1180 }, { w: 1024, h: 768 }, { w: 393, h: 852 }, { w: 1024, h: 650 }, { w: 768, h: 900 }];

const READER = { shop2: true, tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
const PRE = { shop2: true, learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };

async function seed(page: Page, o: { wrenSettings?: Record<string, unknown>; muteWren?: boolean } = {}) {
  await page.addInitScript(
    ({ ids, readerS, preS, wrenSettings, muteWren }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
      class Utter { text: string; lang = ''; rate = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } } });
      w.AudioContext = class { currentTime = 0; destination = {}; resume() { return Promise.resolve(); } createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
      if (localStorage.getItem('mathquest:v1:kids')) return;
      const g = (extra: Record<string, unknown>) => ({ xp: 300, gems: 40, heroes: ['knight'], hero: 'knight', streakDays: 3, lastPlayedDay: null, bestCombo: 5, ...extra });
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash: 'x', createdAt: 1 }));
      localStorage.setItem('mathquest:v1:kids', JSON.stringify([
        { id: ids.pip, name: 'Pip', createdAt: 1, settings: readerS, game: g({ items: ['c-flag', 'w-bow', 'p-dog', 'g-goldarmor', 'w-crystalstaff'] }) },
        { id: ids.wren, name: 'Wren', createdAt: 2, settings: { ...preS, ...wrenSettings }, game: g({ items: ['w-sword', 'g-cape', 'g-goldarmor'] }) },
        { id: ids.fresh, name: 'Moss', createdAt: 3, settings: readerS, game: g({}) },
      ]));
      const lair = (region: string, ms: number, won = true) => ({ id: `${region}${ms}`, startedAt: 1000 + ms, endedAt: 2000 + ms, answered: 0, graded: 0, correct: 0, fast: 0, newLearned: 0, medianMs: 0, xp: 0, gems: 0, bestCombo: 0, missed: [], mode: 'lair', region, bossWon: won, bossMs: ms });
      const world = { region: 'meadow', x: 1, y: 1, facing: 'down', openedChests: ['#7'], bossesDefeated: ['meadow', 'forest'], keys: 0, version: 1, updatedAt: 1 };
      const card = (id: string) => ({ id, fsrs: { due: 1, stability: 30, difficulty: 3, elapsed_days: 1, scheduled_days: 30, learning_steps: 0, reps: 6, lapses: 0, state: 2, last_review: 1 }, attempts: 6, correct: 6, recentMs: [900, 1000, 1100], lastRating: 3, updatedAt: 1 });
      for (const id of [ids.pip, ids.wren]) {
        localStorage.setItem(`mathquest:v1:sessions:${id}`, JSON.stringify([lair('forest', 41000), lair('forest', 38500), lair('forest', 9000, false), lair('meadow', 52000)]));
        localStorage.setItem(`mathquest:v1:world:${id}`, JSON.stringify(world));
        localStorage.setItem(`mathquest:v1:cards:${id}`, JSON.stringify({ 'mul:2x3': card('mul:2x3'), 'mul:4x5': card('mul:4x5') }));
      }
      if (muteWren) localStorage.setItem(`mathquest:v1:mute:${ids.wren}`, '1');
    },
    { ids: { pip: PIP, wren: WREN, fresh: NEW }, readerS: READER, preS: PRE, wrenSettings: o.wrenSettings ?? {}, muteWren: o.muteWren ?? false },
  );
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.filter((t) => t.trim() !== ''));
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  const vp = page.viewportSize()!;
  await page.screenshot({ path: `${SHOTS}/${name}-${vp.width}x${vp.height}.png` });
}
async function openTrophy(page: Page, name: string) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: name }).click();
  await page.getByTestId('home-trophy').click();
  await expect(page.getByTestId('trophy-room')).toBeVisible();
  await expect(page.getByTestId('trophy-loading')).toHaveCount(0);
}
/** No page scroll, and nothing of the screen sticks out of the viewport. */
async function fits(page: Page, what: string) {
  const vp = page.viewportSize()!;
  const m = await page.evaluate(() => {
    const room = document.querySelector('[data-testid="trophy-room"]') as HTMLElement;
    const out: string[] = [];
    for (const el of room.querySelectorAll('button, li, [data-region], [data-count]')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.left < -0.5 || r.top < -0.5 || r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5) out.push(`${el.getAttribute('aria-label') ?? el.className} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
    }
    return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, rh: room.scrollHeight, rch: room.clientHeight, out };
  });
  expect(m.sw, `${what} scrollWidth`).toBeLessThanOrEqual(vp.width);
  expect(m.sh, `${what} scrollHeight`).toBeLessThanOrEqual(vp.height);
  expect(m.rh, `${what} room scrollHeight`).toBeLessThanOrEqual(m.rch + 1);
  expect(m.out, `${what} sticks out`).toEqual([]);
}
async function minTargets(page: Page, min: number, what: string) {
  const small = await page.evaluate((px) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('[data-testid="trophy-room"] button')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width && (r.width < px - 0.5 || r.height < px - 0.5)) out.push(`${el.getAttribute('aria-label')} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, min);
  expect(small, `${what} targets under ${min}px`).toEqual([]);
}
const noPrices = async (page: Page) => {
  const text = await page.getByTestId('trophy-room').innerText();
  expect(text).not.toMatch(/\bgems?\b|price|cost|\bsell\b/i);
  expect(await page.getByTestId('trophy-room').locator('[data-item]').evaluateAll((els) => els.map((e) => e.querySelector('.tally-num')).filter(Boolean).length)).toBe(0);
};

for (const vp of VIEWPORTS) {
  test.describe(`${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test('reader: opens from Home, fits, shows trophies, items, titles and counts, no price, and goes back', async ({ page }) => {
      await seed(page);
      await openTrophy(page, 'Pip');
      const room = page.getByTestId('trophy-room');
      await fits(page, 'reader first screen');
      await expect(page.locator('[data-region="forest"]')).toContainText('Beaten 2 times');
      await expect(page.locator('[data-region="forest"]')).toContainText('Best time 38.5 s');
      await expect(page.locator('[data-region="meadow"]')).toContainText('Beaten 1 time');
      await expect(page.locator('[data-region="castle"]')).toContainText('Not beaten yet');
      await expect(page.locator('[data-region="castle"]')).toHaveAttribute('data-earned', 'no');
      await expect(page.getByTestId('trophy-title')).toHaveText(['Sir Pip', 'Archmage Pip']);
      await expect(page.locator('[data-count="chests"]')).toHaveAttribute('data-value', '7');
      await expect(page.locator('[data-count="bosses"]')).toHaveAttribute('data-value', '2');
      await expect(page.locator('[data-count="fluent"]')).toHaveAttribute('data-value', '2');
      await shot(page, 'reader-weapons');
      for (const tab of ['weapon', 'gear', 'pet', 'adventure', 'camp', 'legendary']) {
        await page.locator(`[data-tab="${tab}"]`).click();
        await fits(page, `reader ${tab}`);
        await noPrices(page);
      }
      await page.locator('[data-tab="weapon"]').click();
      await expect(room.locator('[data-item="w-bow"]')).toHaveAttribute('data-owned', 'yes');
      await expect(room.locator('[data-item="w-sword"]')).toHaveAttribute('data-owned', 'no');
      await minTargets(page, 60, 'reader');
      await page.getByTestId('trophy-back').click();
      await expect(room).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Shop', exact: true })).toBeVisible();
    });

    test('reader with a new account: three empty stands, zero counts, no titles', async ({ page }) => {
      await seed(page);
      await openTrophy(page, 'Moss');
      await fits(page, 'new reader');
      await expect(page.locator('[data-earned="no"]')).toHaveCount(3);
      await expect(page.getByTestId('trophy-titles')).toHaveCount(0);
      for (const c of ['chests', 'bosses', 'fluent']) await expect(page.locator(`[data-count="${c}"]`)).toHaveAttribute('data-value', '0');
      await shot(page, 'reader-new');
    });

    test('pre-reader: opens from Home, fits in every section, every target 120 px, no price, speaks on tap, and goes back', async ({ page }) => {
      await seed(page);
      await openTrophy(page, 'Wren');
      const room = page.getByTestId('trophy-room');
      await fits(page, 'pre lairs');
      await minTargets(page, 120, 'pre lairs');
      await shot(page, 'prereader-lairs');
      await page.locator('[data-region="forest"]').click();
      await expect.poll(() => spoken(page)).toContain('Forest lair. Beaten 2 times. Best time 39 seconds.');
      await page.locator('[data-region="castle"]').click();
      await expect.poll(() => spoken(page)).toContain('The Castle lair is not beaten yet.');
      await page.locator('[data-section="things"]').click();
      for (const tab of ['weapon', 'gear', 'pet', 'adventure', 'camp', 'legendary']) {
        await page.locator(`[data-tab="${tab}"]`).click();
        await fits(page, `pre ${tab}`);
        await minTargets(page, 120, `pre ${tab}`);
        await noPrices(page);
      }
      await page.locator('[data-tab="weapon"]').click();
      await shot(page, 'prereader-things');
      await expect(room.locator('[data-item="w-sword"]')).toHaveAttribute('data-owned', 'yes');
      await room.locator('[data-item="w-sword"]').click();
      await expect.poll(() => spoken(page)).toContain('Sword!');
      await room.locator('[data-item="w-bow"]').click();
      await expect.poll(() => spoken(page)).toContain('A Bow. You do not have it yet.');
      await page.locator('[data-section="counts"]').click();
      await fits(page, 'pre counts');
      await minTargets(page, 120, 'pre counts');
      await expect(page.locator('[data-count="chests"]')).toHaveAttribute('data-value', '7');
      await expect(page.getByTestId('trophy-title')).toHaveCount(1);
      await page.locator('[data-count="chests"]').click();
      await expect.poll(() => spoken(page)).toContain('You opened 7 chests.');
      await page.getByTestId('trophy-title').click();
      await expect.poll(() => spoken(page)).toContain('Sir Wren!');
      await shot(page, 'prereader-counts');
      await page.getByTestId('trophy-back').click();
      await expect(room).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    });

    test('Home fits with the Trophy room button, for a reader and a pre-reader, and its target is big enough', async ({ page }) => {
      await seed(page);
      for (const [name, min] of [['Pip', 60], ['Wren', 120]] as const) {
        await page.goto('/');
        await page.locator('.kid-card', { hasText: name }).click();
        const btn = page.getByTestId('home-trophy');
        await expect(btn).toBeVisible();
        const b = (await btn.boundingBox())!;
        expect(b.height, `${name} trophy button height`).toBeGreaterThanOrEqual(min);
        if (name === 'Wren') expect(b.width).toBeGreaterThanOrEqual(120);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }));
        expect(m.sw, `${name} Home scrollWidth`).toBeLessThanOrEqual(vp.w);
        // The no-scroll rule is the iPad one (700 px wide and 600 tall or more). A phone Home scrolls today and keeps its own layout.
        if (vp.w >= 700) {
          expect(m.sh, `${name} Home scrollHeight`).toBeLessThanOrEqual(vp.h);
          expect(b.y + b.height, `${name} button bottom`).toBeLessThanOrEqual(vp.h);
        }
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(vp.w);
        await shot(page, `home-${name === 'Pip' ? 'reader' : 'prereader'}`);
      }
    });
  });
}

test.describe('pre-reader voice', () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  test('silent while the kid has muted', async ({ page }) => {
    await seed(page, { muteWren: true });
    await openTrophy(page, 'Wren');
    await page.locator('[data-region="forest"]').click();
    await page.waitForTimeout(300);
    expect(await spoken(page)).toEqual([]);
  });
  test('silent while the parent turned the voice off', async ({ page }) => {
    await seed(page, { wrenSettings: { voice: 'off' } });
    await openTrophy(page, 'Wren');
    await page.locator('[data-region="forest"]').click();
    await page.waitForTimeout(300);
    expect(await spoken(page)).toEqual([]);
  });
});
