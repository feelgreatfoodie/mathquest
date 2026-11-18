import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Picture PIN on the Kid tab, 820x1180 touch, system Chrome. The real Landing runs on the test page (e2e/harness/pin.html) with a
 * fake sign-in, so no Firebase and no network. The device cache is seeded the way App.tsx writes it after a sign-in. Names are
 * made up. SCREENSHOTS=1 writes PNGs under docs/screenshots/picture-pin/.
 */
test.use({ viewport: { width: 820, height: 1180 } });
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/picture-pin' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const FACES = [
  { kidId: 'kid-pip', name: 'Pip', hero: 'knight', color: 'blue', picture: true },
  { kidId: 'kid-maya', name: 'Maya', hero: 'wizard', color: 'pink' },
];
async function seedFaces(page: Page, faces: object[] = FACES) {
  await page.addInitScript((f) => {
    localStorage.setItem('mathquest:v1:device-kids', JSON.stringify(f));
    const w = window as unknown as Record<string, unknown>;
    w.__spoken = [] as string[];
    class Utter { text: string; lang = ''; rate = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
    w.SpeechSynthesisUtterance = Utter;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 10); }, cancel() {}, getVoices() { return []; } } });
  }, faces);
}
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
/** Every request the page makes to anything but itself. A signed-out device must make none until a kid taps and signs in. */
function watchNetwork(page: Page) {
  const out: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:')) out.push(u);
  });
  return out;
}

test('a device that has seen the family shows hero faces from its own cache and makes no network request', async ({ page }) => {
  const net = watchNetwork(page);
  await seedFaces(page);
  await page.goto('/e2e/harness/pin.html?mode=kid');
  await expect(page.getByTestId('face-grid')).toBeVisible();
  await expect(page.locator('.face-btn')).toHaveCount(2);
  await expect(page.locator('.face-btn[data-kid="kid-pip"]')).toHaveAttribute('data-hero', 'knight');
  await expect(page.locator('.face-btn[data-kid="kid-maya"]')).toHaveAttribute('data-hero', 'wizard');
  for (const b of await page.locator('.face-btn').all()) {
    const box = (await b.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(120);
    expect(box.height).toBeGreaterThanOrEqual(120);
  }
  await shot(page, 'kid-tab-faces');
  expect(net).toEqual([]);
  expect(await calls(page)).toEqual([]);
});

test('a device that never signed in has no faces: the typed name form shows and nothing is listed', async ({ page }) => {
  const net = watchNetwork(page);
  await page.goto('/e2e/harness/pin.html?mode=kid');
  await expect(page.getByPlaceholder('First name')).toBeVisible();
  await expect(page.getByTestId('face-grid')).toHaveCount(0);
  await expect(page.locator('.face-btn')).toHaveCount(0);
  expect(net).toEqual([]);
});

test('a kid with a picture PIN: tap the face, the picture pad is text-free with 120 px targets, 4 taps sign in once', async ({ page }) => {
  await seedFaces(page);
  await page.goto('/e2e/harness/pin.html?mode=kid');
  await page.locator('.face-btn[data-kid="kid-pip"]').tap();
  const pad = page.getByTestId('picture-pad');
  await expect(pad).toBeVisible();
  expect((await pad.innerText()).trim()).toBe('');
  await expect(page.locator('.picture-key[data-icon]')).toHaveCount(9);
  for (const b of await pad.locator('button').all()) {
    const box = (await b.boundingBox())!;
    expect(box.width, 'width').toBeGreaterThanOrEqual(120);
    expect(box.height, 'height').toBeGreaterThanOrEqual(120);
  }
  await shot(page, 'picture-pad');
  const key = (n: number) => page.locator(`.picture-key[data-icon="${n}"]`);
  await key(0).tap();
  await key(3).tap();
  await expect(page.locator('.picture-slots')).toHaveAttribute('data-count', '2');
  await shot(page, 'picture-pad-two-picked');
  await key(6).tap();
  await key(1).tap();
  await expect.poll(() => calls(page)).toEqual(['Pip:adgb']);
  await expect.poll(async () => (await spoken(page)).slice(0, 4)).toEqual(['Cat', 'Bird', 'Rabbit', 'Dog']);
});

test('repeats are allowed, a wrong picture shakes and clears, and the pad takes another try', async ({ page }) => {
  await seedFaces(page);
  await page.goto('/e2e/harness/pin.html?mode=kid');
  await page.locator('.face-btn[data-kid="kid-pip"]').tap();
  for (let i = 0; i < 4; i++) await page.locator('.picture-key[data-icon="8"]').tap();
  await expect.poll(() => calls(page)).toEqual(['Pip:iiii']);
  await expect(page.locator('.picture-slots')).toHaveAttribute('data-count', '0');
  await expect(page.locator('.picture-slots.shake')).toHaveCount(1);
  await expect(page.locator('.error')).toBeVisible();
  await shot(page, 'picture-pad-wrong');
  for (const n of [4, 4, 4, 4]) await page.locator(`.picture-key[data-icon="${n}"]`).tap();
  await expect.poll(() => calls(page)).toEqual(['Pip:iiii', 'Pip:eeee']);
});

test('the back key removes the last picture, and Not me returns to the faces', async ({ page }) => {
  await seedFaces(page);
  await page.goto('/e2e/harness/pin.html?mode=kid');
  await page.locator('.face-btn[data-kid="kid-pip"]').tap();
  await page.locator('.picture-key[data-icon="2"]').tap();
  await page.locator('.picture-key[data-icon="5"]').tap();
  await page.locator('.picture-back').tap();
  await expect(page.locator('.picture-slots')).toHaveAttribute('data-count', '1');
  await page.locator('.picture-cancel').tap();
  await expect(page.getByTestId('face-grid')).toBeVisible();
  expect(await calls(page)).toEqual([]);
});

test('a kid with no picture PIN opens the digit pad under their own name (no name field), and Type a name instead shows the form', async ({ page }) => {
  await seedFaces(page);
  await page.goto('/e2e/harness/pin.html?mode=kid');
  await page.locator('.face-btn[data-kid="kid-maya"]').tap();
  await expect(page.getByTestId('picture-pad')).toHaveCount(0);
  await expect(page.locator('.keypad')).toBeVisible();
  await expect(page.locator('h2')).toContainText('Maya');
  for (const d of '1357') await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).tap();
  await expect.poll(() => calls(page)).toEqual(['Maya:1357']);
  await page.reload();
  await page.getByRole('button', { name: 'Type a name instead' }).tap();
  await expect(page.getByPlaceholder('First name')).toBeVisible();
  await shot(page, 'typed-form-with-faces-cached');
});
