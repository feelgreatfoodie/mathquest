import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { dayKey } from './game';
import { PRESETS, type CardMap, type CardState, type KidSettings } from './models';
import { getModule } from './modules';
import { newCardState, review } from './scheduler';
import { SessionRunner, buildPlan } from './session';
import { levelStep, mapRows, readerMapLine, unlockGap } from './summaryView';

// prereader-summary. Every number is made up. These fail on main: summaryView.ts does not exist there.
const T0 = Date.parse('2026-11-17T20:00:00Z');
const settings = (over: Partial<KidSettings> = {}): KidSettings => ({
  ...PRESETS.prereader,
  tracks: { ...PRESETS.prereader.tracks },
  modules: { add10: true, sub10: true },
  ...over,
});
const add10 = getModule('add10')!;
const g = (i: number) => add10.groups![i]!.cardIds;

function steady(id: string): CardState {
  const c = review(newCardState(id, T0), Rating.Good as 3, 1500, true, T0);
  return { ...c, lastResults: [true, true], day: dayKey(T0), dayGraded: 1 } as CardState;
}
function seenOnly(id: string): CardState {
  return { ...steady(id), lastResults: [false] } as CardState;
}
const mapOf = (cards: CardMap, s = settings()) => Object.fromEntries(mapRows(cards, s).map((r) => [r.moduleId, r]));

describe('levelStep', () => {
  it('250 XP to 340 XP stays level 2, bar 0.5 to 0.8', () => {
    const s = levelStep(250, 340);
    expect(s.levelBefore).toBe(2);
    expect(s.levelAfter).toBe(2);
    expect(s.levelUp).toBe(false);
    expect(s.fromFrac).toBeCloseTo(0.5, 5);
    expect(s.toFrac).toBeCloseTo(0.8, 5);
  });
  it('390 XP to 450 XP is a level-up to 3; the bar restarts at 0 and ends at (450-400)/500', () => {
    const s = levelStep(390, 450);
    expect(s.levelBefore).toBe(2);
    expect(s.levelAfter).toBe(3);
    expect(s.levelUp).toBe(true);
    expect(s.toFrac).toBeCloseTo(0.1, 5);
  });
  it('no XP earned: no change, no level-up', () => {
    const s = levelStep(120, 120);
    expect(s.levelUp).toBe(false);
    expect(s.fromFrac).toBe(s.toFrac);
  });
});

describe('unlockGap: how many more steady facts open the next group (prereader rule)', () => {
  it('empty cards: group 1 needs ceil(0.8 * n) steady facts', () => {
    const n = g(0).length;
    expect(unlockGap(add10, 1, {}, settings())).toBe(Math.ceil(n * 0.8));
  });
  it('each steady fact in group 1 lowers the gap by 1 down to 0', () => {
    const need = Math.ceil(g(0).length * 0.8);
    const cards: CardMap = {};
    g(0).slice(0, 3).forEach((id) => (cards[id] = steady(id)));
    expect(unlockGap(add10, 1, cards, settings())).toBe(need - 3);
    g(0).forEach((id) => (cards[id] = steady(id)));
    expect(unlockGap(add10, 1, cards, settings())).toBe(0);
  });
  it('a seen fact with a missed last answer does not count', () => {
    const cards: CardMap = { [g(0)[0]!]: seenOnly(g(0)[0]!) };
    expect(unlockGap(add10, 1, cards, settings())).toBe(Math.ceil(g(0).length * 0.8));
  });
  it('a group already open (parent floor) has gap 0', () => {
    expect(unlockGap(add10, 1, {}, settings({ groupsUnlocked: { add10: 2 } }))).toBe(0);
  });
});

describe('mapRows: one stone per group, per enabled module', () => {
  it('add10 and sub10 on: two rows of two stones; facts off', () => {
    const rows = mapRows({}, settings());
    expect(rows.map((r) => r.moduleId)).toEqual(['add10', 'sub10']);
    expect(rows.every((r) => r.stones.length === 2)).toBe(true);
  });
  it('only add10 on: one row', () => {
    expect(mapRows({}, settings({ modules: { add10: true } })).map((r) => r.moduleId)).toEqual(['add10']);
  });
  it('fresh kid: stone 1 is current, stone 2 is locked with the gap', () => {
    const m = mapOf({});
    expect(m.add10!.stones.map((s) => s.state)).toEqual(['current', 'locked']);
    expect(m.add10!.stones[1]!.gap).toBe(Math.ceil(g(0).length * 0.8));
    expect(m.add10!.stones[0]!.total).toBe(g(0).length);
    expect(m.add10!.stones[0]!.seen).toBe(0);
  });
  it('lit count is facts seen (any answer), not facts steady', () => {
    const cards: CardMap = { [g(0)[0]!]: seenOnly(g(0)[0]!), [g(0)[1]!]: steady(g(0)[1]!) };
    expect(mapOf(cards).add10!.stones[0]!.seen).toBe(2);
  });
  it('group 2 open by progress: stone 1 is done, stone 2 is current, nothing locked', () => {
    const cards: CardMap = {};
    g(0).forEach((id) => (cards[id] = steady(id)));
    const st = mapOf(cards).add10!.stones;
    expect(st.map((s) => s.state)).toEqual(['done', 'current']);
    expect(st[1]!.gap).toBeUndefined();
  });
  it('only the first locked stone shows a gap', () => {
    const st = mapOf({}, settings({ groupsUnlocked: undefined })).add10!.stones;
    expect(st[0]!.gap).toBeUndefined();
    expect(st[1]!.gap).toBeGreaterThan(0);
  });
  it('the parent floor puts the hero on the floor group: {add10: 2} gives done, current', () => {
    expect(mapOf({}, settings({ groupsUnlocked: { add10: 2 } })).add10!.stones.map((s) => s.state)).toEqual(['done', 'current']);
  });
});

describe('readerMapLine: the compact row for readers', () => {
  const reader = (): KidSettings => ({ tracks: { facts: true, multidigit: false, fractions: false }, sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 });
  it('names the module, facts seen of total, and the next locked group', () => {
    const line = readerMapLine({}, reader());
    expect(line).toMatch(/^Times tables: 0 of 91 seen/);
    expect(line).toMatch(/next: /);
  });
  it('is null when no module with groups is on', () => {
    expect(readerMapLine({}, { ...reader(), tracks: { facts: false, multidigit: true, fractions: false } })).toBeNull();
  });
});

describe('SessionRunner.newlyLearned', () => {
  it('lists the facts first answered correctly this run', () => {
    const s = settings({ modules: { add10: true }, sessionSize: 4, maxNew: 4 });
    const plan = buildPlan({ cards: {}, settings: s, now: T0, rng: () => 0.5 });
    const runner = new SessionRunner(plan, {}, () => 0.5, () => T0, s);
    expect(runner.newlyLearned()).toEqual([]);
  });
});
