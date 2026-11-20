import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * welcome-and-tour: the title menu (PLAY, GROWN-UPS, What is Math Quest?), the intro cards, the Grown-ups tour and the rename.
 * Demo family only (Pip a reader, Wren a pre-reader; made-up names, a made-up PIN). Landing screens run on E2E_LANDING_PORT
 * (Firestore mode, nobody signed in); the Grown-ups area runs on the local-data server.
 */
const LANDING = `http://localhost:${Number(process.env.E2E_LANDING_PORT) || 5198}`;
const PIN = '2468';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const SIZES = [
  { w: 393, h: 852 },
  { w: 820, h: 1180 },
];

async function seed(page: Page, family: object = {}) {
  await page.addInitScript(
    ({ pinHash, family }) => {
      if (localStorage.getItem('mathquest:seeded')) return;
      localStorage.setItem('mathquest:seeded', '1');
      const game = { xp: 300, gems: 40, streakDays: 3, lastPlayedDay: null, bestCombo: 5, heroes: ['knight'], hero: 'knight' };
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1, ...family }));
      localStorage.setItem(
        'mathquest:v1:kids',
        JSON.stringify([
          { id: 'kidtour0000000000001', name: 'Pip', createdAt: 1, settings: { modes: { overworld: false }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 12, maxNew: 6, factGroupsUnlocked: 1, paceMultiplier: 3 }, game },
          { id: 'kidtour0000000000002', name: 'Wren', createdAt: 2, settings: { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }, game },
        ]),
      );
    },
    { pinHash: sha(`mathquest:local:${PIN}`), family },
  );
}

async function openGrownUps(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /grown-ups area/i }).click();
  for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await expect(page.locator('.parent')).toBeVisible();
}

const wordsOf = (t: string) => t.replace(/For parents and teachers/g, '');

