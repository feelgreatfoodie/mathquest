import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Parent "Learning progress" panel, on the de-identified fixture (a copy of two real players with ids mapped to
 * kidA and kidB, taken 2026-11-18T03:04:48Z) under made-up names. Phone 393x852 and iPad 820x1180, system Chrome.
 * SHOTS_DIR=<dir> writes PNGs there (kept local, never in the repo).
 */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const KID_A = { id: 'kidreaderfixture0001', name: 'Avery' };
const KID_B = { id: 'kidprereadfixture002', name: 'Blake' };
const PIN = String(randomInt(1000, 10000));
const SHOTS = process.env.SHOTS_DIR ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
type Fx = { settings: Record<string, unknown>; cards: { id: string }[]; sessions: unknown[] };
const fx = JSON.parse(readFileSync('src/engine/__fixtures__/insights.json', 'utf8')) as Record<string, Fx>;

async function seed(page: Page) {
  const now = Date.now();
  // Shift the sessions so the newest ended a few minutes ago: the pace and trend charts have data on any day.
  const shift = (list: Fx['sessions']) => {
    const s = list as { startedAt: number; endedAt: number }[];
    const newest = Math.max(...s.map((x) => x.startedAt));
    const delta = now - 300_000 - newest;
    return s.map((x) => ({ ...x, startedAt: x.startedAt + delta, endedAt: x.endedAt + delta }));
  };
  const kids = [
    { ...KID_A, createdAt: 1, settings: fx.kidA!.settings, game: { xp: 1840, gems: 120, heroes: ['knight'], hero: 'knight', streakDays: 4, lastPlayedDay: null, bestCombo: 9 } },
    { ...KID_B, createdAt: 2, settings: fx.kidB!.settings, game: { xp: 300, gems: 40, heroes: ['knight'], hero: 'knight', streakDays: 3, lastPlayedDay: null, bestCombo: 5 } },
  ];
  const data = {
    [KID_A.id]: { cards: Object.fromEntries(fx.kidA!.cards.map((c) => [c.id, c])), sessions: shift(fx.kidA!.sessions) },
    [KID_B.id]: { cards: Object.fromEntries(fx.kidB!.cards.map((c) => [c.id, c])), sessions: shift(fx.kidB!.sessions) },
  };
  await page.addInitScript(
    ({ kids, data, pinHash }) => {
      if (localStorage.getItem('mathquest:seeded')) return;
      localStorage.setItem('mathquest:seeded', '1');
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
      localStorage.setItem('mathquest:v1:kids', JSON.stringify(kids));
      for (const [id, d] of Object.entries(data)) {
        localStorage.setItem(`mathquest:v1:cards:${id}`, JSON.stringify(d.cards));
        localStorage.setItem(`mathquest:v1:sessions:${id}`, JSON.stringify(d.sessions));
        localStorage.setItem(`mathquest:v1:purchases:${id}`, JSON.stringify([]));
      }
    },
    { kids, data, pinHash: sha(`mathquest:local:${PIN}`) },
  );
}

async function openKid(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /grown-ups/i }).first().click();
  for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await expect(page.locator('.parent')).toBeVisible();
  await page.locator('.tabs .tab', { hasText: name }).click();
  await expect(page.locator('[data-testid=insights]')).toBeVisible();
  await expect(page.locator('[data-testid=insights] >> text=Loading')).toHaveCount(0);
}

async function expectNoOverflow(page: Page, label: string) {
  const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth, i: window.innerWidth }));
  expect(r.s, `${label}: scrollWidth`).toBeLessThanOrEqual(r.c);
  expect(r.s, `${label}: scrollWidth vs viewport`).toBeLessThanOrEqual(r.i);
}

const VIEWS = [
  { name: 'phone 393x852', w: 393, h: 852, ua: IPHONE_UA, mobile: true, side: false },
  { name: 'iPad 820x1180', w: 820, h: 1180, ua: IPAD_UA, mobile: false, side: true },
] as const;

