import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerOnScreen, holdHome, seed, typeAnswer } from './lightning';

/**
 * ipad-fit guard: every non-Adventure screen fits the iPad Safari viewport with no page scroll, at 1024x650 and 1080x700
 * (landscape with the address bar), 768x900 and 810x960 (portrait). Two checks per screen: document.scrollingElement.scrollHeight
 * <= innerHeight, and the primary action's bounding box is fully inside the viewport. The Adventure map is exempt. Made-up names, ids and PIN.
 */
const LANDING = `http://localhost:${Number(process.env.E2E_LANDING_PORT) || 5198}`;
const PIN = '2468';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const VIEWPORTS = [
  { w: 1024, h: 650 },
  { w: 1080, h: 700 },
  { w: 768, h: 900 },
  { w: 810, h: 960 },
];

/** FIT_SHOTS=<dir> writes one PNG per screen and viewport there (keep them local). Fixture kid only. */
const SHOTS = process.env.FIT_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

type Who = 'reader' | 'prereader';

/** Lightning seed (Pip, weak and known cards) plus shop2, vault, 100 gems and a known Grown-ups PIN. */
async function seedKid(page: Page, who: Who, teach = false) {
  await seed(page, { learner: who });
  await page.addInitScript(
    ({ pinHash, teach }) => {
      const kids = JSON.parse(localStorage.getItem('mathquest:v1:kids') ?? '[]');
      if (!kids.length || kids[0].__fit) return;
      kids[0].__fit = true;
      kids[0].settings = { ...kids[0].settings, shop2: true, vault: { on: true } };
      kids[0].game = { ...kids[0].game, gems: 100, xp: 300, heroes: ['knight', 'wizard'], hero: 'wizard', goal: 'p-owl' };
      // Teach cards open a new skill: multi-digit on, facts off, no cards yet.
      if (teach) {
        kids[0].settings = { ...kids[0].settings, tracks: { facts: false, multidigit: true, fractions: false } };
        localStorage.removeItem(`mathquest:v1:cards:${kids[0].id}`);
      }
      localStorage.setItem('mathquest:v1:kids', JSON.stringify(kids));
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1 }));
    },
    { pinHash: sha(`mathquest:local:${PIN}`), teach },
  );
}

async function openHome(page: Page) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: 'Pip' }).tap();
}

type Step = { name: string; who?: Who; teach?: boolean; run: (page: Page) => Promise<Locator> };

const teachOrKeypad = async (page: Page) => {
  const teach = page.getByRole('button', { name: 'Let me try one!' });
  await expect(page.locator('.keypad').or(teach)).toBeVisible();
  return teach;
};
const startReader = async (page: Page) => {
  await openHome(page);
  await page.locator('.mode-card[data-mode="dungeon"]').tap();
  const teach = await teachOrKeypad(page);
  if (await teach.isVisible()) await teach.tap();
  await expect(page.locator('.keypad')).toBeVisible();
};
/** A wrong answer on the keypad (999 is never a fact): the miss card opens. */
const missOne = async (page: Page) => {
  await typeAnswer(page, 999);
  await page.locator('.keypad .key-go').tap();
};
const startPre = async (page: Page) => {
  await openHome(page);
  await page.getByRole('button', { name: 'Play' }).tap();
  await expect(page.locator('.choice').first()).toBeVisible({ timeout: 15_000 });
};

