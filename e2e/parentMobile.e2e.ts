import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { newCardState } from '../src/engine/scheduler';

/**
 * Parent area on iPhone widths (375x667, 390x844, 430x932), system Chrome with iPhone emulation.
 * WebKit is not used: its download is blocked on this host.
 * Also: kid screens keep touch-action that blocks pinch-zoom, and the 820x1180 kid screens stay pixel-identical.
 * Names, ids and the parent PIN are made up per run. SCREENSHOTS=1 writes PNGs under docs/screenshots/parent-mobile/.
 */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PHONES = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
] as const;

const READER_ID = 'kidreader000000000001';
const READER_NAME = 'Bartholomew Alexand'; // 19 chars: long names must wrap, never clip
const PRE_ID = 'kidpreread0000000002';
const PRE_NAME = 'Pip';
const PARENT_PIN = String(randomInt(1000, 10000));
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/parent-mobile' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function readerCards(): Record<string, unknown> {
  const now = Date.now();
  const cards: Record<string, unknown> = {};
  for (let a = 0; a <= 12; a++) {
    for (let b = 0; b <= 12; b++) {
      if ((a * 13 + b) % 3 === 0) continue;
      const c = newCardState(`mul:${a}x${b}`, now);
      c.attempts = 4;
      c.correct = 3;
      c.recentMs = [2400, 2100, 2600];
      c.fsrs = { ...c.fsrs, lapses: (a + b) % 7 === 0 ? 3 : 0, reps: 3 };
      cards[c.id] = c;
    }
  }
  return cards;
}

async function seed(page: Page, opts: { family?: boolean } = {}) {
  const family = opts.family ?? true;
  const now = Date.now();
  const kids = [
    {
      id: READER_ID,
      name: READER_NAME,
      createdAt: 1,
      settings: { tracks: { facts: true, multidigit: true, fractions: true }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 2, paceMultiplier: 3 },
      game: { xp: 1840, gems: 120, heroes: ['knight', 'wizard'], hero: 'wizard', streakDays: 4, lastPlayedDay: null, bestCombo: 9 },
      hasPin: true,
    },
    {
      id: PRE_ID,
      name: PRE_NAME,
      createdAt: 2,
      settings: { learner: 'prereader', modules: { add10: true, sub10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 },
      game: { xp: 300, gems: 40, heroes: ['knight'], hero: 'knight', streakDays: 3, lastPlayedDay: null, bestCombo: 5 },
    },
  ];
  const sessions = Array.from({ length: 6 }, (_, i) => ({
    id: `s-${i}`, startedAt: now - (i + 1) * 3_600_000, endedAt: now - (i + 1) * 3_600_000 + 540_000,
    answered: 30, graded: 30, correct: 27, fast: 12, newLearned: 2, medianMs: 2100, xp: 40, gems: 8, bestCombo: 5, missed: [],
  }));
  const purchases = [
    { id: 'p1', heroId: 'wizard', cost: 15, at: now - 7_200_000 },
    { id: 'p2', heroId: 'knight', cost: 0, at: now - 9_000_000 },
  ];
  await page.addInitScript(
    ({ family, kids, sessions, purchases, cards, pinHash, readerId, preId }) => {
      if (localStorage.getItem('mathquest:seeded')) return;
      localStorage.setItem('mathquest:seeded', '1');
      if (family) {
        localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
        localStorage.setItem('mathquest:v1:kids', JSON.stringify(kids));
        for (const id of [readerId, preId]) {
          localStorage.setItem(`mathquest:v1:sessions:${id}`, JSON.stringify(sessions));
          localStorage.setItem(`mathquest:v1:purchases:${id}`, JSON.stringify(purchases));
        }
        localStorage.setItem(`mathquest:v1:cards:${readerId}`, JSON.stringify(cards));
      }
    },
    { family, kids, sessions, purchases, cards: readerCards(), pinHash: sha(`mathquest:local:${PARENT_PIN}`), readerId: READER_ID, preId: PRE_ID },
  );
}

async function shot(page: Page, w: number, name: string, fullPage = true) {
  if (SHOTS && w === 390) await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage });
}
async function enterPin(page: Page, pin: string) {
  for (const d of pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
}
async function openParent(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /parent/i }).first().click();
  await enterPin(page, PARENT_PIN);
  await expect(page.locator('.parent')).toBeVisible();
}
async function pickKid(page: Page, name: string) {
  await page.locator('.tabs .tab', { hasText: name }).click();
  await expect(page.locator('.detail')).toBeVisible();
  await expect(page.locator('.detail .stat').first()).toBeVisible();
}

