import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { newCardState } from '../src/engine/scheduler';
import { INTRO_CARDS, INTRO_IMAGE } from '../src/ui/screens/introCards';

/**
 * Makes public/intro/*.webp for the "What is Math Quest?" cards. Run it with `npm run intro-shots` (needs cwebp from libwebp).
 * The only data is the demo family seeded below (Pip, a reader, and Wren, a pre-reader; made-up names). Each capture's page text
 * is scanned with scripts/check-private-ids.mjs --text, so a real name in a rendered image fails the run. Every image must stay
 * under 150 KB.
 */
const RUN = !!process.env.INTRO_SHOTS;
const OUT = 'public/intro';
const PIN = '2468';
const PIP = 'kidintro00000000001';
const WREN = 'kidintro00000000002';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function cards(): Record<string, unknown> {
  const now = Date.now();
  const out: Record<string, unknown> = {};
  for (let a = 0; a <= 12; a++) {
    for (let b = 0; b <= 12; b++) {
      const k = (a * 7 + b * 3) % 11;
      if (k === 0 || k === 1) continue; // some facts not seen yet
      const c = newCardState(`mul:${a}x${b}`, now);
      c.attempts = 4 + (k % 4);
      c.correct = k === 2 || k === 3 ? 2 : c.attempts;
      c.recentMs = k === 4 ? [6200, 5800, 6500] : [2100 + k * 90, 2300, 1900];
      c.fsrs = { ...c.fsrs, lapses: k === 2 ? 3 : 0, reps: 2 + (k % 5) };
      out[c.id] = c;
    }
  }
  return out;
}

async function seed(page: Page) {
  const now = Date.now();
  const game = (xp: number, gems: number) => ({ xp, gems, streakDays: 4, lastPlayedDay: null, bestCombo: 7, heroes: ['knight', 'wizard'], hero: 'knight' });
  const kids = [
    { id: PIP, name: 'Pip', createdAt: 1, settings: { modes: { overworld: false }, tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 12, maxNew: 6, factGroupsUnlocked: 2, paceMultiplier: 3 }, game: game(1240, 63), hasPin: true },
    { id: WREN, name: 'Wren', createdAt: 2, settings: { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }, game: game(310, 22) },
  ];
  const sessions = Array.from({ length: 6 }, (_, i) => ({
    id: `s-${i}`, startedAt: now - (i + 1) * 3_600_000 * 7, endedAt: now - (i + 1) * 3_600_000 * 7 + 540_000,
    answered: 30, graded: 30, correct: 26 + (i % 3), fast: 12, newLearned: 2, medianMs: 2100, xp: 40, gems: 8, bestCombo: 5, missed: [],
  }));
  await page.addInitScript(
    ({ kids, sessions, cards, pinHash }) => {
      let a = 1234567;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      if (localStorage.getItem('mathquest:seeded')) return;
      localStorage.setItem('mathquest:seeded', '1');
      localStorage.setItem('mathquest:v1:family', JSON.stringify({ pinHash, createdAt: 1, tourSeen: true }));
      localStorage.setItem('mathquest:v1:kids', JSON.stringify(kids));
      for (const k of kids as { id: string }[]) localStorage.setItem(`mathquest:v1:sessions:${k.id}`, JSON.stringify(sessions));
      localStorage.setItem(`mathquest:v1:cards:${(kids as { id: string }[])[0]!.id}`, JSON.stringify(cards));
    },
    { kids, sessions, cards: cards(), pinHash: sha(`mathquest:local:${PIN}`) },
  );
}

test.describe('intro images', () => {
  test.skip(!RUN, 'set INTRO_SHOTS=1 (npm run intro-shots)');
  test.use({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });

  test('capture, scan and convert', async ({ page }) => {
    await seed(page);
    mkdirSync(OUT, { recursive: true });
    const tmp = mkdtempSync(join(tmpdir(), 'mq-intro-'));
    const done: { id: string; png: string; txt: string }[] = [];
    const grab = async (id: string) => {
      await page.waitForTimeout(500);
      const png = join(tmp, `${id}.png`);
      const txt = join(tmp, `${id}.txt`);
      await page.screenshot({ path: png });
      writeFileSync(txt, await page.evaluate(() => document.body.innerText));
      done.push({ id, png, txt });
    };
    const reload = async () => {
      await page.goto('/');
      await page.locator('.kid-card').first().waitFor();
    };

    await reload();
    await page.locator('.kid-card', { hasText: 'Pip' }).click();
    await page.getByRole('button', { name: 'Start Quest' }).waitFor();
    await grab('02-memory');
    await page.getByRole('button', { name: 'Start Quest' }).click();
    await page.locator('.keypad').waitFor();
    await grab('01-adventure');

    await reload();
    await page.locator('.kid-card', { hasText: 'Wren' }).click();
    await page.getByRole('button', { name: 'Play' }).click();
    await page.locator('.early-numerals').waitFor();
    await grab('03-prereaders');

    await reload();
    await page.getByRole('button', { name: /(grown-ups|parent) area/i }).click();
    for (const d of PIN) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click();
    await page.locator('.parent').waitFor();
    await page.locator('.tabs .tab', { hasText: 'Pip' }).click();
    await page.locator('[data-testid^="ins-module-"] summary').first().click();
    await page.evaluate(() => document.querySelector('[data-testid="insights"]')?.scrollIntoView({ block: 'start' }));
    await grab('04-grownups');
    await page.evaluate(() => document.querySelector('.settings')?.scrollIntoView({ block: 'start' }));
    await grab('05-private');

    for (const d of done) {
      const scan = spawnSync('node', ['scripts/check-private-ids.mjs', '--text', d.txt], { encoding: 'utf8' });
      if (scan.status !== 0) throw new Error(`name scan failed on ${d.id}: ${scan.stdout}${scan.stderr}`);
    }
    for (const c of INTRO_CARDS) {
      const d = done.find((x) => c.file.startsWith(x.id))!;
      const out = join(OUT, c.file);
      execFileSync('cwebp', ['-quiet', '-q', '72', '-resize', String(INTRO_IMAGE.width), String(INTRO_IMAGE.height), d.png, '-o', out]);
      const kb = statSync(out).size / 1024;
      console.log(`${c.file} ${kb.toFixed(1)} KB`);
      if (kb >= 150) throw new Error(`${c.file} is ${kb.toFixed(1)} KB, over 150`);
    }
  });
});