const STEPS: Step[] = [
  { name: 'title screen', run: async (page) => { await page.goto(LANDING); await expect(page.getByTestId('title-menu')).toBeVisible(); return page.getByTestId('title-intro'); } },
  { name: 'intro cards', run: async (page) => { await page.goto(LANDING); await page.getByTestId('title-intro').tap(); const b = page.getByRole('button', { name: /next|got it|get started/i }).first(); await expect(b).toBeVisible(); return b; } },
  { name: 'kid picker', who: 'reader', run: async (page) => { await page.goto('/'); await expect(page.locator('.kid-card').first()).toBeVisible(); return page.getByRole('button', { name: /grown-ups area/i }); } },
  { name: 'PIN pad', who: 'reader', run: async (page) => { await page.goto('/'); await page.getByRole('button', { name: /grown-ups area/i }).tap(); await expect(page.locator('.keypad')).toBeVisible(); return page.locator('.keypad'); } },

  { name: 'reader Home', who: 'reader', run: async (page) => { await openHome(page); const b = page.locator('.mode-card[data-mode="dungeon"]'); await expect(b).toBeVisible(); return b; } },
  { name: 'reader Dungeon question', who: 'reader', run: async (page) => { await startReader(page); return page.locator('.keypad'); } },
  { name: 'reader teach card', who: 'reader', teach: true, run: async (page) => { await openHome(page); await page.locator('.mode-card[data-mode="dungeon"]').tap(); const teach = page.getByRole('button', { name: 'Let me try one!' }); await expect(teach).toBeVisible({ timeout: 15_000 }); return teach; } },
  {
    name: 'reader miss card', who: 'reader',
    run: async (page) => {
      await startReader(page);
      await missOne(page);
      const got = page.getByRole('button', { name: 'Got it' });
      await expect(got).toBeVisible({ timeout: 8000 });
      return got;
    },
  },
  { name: 'reader end-of-run', who: 'reader', run: async (page) => { await startReader(page); await missOne(page); await page.getByRole('button', { name: 'Got it' }).tap(); await expect(page.locator('.keypad')).toBeVisible(); await holdHome(page); const b = page.getByRole('button', { name: 'Play again' }); await expect(b).toBeVisible({ timeout: 8000 }); await page.waitForTimeout(800); return b; } },
  { name: 'reader Lightning card', who: 'reader', run: async (page) => { await openHome(page); await page.getByTestId('home-lightning').tap(); await expect(page.getByTestId('lightning')).toBeVisible(); await expect(page.locator('.lr-ring')).toBeVisible(); return page.locator('.keypad'); } },
  { name: 'reader Lightning end', who: 'reader', run: async (page) => { await openHome(page); await page.getByTestId('home-lightning').tap(); await expect(page.getByTestId('lightning')).toBeVisible(); await typeAnswer(page, await answerOnScreen(page)); await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'hit'); await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'ask'); await holdHome(page); await expect(page.getByTestId('lr-end')).toBeVisible(); await page.waitForTimeout(800); return page.getByTestId('lr-end').locator('button').last(); } },
  { name: 'reader shop', who: 'reader', run: async (page) => { await openHome(page); await page.getByRole('button', { name: 'Shop', exact: true }).tap(); await expect(page.locator('.shop-grid').first()).toBeVisible(); return page.locator('.shop-grid').first(); } },
  { name: 'reader vault', who: 'reader', run: async (page) => { await openHome(page); await page.getByRole('button', { name: 'Shop', exact: true }).tap(); await page.locator('[data-tab="vault"]').tap(); await expect(page.getByTestId('vault')).toBeVisible(); return page.getByTestId('vault'); } },

  { name: 'picture-player Home', who: 'prereader', run: async (page) => { await openHome(page); const b = page.getByRole('button', { name: 'Play' }); await expect(b).toBeVisible(); return b; } },
  { name: 'picture-player Home last tile', who: 'prereader', run: async (page) => { await openHome(page); await expect(page.getByRole('button', { name: 'Play' })).toBeVisible(); return page.getByRole('button', { name: 'Hero shop' }); } },
  { name: 'Picture Run question', who: 'prereader', run: async (page) => { await startPre(page); return page.locator('.choice').last(); } },
  { name: 'Picture Run miss', who: 'prereader', run: async (page) => { await startPre(page); await page.locator('.choice[data-answer="false"]').first().tap(); await expect(page.locator('.choice.is-guide')).toBeVisible(); return page.locator('.choice').last(); } },
  { name: 'picture-player end-of-run', who: 'prereader', run: async (page) => { await startPre(page); await page.locator('.choice[data-answer="true"]').tap(); await page.waitForTimeout(2500); await holdHome(page); await expect(page.locator('.sum')).toBeVisible({ timeout: 8000 }); await expect(page.getByTestId('sum-buttons')).toBeVisible({ timeout: 12_000 }); return page.getByTestId('sum-buttons'); } },
  { name: 'picture-player Lightning card', who: 'prereader', run: async (page) => { await openHome(page); await page.getByTestId('home-lightning').tap(); await expect(page.getByTestId('lightning')).toBeVisible(); await expect(page.locator('.lr-choice').first()).toBeVisible(); return page.locator('.lr-choice').last(); } },
  { name: 'picture-player Lightning end', who: 'prereader', run: async (page) => { await openHome(page); await page.getByTestId('home-lightning').tap(); await expect(page.getByTestId('lightning')).toBeVisible(); await page.locator('.lr-choice[data-answer="true"]').tap(); await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'ask'); await holdHome(page); await expect(page.getByTestId('lr-end')).toBeVisible(); await page.waitForTimeout(800); return page.getByTestId('lr-end').locator('button').last(); } },
  { name: 'picture-player shop', who: 'prereader', run: async (page) => { await openHome(page); await page.getByRole('button', { name: 'Hero shop' }).tap(); await expect(page.locator('.pshop')).toBeVisible(); return page.locator('.pshop-grid'); } },
  { name: 'picture-player vault', who: 'prereader', run: async (page) => { await openHome(page); await page.getByRole('button', { name: 'Hero shop' }).tap(); await page.locator('[data-tab="vault"]').tap(); await expect(page.getByTestId('pvault')).toBeVisible(); return page.getByTestId('pvault'); } },
];