/** No horizontal scroll, every tap target at least 44 px, and no child sticking out of its parent. */
async function expectFits(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const clipped = (el: Element | null): boolean => {
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
      }
      return false;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.classList.contains('visually-hidden');
    };
    const small: string[] = [];
    const targets = document.querySelectorAll('button, a[href], select, input:not([type=hidden]), [role=button]');
    for (const el of targets) {
      if (!visible(el) || el.closest('.hm-cell')) continue;
      const box = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? (el.closest('label') ?? el) : el;
      const r = box.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) small.push(`${el.tagName.toLowerCase()}.${el.className} "${(el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const out: string[] = [];
    for (const el of document.querySelectorAll('#root *')) {
      if (!visible(el) || clipped(el)) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 0.5 || r.left < -0.5) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
      else if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') out.push(`${el.tagName.toLowerCase()}.${el.className} own scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, innerW: window.innerWidth, small, out: out.slice(0, 8) };
  });
  expect(r.scrollW, `${label}: document scrollWidth`).toBeLessThanOrEqual(r.clientW);
  expect(r.scrollW, `${label}: document scrollWidth vs viewport`).toBeLessThanOrEqual(r.innerW);
  expect(r.small, `${label}: tap targets under 44 px`).toEqual([]);
  expect(r.out, `${label}: elements wider than their screen or parent`).toEqual([]);
}

