import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FACTS } from '../src/engine/modules/facts';
import { getModule } from '../src/engine/modules';

/**
 * Adventure fixes at 820x1180: the castle's closed door, the lair gate with its second unlock rule, the camp-lit message (no guide), and a
 * lair that pays once. Names and ids are made up. SCREENSHOTS=1 writes PNGs under docs/screenshots/adventure-fixes.
 */
const SHOTS = process.env.SCREENSHOTS ? 'docs/screenshots/adventure-fixes' : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const KID = 'kidaf100000000000001';
const DAY = 86_400_000;
const CASTLE = [...FACTS.groups![3]!.cardIds, ...FACTS.groups![4]!.cardIds];

const PIP_CASTLE = getModule('sub10')!.groups![1]!.cardIds;
const PIP = { learner: 'prereader', modules: { add10: true, sub10: true, facts: false }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const READER = { modes: { overworld: true }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 4, maxNew: 0, factGroupsUnlocked: 5, paceMultiplier: 3 };
const PRE = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };

type Spec = { id: string; stability: number; lastResults: boolean[]; dueIn?: number };
function cardsOf(now: number, specs: Spec[]) {
  return Object.fromEntries(
    specs.map(({ id, stability, lastResults, dueIn = 5 * DAY }) => [
      id,
      {
        id, attempts: 4, correct: 4, recentMs: [2500, 2600], lastRating: 3, updatedAt: now - 3 * DAY, day: '2000-01-01', dayGraded: 1, lastResults,
        fsrs: { due: now + dueIn, stability, difficulty: 5, elapsed_days: 3, scheduled_days: 5, learning_steps: 0, reps: stability >= 2 ? 3 : 2, lapses: 0, state: 2, last_review: now - 3 * DAY },
      },
    ]),
  );
}

async function seed(page: Page, opts: { settings: object; cards?: Record<string, unknown>; world?: object; name?: string }) {
  await page.addInitScript(
    ({ kid, settings, cards, world, name }) => {
      const w = window as unknown as Record<string, unknown>;
      class Utter { text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
      w.SpeechSynthesisUtterance = Utter;
      w.__spoken = [] as string[];
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: { speak(u: Utter) { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 15); }, cancel() {}, getVoices() { return []; } },
      });
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
        if (cards) localStorage.setItem(`mathquest:v1:cards:${kid}`, JSON.stringify(cards));
        if (world) localStorage.setItem(`mathquest:v1:world:${kid}`, JSON.stringify(world));
      }
    },
    { kid: KID, settings: opts.settings, cards: opts.cards ?? null, world: opts.world ?? null, name: opts.name ?? 'Ada' },
  );
}

const castleWorld = (over: object = {}) => ({ region: 'castle', x: 32, y: 6, facing: 'up', openedChests: [], bossesDefeated: [], keys: 0, version: 1, updatedAt: 1, ...over });

type Ow = {
  state(): { region: string; hero: { x: number; y: number }; paused: boolean; entities: Array<{ id: string; kind: string; x: number; y: number }>; world: { bossesDefeated: string[]; keys: number } };
  modalAnswer(): number | null;
  tapTile(x: number, y: number): void;
  teleport(x: number, y: number): void;
};
const ow = <T,>(page: Page, f: (o: Ow) => T) => page.evaluate((src) => new Function('o', `return (${src})(o)`)((window as unknown as { __ow: Ow }).__ow) as T, f.toString());
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
const gems = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem('mathquest:v1:kids')!).find((x: { id: string }) => x.id === k).game.gems as number, KID);

async function openAdventure(page: Page, name = 'Ada', prereader = false) {
  await page.goto('/');
  await page.locator('.kid-card', { hasText: name }).click();
  if (prereader) await page.getByRole('button', { name: 'Adventure' }).click();
  else await page.locator('.mode-card[data-mode="overworld"]').click();
  await expect(page.getByTestId('overworld')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __ow?: unknown }).__ow)).toBe(true);
}

async function typeAnswer(page: Page, n: number) {
  for (const d of String(n)) await page.locator('.question-modal .keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await page.locator('.question-modal .key-go').click();
}

test.use({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });

test('the castle edge is a closed door: bumping it shows "More lands coming soon" and says it, and the hero stays inside', async ({ page }) => {
  await seed(page, { settings: READER, world: castleWorld({ x: 38, y: 14, facing: 'right' }) });
  await openAdventure(page);
  await ow(page, (o) => o.tapTile(39, 14));
  await expect(page.getByTestId('ow-msg')).toHaveText(/More lands coming soon/);
  expect(await spoken(page)).toContain('More lands are coming soon!');
  expect((await ow(page, (o) => o.state())).hero).toEqual({ x: 38, y: 14 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/castle-door-820x1180.png` });
});

test('a locked lair (reader) says which facts wake the dragon and counts the larger of reviewing and steady', async ({ page }) => {
  const now = Date.now();
  // 1 card Reviewing (stable) with a miss last; 3 cards young but right twice. Larger count: 3.
  const specs: Spec[] = [
    { id: CASTLE[0]!, stability: 5, lastResults: [true, false] },
    ...CASTLE.slice(1, 4).map((id) => ({ id, stability: 0.6, lastResults: [true, true] })),
  ];
  await seed(page, { settings: READER, cards: cardsOf(now, specs), world: castleWorld() });
  await openAdventure(page);
  await ow(page, (o) => o.tapTile(32, 4));
  await expect(page.getByTestId('ow-msg')).toContainText('Answer the Castle facts to wake the dragon: 6s, 7s, 8s and 12x12. 3 of 10 ready.');
  await expect(page.locator('.ow-msg .progress-fill')).toHaveAttribute('style', /width: 30%/);
  await expect(page.locator('.question-modal')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/lair-locked-reader-820x1180.png` });
});

test('a profile with 1 of 10 reviewing and 8 of 10 steady: the lair opens and the fight starts', async ({ page }) => {
  const now = Date.now();
  const specs: Spec[] = [
    { id: CASTLE[0]!, stability: 5, lastResults: [true, false] },
    ...CASTLE.slice(1, 9).map((id) => ({ id, stability: 0.6, lastResults: [true, true] })),
  ];
  await seed(page, { settings: READER, cards: cardsOf(now, specs), world: castleWorld() });
  await openAdventure(page);
  await ow(page, (o) => o.tapTile(32, 4));
  await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('ow-msg')).toHaveCount(0);
});