/** Registers the guard in the calling spec (chrome and webkit specs both call it). */
export function fitGuard() {
for (const vp of VIEWPORTS) {
  test.describe(`ipad-fit ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });
    test.setTimeout(60_000);
    // Picture-player Home: the Home (hold) button and the mute button are not covered by the banner or anything else.
    // elementFromPoint at each center must return the button or a descendant; portrait taps are at least 120 px.
    test(`picture-player Home buttons are tappable at ${vp.w}x${vp.h}`, async ({ page }) => {
      await seedKid(page, 'prereader');
      await openHome(page);
      await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
      await page.waitForTimeout(300);
      for (const name of ['Hold to leave', /^Sound is (on|off)/]) {
        const b = page.getByRole('button', { name });
        await expect(b).toBeVisible();
        const box = (await b.boundingBox())!;
        const hit = await b.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!top && (top === el || el.contains(top));
        });
        expect.soft(hit, `${name} center is covered`).toBe(true);
        expect.soft(box.x, `${name} left`).toBeGreaterThanOrEqual(-0.5);
        expect.soft(box.y, `${name} top`).toBeGreaterThanOrEqual(-0.5);
        expect.soft(box.x + box.width, `${name} right`).toBeLessThanOrEqual(vp.w + 0.5);
        expect.soft(box.y + box.height, `${name} bottom`).toBeLessThanOrEqual(vp.h + 0.5);
        if (vp.w < vp.h) {
          expect.soft(box.width, `${name} width`).toBeGreaterThanOrEqual(120);
          expect.soft(box.height, `${name} height`).toBeGreaterThanOrEqual(120);
        }
      }
    });
    for (const s of STEPS) {
      test(`${s.name} fits ${vp.w}x${vp.h}`, async ({ page }) => {
        if (s.who) await seedKid(page, s.who, s.teach);
        const primary = await s.run(page);
        await page.waitForTimeout(300);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${s.name.replace(/[^a-z0-9]+/gi, '-')}-${vp.w}x${vp.h}.png` });
        if (process.env.FIT_DUMP) console.log(s.name, await page.evaluate(() => Array.from(document.querySelectorAll('.screen, .screen > *, .screen > * > *')).map((e) => `${e.className.toString().slice(0, 30)}:${Math.round(e.getBoundingClientRect().height)}`).join(' | ')));
        const m = await page.evaluate(() => ({ sh: document.scrollingElement!.scrollHeight, ih: window.innerHeight, sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
        // Modals and inner scrollers: a dialog panel taller than the viewport, or a box that scrolls on its own, hides content the page check misses.
        const inner = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0) out.push(`scrolls: ${el.className || el.tagName} ${el.scrollHeight}>${el.clientHeight}`);
          }
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('.modal > *'))) {
            const r = el.getBoundingClientRect();
            if (r.top < -0.5 || r.bottom > window.innerHeight + 0.5) out.push(`dialog off screen: ${el.className} ${Math.round(r.top)}..${Math.round(r.bottom)}`);
          }
          return out;
        });
        expect.soft(inner, 'no inner scroll and no dialog cut off').toEqual([]);
        const box = await primary.boundingBox();
        expect.soft(m.sh, `scrollHeight ${m.sh} vs innerHeight ${m.ih}`).toBeLessThanOrEqual(m.ih);
        expect.soft(m.sw, `scrollWidth ${m.sw} vs innerWidth ${m.iw}`).toBeLessThanOrEqual(m.iw);
        expect.soft(box, 'primary action has a box').not.toBeNull();
        if (box) {
          expect.soft(box.x, 'primary left').toBeGreaterThanOrEqual(-0.5);
          expect.soft(box.y, 'primary top').toBeGreaterThanOrEqual(-0.5);
          expect.soft(box.x + box.width, 'primary right').toBeLessThanOrEqual(vp.w + 0.5);
          expect.soft(box.y + box.height, `primary bottom (${Math.round(box.y + box.height)} vs ${vp.h})`).toBeLessThanOrEqual(vp.h + 0.5);
        }
      });
    }
  });
}
}