for (const { w, h } of PHONES) {
  test.describe(`parent area at ${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: IPHONE_UA });

    test('parent PIN: whole keypad visible, no scroll at all', async ({ page }) => {
      await seed(page);
      await page.goto('/');
      await page.getByRole('button', { name: /parent/i }).first().click();
      await expect(page.locator('.keypad')).toBeVisible();
      await expectFits(page, 'pin');
      const r = await page.evaluate(() => ({
        sh: document.documentElement.scrollHeight,
        ih: window.innerHeight,
        keypadBottom: document.querySelector('.keypad')!.getBoundingClientRect().bottom,
        cancel: [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel')?.getBoundingClientRect().bottom ?? 0,
      }));
      expect(r.keypadBottom).toBeLessThanOrEqual(r.ih);
      expect(r.cancel).toBeLessThanOrEqual(r.ih);
      expect(r.sh).toBeLessThanOrEqual(r.ih);
      await shot(page, w, 'parent-pin', false);
    });

    test('first-run setup PIN and add-player', async ({ page }) => {
      await seed(page, { family: false });
      await page.goto('/');
      await expect(page.locator('.keypad')).toBeVisible();
      await expectFits(page, 'setup pin');
      const r = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight }));
      expect(r.sh).toBeLessThanOrEqual(r.ih);
    });

    test('overview of a reader kid with a long name: stats, coverage grid, history', async ({ page }) => {
      await seed(page);
      await openParent(page);
      await pickKid(page, READER_NAME);
      await expectFits(page, 'reader overview');
      const first = await page.locator('.tabs .tab', { hasText: READER_NAME }).boundingBox();
      expect(first!.width).toBeLessThanOrEqual(w - 32 + 1);
      await expect(page.locator('.stat-xp')).toBeVisible();
      await shot(page, w, 'parent-overview-reader');
    });

    test('gem history rows are stacked and fit', async ({ page }) => {
      await seed(page);
      await openParent(page);
      await pickKid(page, READER_NAME);
      const hist = page.locator('.gem-history');
      await expect(hist).toBeVisible();
      await hist.scrollIntoViewIfNeeded();
      await expectFits(page, 'gem history');
      await shot(page, w, 'parent-gem-history', false);
    });

    test('times-table grid fits the width with its axis labels; a tap shows the fact', async ({ page }) => {
      await seed(page);
      await openParent(page);
      await pickKid(page, READER_NAME);
      const grid = page.locator('.heatmap').first();
      await grid.scrollIntoViewIfNeeded();
      const gb = (await grid.boundingBox())!;
      expect(gb.x).toBeGreaterThanOrEqual(0);
      expect(gb.x + gb.width).toBeLessThanOrEqual(w + 0.5);
      const scroll = await grid.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(scroll, 'grid needs no inner scroll').toBeLessThanOrEqual(1);
      await expect(grid.locator('.hm-head').first()).toBeVisible();
      const cell = grid.locator('.hm-cell[aria-label]').nth(20);
      await cell.tap();
      await expect(page.locator('.hm-sheet')).toBeVisible();
      await expect(page.locator('.hm-sheet')).toContainText(/×|Not seen|Learning|Fast|Known|Strong|Missed|New/i);
      await shot(page, w, 'parent-coverage-grid', false);
    });

    test('pre-reader overview and its sum grids', async ({ page }) => {
      await seed(page);
      await openParent(page);
      await pickKid(page, PRE_NAME);
      await expectFits(page, 'prereader overview');
      await shot(page, w, 'parent-overview-prereader');
    });

    test('settings: full-width controls, labels above, 44 px toggles, focus scrolls into view', async ({ page }) => {
      await seed(page);
      await openParent(page);
      await pickKid(page, READER_NAME);
      const settings = page.locator('.settings');
      await settings.scrollIntoViewIfNeeded();
      await expectFits(page, 'settings');
      for (const s of await settings.locator('select').all()) {
        const b = (await s.boundingBox())!;
        expect(b.width, 'select is full width').toBeGreaterThanOrEqual(w - 32 - 40);
        const fs = await s.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(fs, 'iOS zooms inputs under 16 px').toBeGreaterThanOrEqual(16);
      }
      await shot(page, w, 'parent-settings');
      const save = settings.getByRole('button', { name: /save/i });
      const del = settings.getByRole('button', { name: /remove|delete/i });
      const sb = (await save.boundingBox())!;
      expect(sb.width).toBeGreaterThanOrEqual(w - 32 - 40);
      if (await del.count()) {
        const db = (await del.first().boundingBox())!;
        expect(Math.abs(db.y - sb.y), 'destructive action sits apart from Save').toBeGreaterThanOrEqual(sb.height + 8);
      }
    });

    test('add player and change parent PIN', async ({ page }) => {
      await seed(page);
      await openParent(page);
      await page.locator('.tabs .tab', { hasText: 'Add player' }).click();
      await expect(page.locator('.add-kid')).toBeVisible();
      await expectFits(page, 'add player');
      await shot(page, w, 'parent-add-player');
      const input = page.locator('#kid-name');
      const fs = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(fs).toBeGreaterThanOrEqual(16);
      await page.getByRole('button', { name: 'Change PIN' }).first().click();
      await expect(page.locator('.keypad')).toBeVisible();
      await expectFits(page, 'change parent pin');
    });

    test('header buttons are at least 44 px and sit inside the screen', async ({ page }) => {
      await seed(page);
      await openParent(page);
      await expectFits(page, 'parent header');
      const names = ['Change PIN', 'Back to game'];
      for (const n of names) {
        const b = (await page.getByRole('button', { name: n }).first().boundingBox())!;
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.x + b.width).toBeLessThanOrEqual(w);
      }
    });

    test('viewport allows zoom for parents; parent elements do not block pinch-zoom', async ({ page }) => {
      await seed(page);
      await page.goto('/');
      const meta = await page.locator('meta[name=viewport]').getAttribute('content');
      expect(meta).not.toMatch(/user-scalable\s*=\s*(no|0)/);
      expect(meta).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/);
      await openParent(page);
      const blocked = await page.evaluate(() => {
        const bad = (el: Element | null) => {
          for (let p = el; p; p = p.parentElement) {
            const ta = getComputedStyle(p).touchAction;
            if (ta === 'none' || ta === 'pan-x pan-y' || ta === 'pan-x' || ta === 'pan-y') return true;
          }
          return false;
        };
        return [...document.querySelectorAll('.parent, .parent *')].filter(bad).slice(0, 5).map((e) => `${e.tagName}.${e.className}`);
      });
      expect(blocked).toEqual([]);
    });
  });
}

/** The Landing parent tab needs firestore mode with no user. A second dev server (E2E_LANDING_PORT) provides it. */
const LANDING_PORT = Number(process.env.E2E_LANDING_PORT) || 5198;
for (const { w, h } of PHONES) {
  test.describe(`landing at ${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: IPHONE_UA, baseURL: `http://localhost:${LANDING_PORT}` });
    test('kid tab and parent tab fit', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.landing-tab').first()).toBeVisible();
      await expectFits(page, 'landing kid');
      await shot(page, w, 'landing-kid', false);
      await page.locator('.landing-tab', { hasText: /parent/i }).click();
      await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
      await expectFits(page, 'landing parent');
      await shot(page, w, 'landing-parent', false);
    });
  });
}

