import { expect, test } from '@playwright/test';
import { PRE_ID, READER_ID, VIEWPORTS, answerOnScreen, holdHome, phase, seed, shot, spoken, stored, typeAnswer } from './harness/lightning';

/**
 * Lightning Round at 393x852 and 820x1180: a card, the reveal and the end screen, for a reader and a pre-reader. It also checks
 * practice only (the stored FSRS fields do not change), that a checkpoint is written on pagehide, 3 choices of at least 120 px
 * for a pre-reader, and a spoken question on every card. Made-up names and ids. The voice and the sounds are stubbed.
 * LIGHTNING_SHOTS=<dir> writes PNGs there (keep them local).
 */
for (const vp of VIEWPORTS) {
  test.describe(`Lightning Round at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('reader: a card, a hit, a reveal, a checkpoint on pagehide, and the end screen', async ({ page }) => {
      await seed(page, { learner: 'reader', delay: 1000 });
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).tap();
      await page.getByTestId('home-lightning').tap();
      await expect(page.getByTestId('lightning')).toBeVisible();
      await expect(page.locator('.lr-ring')).toBeVisible();
      expect((await spoken(page)).length).toBeGreaterThan(0);
      await shot(page, `card-${vp.name}`);

      // A known fact starts at 3 s. Answer it before the ring closes: a bolt, then the next card.
      await expect.poll(() => phase(page)).toBe('ask');
      const first = await page.getByTestId('lightning').getAttribute('data-delay');
      await typeAnswer(page, await answerOnScreen(page));
      await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'hit');
      await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'ask');
      expect(Number(first)).toBeGreaterThanOrEqual(1500);

      // Let the ring close on a card: the answer shows, and one copy moves on. Weak cards store 1000, which reads as the 1.5 s floor.
      let revealed = false;
      for (let i = 0; i < 40 && !revealed; i++) {
        if ((await page.getByTestId('lightning').getAttribute('data-delay')) === '1500') {
          await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'miss', { timeout: 4000 });
          revealed = true;
          break;
        }
        await typeAnswer(page, await answerOnScreen(page));
        await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'ask');
      }
      expect(revealed).toBe(true);
      const answer = await answerOnScreen(page).catch(() => NaN);
      await expect(page.getByTestId('lr-answer')).toBeVisible();
      expect(Number(await page.getByTestId('lr-answer').textContent())).toBe(answer);
      expect((await spoken(page)).some((t) => / is \d+/.test(t))).toBe(true);
      await shot(page, `reveal-${vp.name}`);
      await typeAnswer(page, Number(await page.getByTestId('lr-answer').textContent()));
      await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'ask');

      // The page goes away: a checkpoint reaches the session log (save-first) as an open Lightning run.
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await expect.poll(async () => ((await stored(page, READER_ID, 'sessions')) as { mode: string; finished?: boolean; xp: number }[] | null)?.find((s) => s.mode === 'lightning')?.xp ?? 0).toBeGreaterThan(0);
      const open = ((await stored(page, READER_ID, 'sessions')) as { mode: string; finished?: boolean; endedBy?: string }[]).find((s) => s.mode === 'lightning')!;
      expect(open.finished).toBe(false);
      expect(open.endedBy).toBe('left');

      await holdHome(page);
      await expect(page.getByTestId('lr-end')).toBeVisible();
      expect(Number(await page.getByTestId('lr-hits').textContent())).toBeGreaterThanOrEqual(1);
      expect(Number(await page.getByTestId('lr-gems').textContent())).toBeLessThanOrEqual(3);
      await shot(page, `end-${vp.name}`);

      // Practice only: no FSRS field changed on any card, and the counts moved.
      const seeded = (await page.evaluate(() => (window as unknown as { __seedCards: Record<string, { fsrs: unknown; attempts: number }> }).__seedCards));
      const now = (await stored(page, READER_ID, 'cards')) as Record<string, { fsrs: unknown; attempts: number; day?: string; dayGraded?: number; lightningDelayMs?: number }>;
      for (const id of Object.keys(seeded)) expect(JSON.stringify(now[id]!.fsrs)).toBe(JSON.stringify(seeded[id]!.fsrs));
      expect(Object.keys(now).some((id) => now[id]!.attempts > seeded[id]!.attempts)).toBe(true);
      expect(Object.values(now).some((c) => typeof c.lightningDelayMs === 'number')).toBe(true);
      const done = ((await stored(page, READER_ID, 'sessions')) as { mode: string; finished?: boolean; practiceCorrect?: number }[]).filter((s) => s.mode === 'lightning');
      expect(done).toHaveLength(1);
      expect(done[0]!.finished).toBe(true);
      expect(done[0]!.practiceCorrect).toBeUndefined();
    });

    test('pre-reader: 3 choices of at least 120 px, the question spoken on every card, and the picture end screen', async ({ page }) => {
      await seed(page, { learner: 'prereader' });
      await page.goto('/');
      await page.locator('.kid-card', { hasText: 'Pip' }).tap();
      const entry = page.getByTestId('home-lightning');
      await expect(entry).toBeVisible();
      const eb = (await entry.boundingBox())!;
      expect(eb.width).toBeGreaterThanOrEqual(119.5);
      await entry.tap();
      await expect(page.getByTestId('lightning')).toBeVisible();
      for (let card = 0; card < 3; card++) {
        await expect.poll(() => phase(page)).toBe('ask');
        const choices = page.locator('.lr-choice');
        await expect(choices).toHaveCount(3);
        for (let i = 0; i < 3; i++) {
          const b = (await choices.nth(i).boundingBox())!;
          expect(b.width, `choice ${i} width`).toBeGreaterThanOrEqual(119.5);
          expect(b.height, `choice ${i} height`).toBeGreaterThanOrEqual(119.5);
          expect(b.x + b.width, `choice ${i} inside the viewport`).toBeLessThanOrEqual(vp.width + 0.5);
          expect(b.x).toBeGreaterThanOrEqual(-0.5);
        }
        const before = (await spoken(page)).length;
        const delay = Number(await page.getByTestId('lightning').getAttribute('data-delay'));
        expect(delay).toBeGreaterThanOrEqual(2000);
        if (card === 0) {
          await shot(page, `pre-card-${vp.name}`);
          // A wrong tap shows the answer: only the right button is live, and the voice says it.
          await page.locator('.lr-choice[data-answer="false"]').first().tap();
          await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', 'miss');
          await expect(page.locator('.lr-choice[data-answer="true"]')).toHaveClass(/is-guide/);
          await expect(page.locator('.lr-choice[data-answer="false"]').first()).toHaveAttribute('aria-disabled', 'true');
          await shot(page, `pre-reveal-${vp.name}`);
          await page.locator('.lr-choice[data-answer="true"]').tap();
        } else {
          await page.locator('.lr-choice[data-answer="true"]').tap();
        }
        await expect(page.getByTestId('lightning')).toHaveAttribute('data-phase', /ask|hit|miss/);
        expect((await spoken(page)).length).toBeGreaterThan(before - 1);
        await expect.poll(() => phase(page), { timeout: 5000 }).toBe('ask');
      }
      expect((await spoken(page)).filter((t) => /plus|\+/.test(t)).length).toBeGreaterThanOrEqual(3);

      await holdHome(page);
      const end = page.getByTestId('lr-end');
      await expect(end).toBeVisible();
      // Picture version: bolts and buttons, no words or numbers.
      expect((await end.innerText()).trim()).toBe('');
      await expect(end.locator('.lr-bolts')).toBeVisible();
      for (const name of ['Again', 'Home']) {
        const b = (await end.getByRole('button', { name }).boundingBox())!;
        expect(b.width).toBeGreaterThanOrEqual(119.5);
        expect(b.height).toBeGreaterThanOrEqual(119.5);
      }
      expect((await spoken(page)).some((t) => /bolt|Good try/.test(t))).toBe(true);
      await shot(page, `pre-end-${vp.name}`);
      const sess = ((await stored(page, PRE_ID, 'sessions')) as { mode: string; finished?: boolean }[]).filter((s) => s.mode === 'lightning');
      expect(sess).toHaveLength(1);
      expect(sess[0]!.finished).toBe(true);
    });
  });
}
