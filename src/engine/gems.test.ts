import { describe, expect, it } from 'vitest';
import { GEM_RUN_MAX, earnedTodayOf, gemFullRateOf, gemSpeedOf, gemTier, gemsForRun, throttledGems, type GemRunStats } from './gems';
import { DEFAULT_GAME } from './models';

// Every number here is made up. The throttle rule: full rate below the threshold, half from the threshold to
// twice the threshold, a quarter after. Defaults: reader 25, pre-reader 15. Round down, at least 1 when 1+ correct.
const run = (over: Partial<GemRunStats> = {}): GemRunStats => ({ correct: 27, graded: 30, bestCombo: 8, newLearned: 0, ...over });

describe('gemsForRun: the base rate', () => {
  it('reader: 1 per 3 correct, +3 for a combo of 10, +2 for 3 new facts, +2 for a perfect run', () => {
    expect(gemsForRun(run(), 'reader', {}, 0)).toBe(9);
    expect(gemsForRun(run({ bestCombo: 10 }), 'reader', {}, 0)).toBe(10); // 9 + 3 = 12, capped at 10
    expect(gemsForRun(run({ correct: 21, bestCombo: 5 }), 'reader', {}, 0)).toBe(7);
    expect(gemsForRun(run({ correct: 21, bestCombo: 10 }), 'reader', {}, 0)).toBe(10);
    expect(gemsForRun(run({ correct: 15, bestCombo: 3, newLearned: 3 }), 'reader', {}, 0)).toBe(7); // 5 + 2
    expect(gemsForRun(run({ correct: 30, bestCombo: 3 }), 'reader', {}, 0)).toBe(10); // 10 + 2 perfect, capped
  });

  it('pre-reader: 1 per 2 correct, +1 for a perfect run', () => {
    expect(gemsForRun(run({ correct: 12, graded: 15, bestCombo: 12 }), 'prereader', {}, 0)).toBe(6);
    expect(gemsForRun(run({ correct: 13, graded: 15 }), 'prereader', {}, 0)).toBe(6);
    expect(gemsForRun(run({ correct: 15, graded: 15 }), 'prereader', {}, 0)).toBe(8);
    expect(gemsForRun(run({ correct: 15, graded: 15, newLearned: 9, bestCombo: 15 }), 'prereader', {}, 0)).toBe(8); // no combo or new-fact bonus
  });

  it('a run never earns more than GEM_RUN_MAX (10), at any speed', () => {
    expect(GEM_RUN_MAX).toBe(10);
    const big = run({ correct: 60, graded: 60, bestCombo: 60, newLearned: 20 });
    expect(gemsForRun(big, 'reader', { gemSpeed: 1.5 }, 0)).toBe(10);
    expect(gemsForRun(big, 'prereader', { gemSpeed: 1.5 }, 0)).toBe(10);
  });

  it('a run with no correct answer earns 0; one correct answer earns at least 1 at every tier and speed', () => {
    expect(gemsForRun(run({ correct: 0, bestCombo: 0 }), 'reader', {}, 0)).toBe(0);
    for (const earned of [0, 30, 80, 500]) {
      for (const gemSpeed of [0.5, 1, 1.5]) {
        expect(gemsForRun(run({ correct: 1, bestCombo: 1 }), 'reader', { gemSpeed }, earned)).toBeGreaterThanOrEqual(1);
        expect(gemsForRun(run({ correct: 1, graded: 15, bestCombo: 1 }), 'prereader', { gemSpeed }, earned)).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('gemsForRun: the soft throttle', () => {
  it('reader tiers change at 25 and 50 earned today', () => {
    const r = run(); // base 9
    expect(gemsForRun(r, 'reader', {}, 0)).toBe(9);
    expect(gemsForRun(r, 'reader', {}, 24)).toBe(9);
    expect(gemsForRun(r, 'reader', {}, 25)).toBe(4); // half, rounded down
    expect(gemsForRun(r, 'reader', {}, 49)).toBe(4);
    expect(gemsForRun(r, 'reader', {}, 50)).toBe(2); // quarter, rounded down
    expect(gemsForRun(r, 'reader', {}, 400)).toBe(2);
  });

  it('pre-reader tiers change at 15 and 30 earned today', () => {
    const r = run({ correct: 12, graded: 15 }); // base 6
    expect(gemsForRun(r, 'prereader', {}, 14)).toBe(6);
    expect(gemsForRun(r, 'prereader', {}, 15)).toBe(3);
    expect(gemsForRun(r, 'prereader', {}, 29)).toBe(3);
    expect(gemsForRun(r, 'prereader', {}, 30)).toBe(1); // 6 / 4 = 1.5 rounds down
  });

  it('never hard-stops: a run after the quarter tier still earns at least 1', () => {
    expect(gemsForRun(run({ correct: 3, bestCombo: 2 }), 'reader', {}, 900)).toBe(1);
    expect(gemsForRun(run({ correct: 12, graded: 15 }), 'prereader', {}, 900)).toBe(1);
  });

  it('gemTier names the tier from the amount earned today', () => {
    expect(gemTier(0, 'reader', {})).toBe('full');
    expect(gemTier(24, 'reader', {})).toBe('full');
    expect(gemTier(25, 'reader', {})).toBe('half');
    expect(gemTier(50, 'reader', {})).toBe('quarter');
    expect(gemTier(14, 'prereader', {})).toBe('full');
    expect(gemTier(15, 'prereader', {})).toBe('half');
    expect(gemTier(30, 'prereader', {})).toBe('quarter');
  });

  it('a sequence of 12 identical runs: full, then half, then a quarter, with a running total that keeps growing', () => {
    let earned = 0;
    const got: number[] = [];
    for (let i = 0; i < 12; i++) {
      const g = gemsForRun(run(), 'reader', {}, earned);
      got.push(g);
      earned += g;
    }
    expect(got).toEqual([9, 9, 9, 4, 4, 4, 4, 4, 4, 2, 2, 2]); // 27 after 3 runs; 27 to 47 at half; 51 and up at a quarter
    expect(earned).toBe(57);
  });
});

describe('gemsForRun: parent settings', () => {
  it('Gem speed scales the base before the throttle: Slow 0.5, Normal 1, Fast 1.5', () => {
    expect(gemsForRun(run(), 'reader', { gemSpeed: 0.5 }, 0)).toBe(4); // 9 * 0.5
    expect(gemsForRun(run(), 'reader', { gemSpeed: 1 }, 0)).toBe(9);
    expect(gemsForRun(run(), 'reader', { gemSpeed: 1.5 }, 0)).toBe(10); // 13.5 capped
    expect(gemsForRun(run({ correct: 12 }), 'reader', { gemSpeed: 1.5 }, 0)).toBe(6); // base 4 * 1.5
    expect(gemsForRun(run(), 'reader', { gemSpeed: 1.5 }, 25)).toBe(6); // 9 * 1.5 * 0.5 = 6.75
  });

  it('the full-rate threshold is editable and moves both tier edges', () => {
    expect(gemsForRun(run(), 'reader', { gemFullRate: 10 }, 9)).toBe(9);
    expect(gemsForRun(run(), 'reader', { gemFullRate: 10 }, 10)).toBe(4);
    expect(gemsForRun(run(), 'reader', { gemFullRate: 10 }, 20)).toBe(2);
    expect(gemTier(60, 'reader', { gemFullRate: 80 })).toBe('full');
    expect(gemTier(80, 'reader', { gemFullRate: 80 })).toBe('half');
  });

  it('a missing, wrong-typed or out-of-range setting reads as the default', () => {
    expect(gemSpeedOf(undefined)).toBe(1);
    expect(gemSpeedOf({ gemSpeed: 7 })).toBe(1);
    expect(gemSpeedOf({ gemSpeed: Number.NaN })).toBe(1);
    expect(gemSpeedOf({ gemSpeed: 0.5 })).toBe(0.5);
    expect(gemSpeedOf({ gemSpeed: 1.5 })).toBe(1.5);
    expect(gemFullRateOf('reader', undefined)).toBe(25);
    expect(gemFullRateOf('prereader', undefined)).toBe(15);
    expect(gemFullRateOf('reader', { gemFullRate: -3 })).toBe(25);
    expect(gemFullRateOf('reader', { gemFullRate: 0 })).toBe(25);
    expect(gemFullRateOf('reader', { gemFullRate: 400 })).toBe(25);
    expect(gemFullRateOf('prereader', { gemFullRate: 40 })).toBe(40);
    expect(gemFullRateOf('prereader', { gemFullRate: 12.6 })).toBe(13);
  });
});

describe('earnedTodayOf', () => {
  const T = Date.parse('2026-11-17T20:00:00Z');
  it('reads the stored count only for the same local day', () => {
    const today = new Date(T);
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(earnedTodayOf({ ...DEFAULT_GAME, gemsEarnedToday: 17, gemsDay: key }, T)).toBe(17);
    expect(earnedTodayOf({ ...DEFAULT_GAME, gemsEarnedToday: 17, gemsDay: '2026-11-16' }, T)).toBe(0);
    expect(earnedTodayOf(DEFAULT_GAME, T)).toBe(0);
  });
});

describe('throttledGems: one function for every gem source', () => {
  it('a boss of 10 pays 10, 5, 2 across the tiers; a chest of 1 always pays at least 1', () => {
    expect([0, 25, 50].map((e) => throttledGems(10, 'reader', {}, e))).toEqual([10, 5, 2]);
    expect([0, 25, 50].map((e) => throttledGems(1, 'reader', {}, e))).toEqual([1, 1, 1]);
  });
  it('a run goes through it: same answer as gemsForRun', () => {
    const s = { correct: 27, graded: 30, bestCombo: 8, newLearned: 0 };
    expect(gemsForRun(s, 'reader', {}, 30)).toBe(throttledGems(9, 'reader', {}, 30));
  });
});

describe('gemsForRun: right answers on fill practice count', () => {
  const fill = (right: number, over: Partial<GemRunStats> = {}): GemRunStats => ({ correct: 0, practiceCorrect: right, graded: 0, bestCombo: 0, newLearned: 0, ...over });

  it('an all-fill run of 52 answers with 49 right earns at least 1 gem at every tier', () => {
    expect(gemsForRun(fill(49), 'reader', {}, 0)).toBe(10); // 16 capped at 10
    expect(gemsForRun(fill(49), 'reader', {}, 25)).toBeGreaterThanOrEqual(1); // half
    expect(gemsForRun(fill(49), 'reader', {}, 50)).toBeGreaterThanOrEqual(1); // quarter
    expect(gemsForRun(fill(49), 'prereader', {}, 999)).toBeGreaterThanOrEqual(1);
    expect(gemsForRun(fill(2), 'reader', {}, 999)).toBe(1); // floor(2/3) = 0, the 1-gem minimum
  });
  it('0 right earns 0, even with answers given', () => {
    expect(gemsForRun(fill(0), 'reader', {}, 0)).toBe(0);
    expect(gemsForRun(fill(0), 'prereader', {}, 0)).toBe(0);
  });
  it('a mixed run counts both, and perfect stays graded only', () => {
    // 27 graded right + 21 fill right = 48 right: 16 base, capped at 10
    expect(gemsForRun(fill(21, { correct: 27, graded: 30 }), 'reader', {}, 0)).toBe(10);
    // 6 graded right of 6 plus 3 fill right: floor(9/3) + 2 perfect = 5; fill right does not break or make perfect
    expect(gemsForRun(fill(3, { correct: 6, graded: 6 }), 'reader', {}, 0)).toBe(5);
    expect(gemsForRun(fill(3, { correct: 5, graded: 6 }), 'reader', {}, 0)).toBe(2); // floor(8/3), not perfect
    expect(gemsForRun(fill(3, { correct: 0, graded: 6 }), 'reader', {}, 0)).toBe(1);
  });
  it('the tier boundaries are unchanged: full to 25 (reader) and 15 (pre-reader), half to twice that, a quarter after', () => {
    const s = fill(30);
    expect(gemsForRun(s, 'reader', {}, 24)).toBe(10);
    expect(gemsForRun(s, 'reader', {}, 25)).toBe(5);
    expect(gemsForRun(s, 'reader', {}, 49)).toBe(5);
    expect(gemsForRun(s, 'reader', {}, 50)).toBe(2);
    expect(gemsForRun(s, 'prereader', {}, 14)).toBe(10);
    expect(gemsForRun(s, 'prereader', {}, 15)).toBe(7); // 15 base x 0.5
    expect(gemsForRun(s, 'prereader', {}, 30)).toBe(3); // 15 base x 0.25
  });
  it('an old payload with no practiceCorrect reads as 0', () => {
    expect(gemsForRun({ correct: 0, graded: 0, bestCombo: 0, newLearned: 0 }, 'reader', {}, 0)).toBe(0);
    expect(gemsForRun({ correct: 27, graded: 30, bestCombo: 8, newLearned: 0 }, 'reader', {}, 0)).toBe(9);
  });
});