for (const { w, h } of SIZES) {
  test.describe(`${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('the title menu has PLAY, GROWN-UPS and the intro link at the right sizes, and both buttons lead on', async ({ page }) => {
      await page.goto(LANDING);
      await expect(page.getByTestId('title-menu')).toBeVisible();
      const play = (await page.getByTestId('title-play').boundingBox())!;
      const grown = (await page.getByTestId('title-grownups').boundingBox())!;
      const link = (await page.getByTestId('title-intro').boundingBox())!;
      expect(play.height).toBeGreaterThanOrEqual(120);
      expect(grown.height).toBeGreaterThanOrEqual(72);
      expect(link.height).toBeGreaterThanOrEqual(48);
      if (w >= 460) {
        expect(play.width).toBeGreaterThanOrEqual(419);
        expect(grown.width).toBeGreaterThanOrEqual(419);
      }
      expect(play.y + play.height).toBeLessThan(h);
      expect(link.y + link.height).toBeLessThanOrEqual(h);
      await expect(page.getByTestId('title-play')).toHaveText('PLAY');
      await expect(page.getByTestId('title-grownups')).toHaveText('GROWN-UPS');
      await page.getByTestId('title-play').click();
      await expect(page.getByText("Who's playing?").first()).toBeVisible();
      await page.getByTestId('landing-back').click();
      await page.getByTestId('title-grownups').click();
      await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
      await expect(page.getByText('For parents and teachers')).toBeVisible();
      await expect(page.locator('#landing-tab-parent')).toHaveText('Grown-ups');
    });

    test('What is Math Quest? opens signed out, shows 5 cards with their images, and Get started goes to the grown-up sign-in', async ({ page }) => {
      const outside: string[] = [];
      page.on('request', (r) => {
        // The one allowed call: signinMode (the first-screen switch, no sign-in, no Firestore or Auth host).
        if (!r.url().startsWith(LANDING) && !/^(data|blob):/.test(r.url()) && !/\/signinMode$/.test(r.url())) outside.push(r.url());
      });
      await page.goto(LANDING);
      await page.getByTestId('title-intro').click();
      await expect(page.getByTestId('intro')).toBeVisible();
      for (let i = 0; i < 5; i++) {
        const img = page.getByTestId(`intro-card-${i}`).locator('img');
        await expect.poll(async () => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0), { timeout: 8000 }).toBe(true);
        expect(await img.getAttribute('loading')).toBe('lazy');
        const panel = (await page.locator('.intro-panel').boundingBox())!;
        expect(panel.x).toBeGreaterThanOrEqual(0);
        expect(panel.x + panel.width).toBeLessThanOrEqual(w + 1);
        // The card for this step has scrolled into place.
        await expect.poll(async () => Math.round((await page.getByTestId(`intro-card-${i}`).boundingBox())!.x), { timeout: 5000 }).toBeLessThan(w);
        if (i < 4) await page.getByTestId('intro-next').click();
      }
      await expect(page.getByTestId('intro-start')).toHaveText('Get started');
      await page.getByTestId('intro-start').click();
      await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
      // Static files only: nothing left this origin, so no Firestore or Auth call.
      expect(outside).toEqual([]);
    });

    test('the signed-out title and landing make no Firestore or Auth call (only the signinMode switch)', async ({ page }) => {
      const hosts: string[] = [];
      // signinMode (config/app.signin2 for a signed-out device) is the one Functions call; it reaches no Firestore or Auth host.
      page.on('request', (r) => {
        if (!/\/signinMode$/.test(r.url())) hosts.push(new URL(r.url()).host);
      });
      await page.goto(LANDING);
      await expect(page.getByTestId('title-menu')).toBeVisible();
      await page.getByTestId('title-play').click();
      await page.getByTestId('landing-back').click();
      await page.getByTestId('title-grownups').click();
      await page.waitForTimeout(800);
      const own = new URL(LANDING).host;
      expect(hosts.filter((x) => x !== own)).toEqual([]);
    });

    test('no "Parent" in the text of the landing, the intro or the Grown-ups area', async ({ page }) => {
      await page.goto(LANDING);
      const texts: string[] = [];
      const grab = async () => texts.push(await page.evaluate(() => document.body.innerText));
      await grab();
      await page.getByTestId('title-intro').click();
      for (let i = 0; i < 4; i++) {
        await grab();
        await page.getByTestId('intro-next').click();
      }
      await grab();
      await page.getByTestId('intro-start').click();
      await grab();
      await page.locator('#landing-tab-kid').click();
      await grab();
      for (const t of texts) expect(wordsOf(t)).not.toMatch(/parent/i);
    });
  });
}

test.describe('Grown-ups area', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('says Grown-ups area and Grown-up PIN, and What’s new has no "Parent"', async ({ page }) => {
    await seed(page, { tourSeen: true });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Grown-ups area' })).toBeVisible();
    await page.getByRole('button', { name: 'Grown-ups area' }).click();
    await expect(page.getByRole('heading', { name: 'Grown-up PIN' })).toBeVisible();
    for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
    await expect(page.getByRole('heading', { name: 'Grown-ups area' })).toBeVisible();
    await page.getByRole('button', { name: /what.s new/i }).click();
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/parent/i);
    expect(await page.evaluate(() => [...document.querySelectorAll('[aria-label],[title]')].map((e) => `${e.getAttribute('aria-label')} ${e.getAttribute('title')}`).join(' '))).not.toMatch(/parent/i);
  });
});

for (const { w, h } of SIZES) {
  test.describe(`tour at ${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('is offered once, then the Tour button replays it; it walks the real sections and closes on Escape', async ({ page }) => {
      await seed(page);
      await openGrownUps(page);
      // The first visit offers it.
      await expect(page.getByTestId('tour-offer')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Want a 1-minute tour?' })).toBeVisible();
      await page.getByTestId('tour-offer-no').click();
      await expect(page.getByTestId('tour-offer')).toHaveCount(0);
      // Stored on the Grown-up's own family doc (local data here): offered once.
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mathquest:v1:family')!).tourSeen)).toBe(true);
      await page.goto('/');
      await page.getByRole('button', { name: 'Grown-ups area' }).click();
      for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
      await expect(page.locator('.parent')).toBeVisible();
      await page.waitForTimeout(500);
      await expect(page.getByTestId('tour-offer')).toHaveCount(0);

      // The button always replays it.
      await page.getByTestId('tour-button').click();
      const card = page.getByRole('dialog', { name: /./ }).last();
      await expect(page.getByTestId('tour')).toBeVisible();
      const seen: string[] = [];
      const total = Number((await page.getByTestId('tour-count').innerText()).split(' of ')[1]);
      expect(total).toBeGreaterThanOrEqual(8);
      expect(total).toBeLessThanOrEqual(10);
      for (let i = 0; i < total; i++) {
        await page.waitForTimeout(500);
        seen.push((await page.locator('.tour-card').getAttribute('data-step'))!);
        // The card is on screen, and the spotlight frames a real section inside the viewport.
        const cb = (await page.locator('.tour-card').boundingBox())!;
        expect(cb.x).toBeGreaterThanOrEqual(0);
        expect(cb.x + cb.width).toBeLessThanOrEqual(w);
        expect(cb.y + cb.height).toBeLessThanOrEqual(h);
        // The smooth scroll has settled when the spotlight is inside the viewport.
        await expect.poll(async () => (await page.getByTestId('tour-spot').boundingBox())!.y, { timeout: 5000, message: `spotlight for ${seen.at(-1)}` }).toBeLessThan(h);
        const sb = (await page.getByTestId('tour-spot').boundingBox())!;
        expect(sb.width).toBeGreaterThan(20);
        expect(sb.y).toBeGreaterThanOrEqual(0);
        expect(sb.y).toBeLessThan(h);
        // Targets in the card are at least 48 px.
        for (const b of await page.locator('.tour-card button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(47.5);
        if (i === 2) {
          // Focus stays inside the card.
          for (let k = 0; k < 6; k++) {
            await page.keyboard.press('Tab');
            expect(await page.evaluate(() => !!document.activeElement?.closest('.tour-card'))).toBe(true);
          }
        }
        if (i < total - 1) await page.getByTestId('tour-next').click();
      }
      expect(seen).toContain('pause');
      expect(seen).toContain('progress');
      expect(seen[0]).toBe('kids');
      expect(seen.at(-1)).toBe('version');
      // Back works, Escape closes and puts focus on the Tour button.
      await page.getByTestId('tour-back').click();
      await expect(page.locator('.tour-card')).toHaveAttribute('data-step', seen.at(-2)!);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('tour')).toHaveCount(0);
      await expect(page.getByTestId('tour-button')).toBeFocused();
      void card;
    });

    test('Skip closes it, and a step whose section is missing is left out', async ({ page }) => {
      await seed(page, { tourSeen: true });
      await openGrownUps(page);
      await page.locator('.tabs .tab', { hasText: 'Add player' }).click();
      await page.getByTestId('tour-button').click();
      const total = Number((await page.getByTestId('tour-count').innerText()).split(' of ')[1]);
      expect(total).toBeLessThan(10);
      const steps: string[] = [];
      for (let i = 0; i < total; i++) {
        steps.push((await page.locator('.tour-card').getAttribute('data-step'))!);
        if (i < total - 1) await page.getByTestId('tour-next').click();
      }
      expect(steps).not.toContain('stats');
      expect(steps).not.toContain('settings');
      await page.getByTestId('tour-skip').click();
      await expect(page.getByTestId('tour')).toHaveCount(0);
    });
  });
}

test('the tour makes no outside request and loads no library', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const hosts: string[] = [];
  page.on('request', (r) => hosts.push(new URL(r.url()).host));
  await seed(page, { tourSeen: true });
  await openGrownUps(page);
  await page.getByTestId('tour-button').click();
  await page.getByTestId('tour-next').click();
  const base = new URL(page.url()).host;
  expect(hosts.filter((x) => x !== base)).toEqual([]);
});