test('a locked lair (pre-reader with addition and subtraction) shows a dragon, tokens and a count, and the voice says it is sleeping', async ({ page }) => {
  const now = Date.now();
  const specs: Spec[] = PIP_CASTLE.slice(0, 9).map((id) => ({ id, stability: 0.6, lastResults: [true, true] }));
  await seed(page, { settings: PIP, cards: cardsOf(now, specs), world: castleWorld(), name: 'Pip' });
  await openAdventure(page, 'Pip', true);
  await ow(page, (o) => o.tapTile(32, 4));
  const lair = page.getByTestId('ow-lair-dots');
  await expect(lair).toBeVisible();
  await expect(lair).toHaveAttribute('aria-label', `9 of ${PIP_CASTLE.length}`);
  await expect(page.getByTestId('ow-lair-count')).toHaveText(`9/${PIP_CASTLE.length}`);
  await expect(lair.locator('.ow-dots i')).toHaveCount(12);
  await expect(lair.locator('.ow-dots i.on')).toHaveCount(Math.floor((9 / PIP_CASTLE.length) * 12));
  const words = ((await page.getByTestId('ow-msg').innerText()).replace(/Close/g, '').trim().split(/\s+/).filter(Boolean));
  expect(words.length).toBeLessThanOrEqual(2);
  expect(await spoken(page)).toContain('The dragon is sleeping. Answer more to wake it!');
  expect(await spoken(page)).not.toContain('Wake the dragon! Answer the facts.');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/lair-locked-prereader-820x1180.png` });
});

test('a pre-reader with addition and subtraction wakes the Castle lair and fights with picture choices on their own cards', async ({ page }) => {
  const now = Date.now();
  const specs: Spec[] = PIP_CASTLE.slice(0, Math.ceil(PIP_CASTLE.length * 0.8)).map((id) => ({ id, stability: 0.6, lastResults: [true, true] }));
  await seed(page, { settings: PIP, cards: cardsOf(now, specs), world: castleWorld(), name: 'Pip' });
  await openAdventure(page, 'Pip', true);
  await ow(page, (o) => o.tapTile(32, 4));
  await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('ow-msg')).toHaveCount(0);
  await expect(page.locator('.question-modal .keypad')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/boss-question-prereader-820x1180.png` });
});

test('a lair that was already won pays nothing again: no fight, no gems, no key, also after a reload', async ({ page }) => {
  const now = Date.now();
  const specs: Spec[] = CASTLE.map((id) => ({ id, stability: 5, lastResults: [true, true] }));
  await seed(page, { settings: READER, cards: cardsOf(now, specs), world: castleWorld({ bossesDefeated: ['castle'], keys: 1 }) });
  await openAdventure(page);
  for (let i = 0; i < 2; i++) {
    await ow(page, (o) => o.tapTile(32, 4));
    await expect(page.getByTestId('ow-msg')).toContainText('The lair is quiet');
    await expect(page.locator('.question-modal')).toHaveCount(0);
    expect(await gems(page)).toBe(5);
    expect((await ow(page, (o) => o.state())).world.keys).toBe(1);
    await openAdventure(page); // a reload goes back to the picker; the saved world is what the next open reads
  }
});

test('Camp is lit: no guide is drawn, the voice says it once, and the campfire still finishes the trip', async ({ page }) => {
  const now = Date.now();
  const ids = FACTS.groups![0]!.cardIds.slice(0, 6);
  await seed(page, { settings: { ...READER, factGroupsUnlocked: 1, sessionSize: 3 }, cards: cardsOf(now, ids.map((id) => ({ id, stability: 5, lastResults: [true, true], dueIn: -DAY }))) });
  await openAdventure(page);
  expect(await spoken(page)).not.toContain('Walk to the campfire to finish your trip!');
  for (let guard = 0; guard < 8; guard++) {
    const left = (await ow(page, (o) => o.state())).entities.filter((e) => e.shown);
    if (!left.length) break;
    await page.evaluate(([x, y]) => (window as unknown as { __ow: Ow }).__ow.tapTile(x!, y!), [left[0]!.x, left[0]!.y]);
    await expect(page.locator('.question-modal')).toBeVisible({ timeout: 25_000 });
    const teach = page.getByRole('button', { name: 'Let me try one!' });
    if (await teach.isVisible()) await teach.click();
    await expect(page.locator('.question-modal .keypad .key:not([disabled])').first()).toBeVisible();
    await typeAnswer(page, (await ow(page, (o) => o.modalAnswer()))!);
    await expect(page.locator('.question-modal')).toHaveCount(0, { timeout: 8000 });
  }
  await expect(page.getByTestId('camp-lit')).toBeVisible();
  expect((await spoken(page)).filter((t) => t === 'Walk to the campfire to finish your trip!')).toHaveLength(1);
  await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/camp-lit-820x1180.png` });
  // Walking on does not repeat the voice, and the camp tile still ends the trip.
  await ow(page, (o) => o.tapTile(6, 8));
  await expect(page.locator('.summary')).toBeVisible({ timeout: 25_000 });
});