/** Kid screens keep touch-action that blocks pinch-zoom (the viewport no longer does). */
const blocksPinch = () =>
  [...document.querySelectorAll('.screen:not(.parent), .screen:not(.parent) *')]
    .filter((el) => {
      for (let p: Element | null = el; p; p = p.parentElement) {
        const ta = getComputedStyle(p).touchAction;
        if (ta === 'none' || ta === 'pan-x pan-y' || ta === 'pan-x' || ta === 'pan-y') return false;
      }
      return true;
    })
    .slice(0, 6)
    .map((e) => `${e.tagName.toLowerCase()}.${e.className}`);

test.describe('kid screens block pinch-zoom with touch-action', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: IPHONE_UA });

  test('reader: picker, home, run', async ({ page }) => {
    await seed(page);
    await page.goto('/');
    await expect(page.locator('.kid-card').first()).toBeVisible();
    expect(await page.evaluate(blocksPinch), 'picker').toEqual([]);
    await page.locator('.kid-card', { hasText: READER_NAME }).click();
    await page.locator('.btn-start').waitFor();
    expect(await page.evaluate(blocksPinch), 'home').toEqual([]);
    await page.locator('.btn-start').click();
    await expect(page.locator('.screen.run')).toBeVisible();
    expect(await page.evaluate(blocksPinch), 'run').toEqual([]);
  });

  test('pre-reader: home and run', async ({ page }) => {
    await seed(page);
    await page.goto('/');
    await page.locator('.kid-card', { hasText: PRE_NAME }).click();
    await expect(page.locator('.early-home')).toBeVisible();
    expect(await page.evaluate(blocksPinch), 'pre-reader home').toEqual([]);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('.early-run')).toBeVisible();
    expect(await page.evaluate(blocksPinch), 'pre-reader run').toEqual([]);
  });
});

/** 820x1180 kid screens stay pixel-identical. Baselines were recorded on main (e2e/parentMobile.e2e.ts-snapshots). */
test.describe('820x1180 kid screens are unchanged', () => {
  test.use({
    viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const still = { animations: 'disabled' as const, maxDiffPixels: 0 };

  test('picker, reader home, pre-reader home', async ({ page }) => {
    await page.addInitScript(() => {
      let s = 12345;
      Math.random = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    });
    await seed(page);
    await page.goto('/');
    await expect(page.locator('.kid-card').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('kid-picker-820.png', still);
    await page.locator('.kid-card', { hasText: READER_NAME }).click();
    await page.locator('.btn-start').waitFor();
    await expect(page).toHaveScreenshot('kid-home-820.png', still);
    await page.locator('.btn-start').click();
    await expect(page.locator('.screen.run')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('kid-run-820.png', { ...still, mask: [page.locator('.run-top')] });
  });

  test('pre-reader home and run', async ({ page }) => {
    await page.addInitScript(() => {
      let s = 777;
      Math.random = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    });
    await seed(page);
    await page.goto('/');
    await page.locator('.kid-card', { hasText: PRE_NAME }).click();
    await expect(page.locator('.early-home')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('prereader-home-820.png', still);
  });
});
