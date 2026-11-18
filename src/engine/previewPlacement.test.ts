import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from './content';
import { dayKey } from './game';
import { PRESETS, type CardMap, type CardState, type KidSettings } from './models';
import { mulberry32 } from './problems';
import { newCardState, review } from './scheduler';
import * as session from './session';

// preview-placement. VECTOR ruling g8ZVRTz2: a preview is never first; none in the first 3 slots of a
// pre-reader run or the first 2 of a reader run; never back to back. All ids and numbers are made up.
// Written first and run on main: the slot tests fail there, the count tests pass.
const T0 = Date.parse('2026-11-17T20:00:00Z');
const DAY = 86_400_000;
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

const readerSettings = (over: Partial<KidSettings> = {}): KidSettings => ({
  tracks: { facts: true, multidigit: false, fractions: false },
  sessionSize: 30,
  maxNew: 8,
  factGroupsUnlocked: 1,
  paceMultiplier: 3,
  ...over,
});
const prereaderSettings = (over: Partial<KidSettings> = {}): KidSettings => ({
  ...PRESETS.prereader,
  tracks: { ...PRESETS.prereader.tracks },
  modules: { add10: true, sub10: false },
  sessionSize: 10,
  maxNew: 4,
  ...over,
});

function answered(id: string, at: number): CardState {
  const c = review(newCardState(id, at), Rating.Good as 3, 1500, true, at);
  return { ...c, lastResults: [true], day: dayKey(at), dayGraded: 1 } as CardState;
}
const factIds = (g: number) => ALL_CARDS.filter((c) => c.kind === 'fact' && c.track === 'facts' && c.groupIndex === g).map((c) => c.id);
/** Group 0 facts seen and due: they fill the run, so group 1 is the next locked group. */
const group0Due = (): CardMap => {
  const cards: CardMap = {};
  for (const id of factIds(0)) cards[id] = { ...answered(id, T0 - 3 * DAY), fsrs: { ...answered(id, T0 - 3 * DAY).fsrs, due: T0 - 1000, stability: 1.5 } };
  return cards;
};

const buildPlan = (cards: CardMap, settings: KidSettings, seed: number) =>
  (session as unknown as { buildPlan: (i: unknown) => session.PlanItem[] }).buildPlan({ cards, settings, now: T0, rng: mulberry32(seed) });
const isPreview = (x: session.PlanItem) => !!x.preview;
const previewSlots = (p: session.PlanItem[]) => p.flatMap((x, i) => (isPreview(x) ? [i] : []));

/** Each case: a learner, the slots with no preview, and the cards and settings that feed buildPlan. */
const CASES: { name: string; floor: number; previews: number; length: number; cards: () => CardMap; settings: () => KidSettings }[] = [
  { name: 'reader, 30 cards', length: 32, floor: 2, previews: 2, cards: group0Due, settings: () => readerSettings({ maxNew: 0 }) },
  { name: 'reader, 6 cards', length: 8, floor: 2, previews: 2, cards: group0Due, settings: () => readerSettings({ sessionSize: 6, maxNew: 0 }) },
  { name: 'reader, new kid', length: 30, floor: 2, previews: 2, cards: () => ({}), settings: () => readerSettings() },
  { name: 'pre-reader, new kid', length: 10, floor: 3, previews: 1, cards: () => ({}), settings: () => prereaderSettings() },
  { name: 'pre-reader, 6 cards', length: 6, floor: 3, previews: 1, cards: () => ({}), settings: () => prereaderSettings({ sessionSize: 6 }) },
];

describe('preview slots in 50 seeded plans per learner', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const plans = SEEDS.map((s) => buildPlan(c.cards(), c.settings(), s));
      it('no preview in the first slots', () => {
        const bad = plans.map((p, i) => ({ seed: SEEDS[i], slots: previewSlots(p).filter((s) => s < c.floor) })).filter((b) => b.slots.length);
        expect(bad).toEqual([]);
      });
      it('a run never opens with a preview', () => {
        expect(plans.filter((p) => isPreview(p[0]!))).toHaveLength(0);
      });
      it('previews never sit back to back', () => {
        const bad = plans.filter((p) => previewSlots(p).some((s, i, a) => i > 0 && s - a[i - 1]! < 2));
        expect(bad).toHaveLength(0);
      });
      it('every plan still holds the same number of previews and the same run length as main', () => {
        for (const p of plans) {
          expect(p.filter(isPreview)).toHaveLength(c.previews);
          expect(p).toHaveLength(c.length);
        }
      });
    });
  }
});

describe('placePreviews keeps everything else in order', () => {
  const place = (items: session.PlanItem[], floor: number) =>
    (session as unknown as { placePreviews: (xs: session.PlanItem[], floor: number) => session.PlanItem[] }).placePreviews(items, floor);
  const mk = (marks: string): session.PlanItem[] =>
    [...marks].map((m, i) => ({ cardId: `${m}${i}`, isNew: m !== 'k', ...(m === 'P' ? { preview: true } : {}) }));
  const ids = (xs: session.PlanItem[]) => xs.map((x) => x.cardId);
  const nonPreview = (xs: session.PlanItem[]) => xs.filter((x) => !x.preview).map((x) => x.cardId);

  it('a plan that already follows the rules is returned unchanged', () => {
    const items = mk('kkkPkkkPkk');
    expect(ids(place(items, 3))).toEqual(ids(items));
  });
  it('a preview in slot 0 moves to the first allowed slot', () => {
    const out = place(mk('Pkkkkk'), 3);
    expect(previewSlots(out)).toEqual([3]);
  });
  it('two adjacent previews are split', () => {
    const out = place(mk('kkkkPPkkkk'), 2);
    expect(previewSlots(out)).toEqual([4, 6]);
  });
  it('the other items keep their order and the preview count is unchanged', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed);
      const marks = Array.from({ length: 12 }, () => (rng() < 0.3 ? 'P' : 'k')).join('');
      const items = mk(marks);
      const out = place(items, 3);
      expect(nonPreview(out)).toEqual(nonPreview(items));
      expect(out.filter(isPreview)).toHaveLength(items.filter(isPreview).length);
      expect(out).toHaveLength(items.length);
    }
  });
  it('a run too short for the rules still keeps every preview and every item', () => {
    const out = place(mk('PPk'), 3);
    expect(out).toHaveLength(3);
    expect(out.filter(isPreview)).toHaveLength(2);
  });
});
