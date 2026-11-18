import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './models';
import { mulberry32 } from './problems';
import { SessionRunner, type PlanItem } from './session';

// The run's progress bar counts graded entries only. A retry is spliced into the queue after a miss, so the old
// bar (position over a growing length) moved backwards. This pins the new bar: it never decreases, ends at 1,
// and a retry never moves it.
const PLAN: PlanItem[] = ['mul:2x3', 'mul:7x8', 'mul:6x9', 'mul:4x4', 'mul:5x7', 'mul:3x8', 'mul:9x9', 'mul:6x7'].map((cardId) => ({ cardId, isNew: false }));

function play(seed: number, missRate: number) {
  const rng = mulberry32(seed);
  let t = 0;
  const runner = new SessionRunner(PLAN, {}, mulberry32(seed + 1), () => t, DEFAULT_SETTINGS);
  const prog = (): number => (runner as unknown as { progress?: () => number }).progress?.() ?? NaN;
  const seen: number[] = [prog()];
  const old: number[] = [runner.position / Math.max(1, runner.length)];
  let guard = 0;
  while (!runner.done() && guard++ < 500) {
    const e = runner.current()!;
    t += 1000;
    if (e.kind === 'teach') runner.acknowledge();
    else {
      const right = e.problem.answer.kind === 'int' ? e.problem.answer.value : 0;
      runner.answer({ kind: 'int', value: rng() < missRate ? right + 1 : right }, 600 + Math.floor(rng() * 9000));
      // The screen draws the bar here, with the feedback showing and a retry already spliced in.
      seen.push(prog());
      old.push(runner.position / Math.max(1, runner.length));
      runner.advance();
    }
    seen.push(prog());
    old.push(runner.position / Math.max(1, runner.length));
  }
  return { seen, old, runner };
}

describe('run progress', () => {
  it('never decreases over 300 random answer sequences with retries, and ends at 1', () => {
    let retriesSeen = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { seen, runner } = play(seed, [0, 0.3, 0.6, 0.9][seed % 4]!);
      for (let i = 1; i < seen.length; i++) expect(seen[i]!, `seed ${seed} step ${i}`).toBeGreaterThanOrEqual(seen[i - 1]!);
      expect(seen[seen.length - 1]).toBe(1);
      expect(seen.every((p) => p >= 0 && p <= 1)).toBe(true);
      retriesSeen += runner.queue.filter((e) => e.kind === 'practice' && !e.fill).length;
    }
    expect(retriesSeen).toBeGreaterThan(100);
  });

  it('the old position-over-length bar does go backwards on a missed answer (the bar is drawn after the answer, when the retry has lengthened the queue)', () => {
    const dropped = Array.from({ length: 60 }, (_, i) => play(i + 1, 0.6).old).some((o) => o.some((v, i) => i > 0 && v < o[i - 1]!));
    expect(dropped).toBe(true);
  });
});