for (const v of VIEWS) {
  test.describe(`learning progress, ${v.name}`, () => {
    test.use({ viewport: { width: v.w, height: v.h }, isMobile: v.mobile, hasTouch: true, deviceScaleFactor: 2, userAgent: v.ua });

    test('reader: alerts, 13x13 matrix, legend, cell tap detail, ladder, no overflow', async ({ page }) => {
      await seed(page);
      await openKid(page, KID_A.name);
      const panel = page.locator('[data-testid=insights]');
      await expect(panel.getByRole('heading', { name: 'Learning progress' })).toBeVisible();
      await expect(page.locator('[data-testid=ins-alerts] li').first()).toContainText('No new facts in the last 10 runs');
      // Collapsed until opened, matrix first inside it.
      const mod = page.locator('[data-testid=ins-module-facts]');
      await expect(mod.locator('summary')).toContainText('Times tables: 81 of 91 facts seen');
      await mod.locator('summary').click();
      const matrix = page.locator('[data-testid=ins-matrix-facts]');
      await expect(matrix).toBeVisible();
      await expect(matrix.locator('button.ins-cell')).toHaveCount(169);
      await expect(matrix).toHaveAttribute('data-cards', '91');
      await expect(page.locator('[data-testid=ins-legend] .legend-item')).toHaveCount(6);
      await expect(page.locator('[data-testid=ins-legend]')).toContainText('Seen early (preview)');
      // aria-label per cell, and a seen-early preview dot on at least one.
      await expect(matrix.getByRole('button', { name: '6 times 7, not seen' })).toHaveCount(1);
      expect(await matrix.locator('button.ins-cell[data-preview]').count()).toBeGreaterThan(0);
      // Cell width on the phone is about 22 px or more.
      const cell = await matrix.locator('button.ins-cell').first().boundingBox();
      expect(cell!.width).toBeGreaterThanOrEqual(v.w >= 820 ? 24 : 20);
      // Tap shows the detail.
      await matrix.getByRole('button', { name: '6 times 7, not seen' }).first().click();
      const sheet = page.locator('[data-testid=ins-sheet]');
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('6 × 7 = 42');
      await expect(sheet).toContainText('Not seen');
      await expect(sheet).toContainText('Attempts');
      await expect(sheet).toContainText('6s, 7s, 8s');
      await expectNoOverflow(page, 'sheet open');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/reader-sheet-${v.w}.png` });
      await sheet.getByRole('button', { name: 'Close' }).click();
      await expect(sheet).toHaveCount(0);
      // Ladder: 5 groups, g3 45%, marker, status text.
      const ladder = page.locator('[data-testid=ins-ladder-facts]');
      await expect(ladder.locator('li.ins-row')).toHaveCount(5);
      await expect(ladder.locator('li[data-group=g3]')).toContainText('45% reviewing+');
      await expect(ladder.locator('li[data-group=g4]')).toContainText('0/9 seen');
      await expect(ladder.locator('.ins-bar-marker').first()).toBeVisible();
      await expect(ladder.locator('li[data-state=locked]').first()).toContainText(/unlocks at 80% \(now \d+%\)/);
      // Side by side on the iPad, stacked on the phone.
      const mb = (await matrix.boundingBox())!;
      const lb = (await ladder.boundingBox())!;
      if (v.side) expect(lb.x).toBeGreaterThanOrEqual(mb.x + mb.width - 2);
      else expect(lb.y).toBeGreaterThanOrEqual(mb.y + mb.height - 2);
      await expectNoOverflow(page, 'module open');
      // Practice section.
      await page.locator('[data-testid=ins-practice] summary').click();
      await expect(page.locator('[data-testid=ins-balance]')).toContainText('max 28');
      await expect(page.locator('[data-testid=ins-pace]')).toContainText('new facts this week');
      await expect(page.locator('[data-testid=ins-needs-work] li').first()).toBeVisible();
      await expect(page.locator('[data-testid=ins-skills]')).toBeVisible();
      await expect(page.locator('[data-testid=ins-trend]')).toBeVisible();
      // No pin control in v1.
      await expect(panel.getByText(/practice next run/i)).toHaveCount(0);
      await expectNoOverflow(page, 'all open');
      if (SHOTS) {
        await panel.screenshot({ path: `${SHOTS}/reader-panel-${v.w}.png` });
      }
    });

    test('pre-reader: add 11x11 with grey sums over 10, sub triangle, second rule only', async ({ page }) => {
      await seed(page);
      await openKid(page, KID_B.name);
      await expect(page.locator('[data-testid=ins-module-add10] summary')).toContainText('Addition within 10: 15 of 36 facts seen');
      await expect(page.locator('[data-testid=ins-module-sub10] summary')).toContainText('Subtraction within 10: 21 of 66 facts seen');
      await page.locator('[data-testid=ins-module-add10] summary').click();
      const add = page.locator('[data-testid=ins-matrix-add10]');
      await expect(add.locator('button.ins-cell')).toHaveCount(66);
      await expect(add.locator('[data-gap]')).toHaveCount(121 - 66);
      await expect(add.locator('.ins-grey')).toHaveCount(55);
      await expect(add.getByRole('button', { name: /^3 plus 4, / })).toHaveCount(1);
      const ladder = page.locator('[data-testid=ins-ladder-add10]');
      await expect(ladder.locator('li.ins-row')).toHaveCount(2);
      await expect(ladder.locator('.ins-second')).toHaveCount(0); // a pre-reader shows the steady rule as the main bar
      await expect(ladder.locator('li[data-group=g1]')).toContainText('% steady');
      await page.locator('[data-testid=ins-module-sub10] summary').click();
      const sub = page.locator('[data-testid=ins-matrix-sub10]');
      await expect(sub.locator('button.ins-cell')).toHaveCount(66);
      await expect(sub.locator('[data-gap]')).toHaveCount(121 - 66);
      await expect(sub.locator('.ins-grey')).toHaveCount(0);
      await expect(sub.getByRole('button', { name: /^7 minus 3, / })).toHaveCount(1);
      await expect(sub.getByRole('button', { name: /^3 minus 7, / })).toHaveCount(0);
      await expectNoOverflow(page, 'prereader open');
      if (SHOTS) await page.locator('[data-testid=insights]').screenshot({ path: `${SHOTS}/prereader-panel-${v.w}.png` });
    });
  });
}
