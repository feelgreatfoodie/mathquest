import { describe, expect, it } from 'vitest';
import { gemChangeLabel, gemDeltaText, gemHistory } from './gemHistory';
import type { PurchaseLog, SessionLog } from './models';

const run = (id: string, endedAt: number, gems: number): SessionLog => ({
  id, startedAt: endedAt - 60_000, endedAt, answered: 10, graded: 10, correct: 9, fast: 5, newLearned: 0, medianMs: 2000, xp: 20, gems, bestCombo: 4, missed: [],
});
const buy = (id: string, at: number, heroId: string, cost: number): PurchaseLog => ({ id, heroId, cost, at });

describe('gemHistory', () => {
  it('merges runs (+) and purchases (-), newest first', () => {
    const h = gemHistory([run('s1', 1000, 6), run('s2', 3000, 4)], [buy('p1', 2000, 'wizard', 15)], 20);
    expect(h.map((c) => [c.kind, c.at, c.gems])).toEqual([['run', 3000, 4], ['purchase', 2000, -15], ['run', 1000, 6]]);
    expect(h[1]).toMatchObject({ heroId: 'wizard' });
  });

  it('keeps the newest 20 of a longer list', () => {
    const runs = Array.from({ length: 30 }, (_, i) => run(`s${i}`, 1000 + i, 1));
    const h = gemHistory(runs, [buy('p', 5000, 'robot', 60)], 20);
    expect(h).toHaveLength(20);
    expect(h[0]).toMatchObject({ kind: 'purchase', at: 5000 });
    expect(h[19]!.at).toBe(1000 + 11);
  });

  it('skips runs that earned no gems', () => {
    expect(gemHistory([run('s0', 10, 0)], [], 20)).toEqual([]);
  });

  it('labels a free hero as free and never shows -0', () => {
    const [c] = gemHistory([], [buy('p0', 10, 'knight', 0)], 20);
    expect(gemDeltaText(c!)).toBe('free');
    expect(gemChangeLabel(c!, 'Knight')).toBe('Bought Knight (free)');
    for (const x of [gemDeltaText(c!), gemChangeLabel(c!, 'Knight')]) expect(x).not.toMatch(/[-−]0\b/);
  });

  it('labels a paid purchase with its cost and a run with a plus', () => {
    const [c] = gemHistory([], [buy('p1', 10, 'wizard', 25)], 20);
    expect(gemChangeLabel(c!, 'Wizard')).toBe('Bought Wizard (-25 gems)');
    expect(gemDeltaText(c!)).toBe('-25');
    const [r] = gemHistory([run('s1', 20, 6)], [], 20);
    expect(gemDeltaText(r!)).toBe('+6');
    expect(gemChangeLabel(r!)).toBe('Quest finished');
  });

  it('falls back to the id when the name is unknown', () => {
    const [c] = gemHistory([], [buy('p2', 10, 'mystery', 5)], 20);
    expect(gemChangeLabel(c!)).toBe('Bought mystery (-5 gems)');
  });
});
