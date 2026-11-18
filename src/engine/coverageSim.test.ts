import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { runEvening, type EveningResult } from './coverageSim';
import { ALL_CARDS } from './content';
import { dayKey } from './game';
import { PRESETS, type CardMap, type KidSettings } from './models';
import { getModule } from './modules';
import { newCardState, review } from './scheduler';

// Deterministic evenings (seeded rng, 93% accuracy). The committed tests use made-up start states shaped like the
// two real ones. SIM_REAL=1 reads anonymized card copies from .private-eval/ (gitignored, never committed) and prints
// the numbers the PR reports; it asserts nothing.
const DAY = 86_400_000;
const START = Date.parse('2026-11-18T16:00:00Z'); // the morning after
const YESTERDAY = START - 20 * 3_600_000;

const factIds = (g: number) => ALL_CARDS.filter((c) => c.kind === 'fact' && c.track === 'facts' && c.groupIndex === g).map((c) => c.id);
const modFacts = (id: 'add10' | 'sub10') => getModule(id)!.cards.filter((c) => c.kind === 'fact');

function seen(id: string, reps: number, stability: number, ok = true): CardMap[string] {
  let c = newCardState(id, YESTERDAY - 3_600_000);
  for (let i = 0; i < reps; i++) c = review(c, (ok ? Rating.Good : Rating.Again) as 1 | 3, 2500, ok, YESTERDAY - (reps - i) * 60_000);
  return { ...c, fsrs: { ...c.fsrs, stability, due: YESTERDAY + stability * DAY }, lastResults: ok ? [true, true] : [false], day: dayKey(YESTERDAY) } as CardMap[string];
}

/** The older boy: g1 55, g2 15, g3 11 seen (81 of 91), g4 and g5 never; 6 g3 facts missed once. */
function readerStart(): { cards: CardMap; settings: KidSettings } {
  const cards: CardMap = {};
  for (const id of factIds(0)) cards[id] = seen(id, 6, 5);
  for (const id of factIds(1)) cards[id] = seen(id, 3, 3);
  factIds(2).forEach((id, i) => (cards[id] = i < 6 ? seen(id, 1, 0.2, false) : seen(id, 2, 1.5)));
  return { cards, settings: { tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 } };
}

/** The younger boy: add g1 12 of 36 seen, sub g1 21 of 66 seen; every card was missed or slow once. */
function prereaderStart(): { cards: CardMap; settings: KidSettings } {
  const cards: CardMap = {};
  const g1 = (m: 'add10' | 'sub10') => modFacts(m).filter((c) => c.kind === 'fact' && c.groupIndex === 0);
  for (const c of g1('add10')) cards[c.id] = seen(c.id, 4, 0.3);
  for (const c of g1('sub10')) cards[c.id] = seen(c.id, 3, 0.3);
  return { cards, settings: { ...PRESETS.prereader, tracks: { ...PRESETS.prereader.tracks }, modules: { add10: true, sub10: true }, sessionSize: 15, maxNew: 8 } };
}

const reader = () => {
  const s = readerStart();
  return runEvening({ ...s, start: START, runs: 25, accuracy: 0.93, seed: 20261118, universe: factIds(0).concat(factIds(1), factIds(2), factIds(3), factIds(4)) });
};
const prereader = () => {
  const s = prereaderStart();
  return runEvening({ ...s, start: START, runs: 20, accuracy: 0.93, seed: 20261119, universe: modFacts('add10').map((c) => c.id) });
};

describe('one evening: the older boy (25 runs, 93%)', () => {
  const r = reader();
  it('sees every facts-module fact at least once', () => expect(r.seenAtEnd).toBe(r.universe));
  it('no card gets more than 3 graded answers in a day', () => {
    expect(r.maxGradedPerCard).toBeLessThanOrEqual(3);
    expect(r.cardsOverCap).toBe(0);
  });
  it('every card missed in run N is back in run N+1, unless it was already at its cap (its in-run retries came first)', () => {
    expect(r.missedNotBack - r.missedNotBackAtCap).toBe(0);
  });
  it('the 6s, 7s and 8s appear as previews by run 3', () => {
    expect(r.firstSeenRun['facts:g4']).toBeLessThanOrEqual(3);
  });
  it('previews never exceed 2 per run', () => expect(r.maxPreviewsPerRun).toBeLessThanOrEqual(2));
  it('every run from 11 to 25 has a full queue, and FSRS does not move once nothing graded is left', () => {
    expect(r.emptyRuns).toBe(0);
    for (const n of r.planned.slice(10)) expect(n).toBeGreaterThanOrEqual(30);
    expect(r.firstUngradedRun).toBeDefined();
    expect(r.fsrsChangedAfterCap).toBe(0);
  });
});

describe('one evening: the younger boy (20 runs, 93%)', () => {
  const r = prereader();
  it('opens add g2', () => expect(r.openedAtRun['add10:g2']).toBeLessThanOrEqual(20));
  it('sees every add10 fact', () => expect(r.seenAtEnd).toBe(r.universe));
  it('previews are capped at 1 per run', () => expect(r.maxPreviewsPerRun).toBeLessThanOrEqual(1));
  it('no card gets more than 3 graded answers in a day', () => expect(r.maxGradedPerCard).toBeLessThanOrEqual(3));
});

describe('real card data (local only)', () => {
  const dir = '.private-eval';
  const files = [
    ['older boy', 'older-cards.json', 'reader'],
    ['younger boy', 'younger-cards.json', 'prereader'],
  ] as const;
  it.skipIf(!process.env.SIM_REAL || !existsSync(`${dir}/${files[0][1]}`))('prints before/after numbers', () => {
    const dec = (v: any): any => ('integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'stringValue' in v ? v.stringValue : 'nullValue' in v ? null : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, dec(x)])) : 'arrayValue' in v ? (v.arrayValue.values ?? []).map(dec) : v.booleanValue);
    const out: Record<string, unknown> = {};
    for (const [who, f, kind] of files) {
      const cards: CardMap = Object.fromEntries(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).documents.map((d: any) => { const o = dec({ mapValue: { fields: d.fields } }); return [o.id, o]; }));
      const settings: KidSettings =
        kind === 'reader'
          ? { tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 }
          : { ...PRESETS.prereader, tracks: { ...PRESETS.prereader.tracks }, modules: { add10: true, sub10: true }, sessionSize: 15, maxNew: 8 };
      const universe = kind === 'reader' ? [0, 1, 2, 3, 4].flatMap(factIds) : modFacts('add10').map((c) => c.id);
      const res: EveningResult = runEvening({ cards, settings, start: START, runs: kind === 'reader' ? 25 : 20, accuracy: 0.93, seed: kind === 'reader' ? 20261118 : 20261119, universe });
      const { runs: _r, cards: _c, ...m } = res;
      out[who] = m;
    }
    writeFileSync(process.env.SIM_OUT ?? `${dir}/sim-out.json`, JSON.stringify(out, null, 1));
  });
});
