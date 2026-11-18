import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/insights.json';
import { GROUP_UNLOCK_SHARE, groupProgress, groupSteady, unlockedGroups } from './mastery';
import { alerts, buildInsights, buildMatrix, ladderStatus, moduleInsight, needsWork, newFactPace, practiceBalance, skillRows, trend, type InsightInput } from './insights';
import { getModule } from './modules';
import { newCardState } from './scheduler';
import type { CardMap, CardState, SessionLog } from './models';
import { dayKey } from './game';

// The fixture is a de-identified copy of two real players, taken from the exact subcollection paths (cards and
// sessions of each kid) at 2026-11-18T03:04:48Z. Later play changed the live numbers (kidA reached 91 of 91 seen
// by 12:20Z), so the copy is frozen. kidA is the reader with times tables, kidB the pre-reader with add and sub.
// Expected numbers (81 of 91 seen, g3 45%, g4 0/9, max attempts 28, 18 runs with 0 new; add 15/36, sub 21/66, add
// g1 42%) are TENSOR's measurements of the same data. These tests fail on main: insights.ts does not exist there.
const SNAPSHOT_AT = '2026-11-18T03:04:48Z';
const NOW = Date.parse('2026-11-18T03:10:00Z');

type Fx = { settings: InsightInput['settings']; cards: CardState[]; sessions: SessionLog[] };
const load = (k: 'kidA' | 'kidB'): InsightInput => {
  const d = (fixture as unknown as Record<string, Fx>)[k]!;
  return { cards: Object.fromEntries(d.cards.map((c) => [c.id, c])) as CardMap, sessions: d.sessions, settings: d.settings, now: NOW };
};
const A = load('kidA');
const B = load('kidB');
const facts = getModule('facts')!;
const add10 = getModule('add10')!;
const sub10 = getModule('sub10')!;

describe('fixture', () => {
  it('is the 03:04:48Z snapshot with no real names or ids', () => {
    expect(fixture.snapshotAt).toBe(SNAPSHOT_AT);
    const text = JSON.stringify(fixture);
    expect(Object.keys(fixture).sort()).toEqual(['kidA', 'kidB', 'note', 'snapshotAt']);
    expect(text).not.toMatch(/families\/|@|projects\//);
  });
});

describe('kidA (reader, times tables)', () => {
  const m = moduleInsight(facts, A);
  it('81 of 91 facts seen', () => {
    expect(m.seen).toBe(81);
    expect(m.total).toBe(91);
    expect(m.summary).toMatch(/^Times tables: 81 of 91 facts seen · \d+ reviewing or better · next group: .+ \(locked\)$/);
  });
  it('g3 (9s and 11s) is at 45% reviewing, g4 (6s, 7s, 8s) has 0 of 9 seen', () => {
    const g3 = m.ladder[2]!;
    const g4 = m.ladder[3]!;
    expect(g3.label).toBe('9s and 11s');
    expect(Math.round(g3.reviewing * 100)).toBe(45);
    expect(g4.label).toBe('6s, 7s, 8s');
    expect(g4.seen).toBe(0);
    expect(g4.total).toBe(9);
  });
  it('the ladder reads the planner: reviewing and steady are groupProgress and groupSteady, open count is unlockedGroups', () => {
    m.ladder.forEach((row, i) => {
      expect(row.reviewing).toBe(groupProgress(facts, i, A.cards));
      expect(row.steady).toBe(groupSteady(facts, i, A.cards));
      expect(row.state).toBe(i < unlockedGroups(facts, A.cards, A.settings) ? 'open' : 'locked');
    });
    expect(m.marker).toBe(GROUP_UNLOCK_SHARE);
  });
  it('the first locked row names its gate and shows "unlocks at 80% (now N%)"', () => {
    const row = m.ladder.find((r) => r.nextToOpen)!;
    expect(row.gate).not.toBeNull();
    expect(ladderStatus(row, false)).toMatch(/^unlocks at 80% \(now \d+%\)$/);
    expect(ladderStatus(m.ladder[0]!, false)).toBe('open');
    expect(ladderStatus(m.ladder[4]!, false)).toBe('locked');
  });
  it('max attempts is 28 and the most practiced fact is 28 tries', () => {
    const b = practiceBalance(A);
    expect(b.maxAttempts).toBe(28);
    expect(b.most[0]!.attempts).toBe(28);
    expect(b.most).toHaveLength(5);
    expect(b.least).toHaveLength(5);
    expect(b.least[0]!.attempts).toBeLessThanOrEqual(b.medianAttempts);
    expect(b.factCount).toBe(81);
  });
  it('the last 18 runs added 0 new facts, and the stuck alert fires', () => {
    const byTime = [...A.sessions].sort((a, b) => b.startedAt - a.startedAt);
    let tail = 0;
    while (tail < byTime.length && byTime[tail]!.newLearned === 0) tail++;
    expect(tail).toBe(18);
    const stuck = alerts(A).filter((x) => x.kind === 'stuck');
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.text).toMatch(/^No new facts in the last 10 runs in Times tables\. Group '.+' is at \d+%/);
  });
  it('the matrix is 13 by 13 with 91 cards, symmetric cells share one card, and 6 x 7 reads "not seen"', () => {
    const mx = buildMatrix(facts, A);
    expect(mx.rows).toHaveLength(13);
    expect(mx.rows.every((r) => r.length === 13 && r.every(Boolean))).toBe(true);
    expect(mx.cardCount).toBe(91);
    expect(mx.rows[6]![7]!.id).toBe(mx.rows[7]![6]!.id);
    expect(mx.rows[6]![7]!.label).toBe('6 times 7, not seen');
    expect(mx.rows[6]![7]!.seen).toBe(false);
    expect(mx.rows.flat().filter((c) => c!.seen).length).toBe(81 * 2 - mx.rows.flat().filter((c) => c!.seen && c!.a === c!.b).length);
  });
  it('a seen fact in a locked group carries the preview flag; a seen fact in an open group does not', () => {
    const mx = buildMatrix(facts, A);
    const open = unlockedGroups(facts, A.cards, A.settings);
    for (const c of mx.rows.flat()) {
      if (!c) continue;
      expect(c.preview).toBe(c.seen && c.groupIndex >= open);
    }
    expect(mx.rows.flat().some((c) => c!.preview)).toBe(true);
    expect(mx.rows.flat().some((c) => c!.seen && !c!.preview)).toBe(true);
  });
  it('lists the md and fr skills apart from the facts, with name, level and attempts', () => {
    const rows = skillRows(A);
    expect(rows.map((r) => r.prefix).sort()).toEqual(['fr', 'md']);
    for (const r of rows) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.attempts).toBeGreaterThan(0);
    }
    expect(practiceBalance(A).factCount).toBe(81); // skills never count as facts
  });
});

describe('kidB (pre-reader, add and sub within 10)', () => {
  const adds = moduleInsight(add10, B);
  const subs = moduleInsight(sub10, B);
  it('add 15 of 36 and sub 21 of 66 seen', () => {
    expect([adds.seen, adds.total]).toEqual([15, 36]);
    expect([subs.seen, subs.total]).toEqual([21, 66]);
  });
  it('add group 1 is at 42%', () => {
    expect(Math.round(adds.ladder[0]!.reviewing * 100)).toBe(42);
  });
  it('a pre-reader opens by the second rule only, as mastery.ts does', () => {
    expect(adds.prereader).toBe(true);
    const row = adds.ladder.find((r) => r.nextToOpen)!;
    const steady = Math.round(row.gate!.steady * 100);
    expect(ladderStatus(row, true)).toBe(`unlocks at 80% (now ${steady}%)`);
    // The reviewing share (42%) is not what a pre-reader's gate shows.
    expect(ladderStatus(row, true)).not.toContain('42');
  });
  it('counts facts only for enabled modules: times tables are off', () => {
    const all = buildInsights(B);
    expect(all.modules.map((x) => x.insight.moduleId)).toEqual(['add10', 'sub10']);
    expect(practiceBalance(B).factCount).toBe(36);
  });
  it('add is an 11 by 11 grid with sums over 10 as gaps; sub is a triangle', () => {
    const a = buildMatrix(add10, B);
    expect(a.rows).toHaveLength(11);
    expect(a.cardCount).toBe(36);
    expect(a.rows[6]![5]).toBeNull();
    expect(a.rows[5]![5]!.label).toMatch(/^5 plus 5, /);
    const s = buildMatrix(sub10, B);
    expect(s.kind).toBe('triangle');
    expect(s.cardCount).toBe(66);
    expect(s.rows[3]![5]).toBeNull();
    expect(s.rows[5]![3]!.label).toMatch(/^5 minus 3, /);
  });
});

describe('alerts, pace, trend, needs work on made-up data', () => {
  const noon = new Date(2026, 10, 18, 12).getTime();
  const base = (over: Partial<InsightInput> = {}): InsightInput => ({ cards: {}, sessions: [], settings: { ...A.settings, modules: { facts: true } }, now: noon, ...over });
  const card = (id: string, o: Partial<CardState> = {}): CardState => ({ ...newCardState(id, noon), attempts: 1, correct: 1, ...o });
  const run = (i: number, over: Partial<SessionLog> = {}): SessionLog => ({
    id: `r${i}`, startedAt: noon - i * 3_600_000, endedAt: noon - i * 3_600_000 + 60_000, answered: 10, graded: 10, correct: 9, fast: 5, newLearned: 0, medianMs: 2000, xp: 0, gems: 0, bestCombo: 0, missed: [], ...over,
  });

  it('imbalance: one fact with more than 3 graded today reads "One fact (..) got N tries today"', () => {
    const cards = { 'mul:6x7': card('mul:6x7', { attempts: 28, correct: 20, day: dayKey(noon), dayGraded: 28 }), 'mul:2x3': card('mul:2x3', { day: dayKey(noon), dayGraded: 3 }) };
    const a = alerts(base({ cards })).filter((x) => x.kind === 'imbalance');
    expect(a).toHaveLength(1);
    expect(a[0]!.text).toBe('One fact (6 × 7) got 28 tries today.');
  });
  it('imbalance: exactly 3 graded is fine, and yesterday does not count', () => {
    const cards = { 'mul:2x3': card('mul:2x3', { day: dayKey(noon), dayGraded: 3 }), 'mul:4x5': card('mul:4x5', { day: dayKey(noon - 86_400_000), dayGraded: 9 }) };
    expect(alerts(base({ cards })).filter((x) => x.kind === 'imbalance')).toEqual([]);
  });
  it('unretried: asked once and missed, counted per fact', () => {
    const cards = { 'mul:2x3': card('mul:2x3', { attempts: 1, correct: 0 }), 'mul:4x5': card('mul:4x5', { attempts: 1, correct: 0 }), 'mul:3x3': card('mul:3x3', { attempts: 2, correct: 0 }), 'mul:5x5': card('mul:5x5') };
    const a = alerts(base({ cards })).filter((x) => x.kind === 'unretried');
    expect(a[0]!.text).toBe('2 facts have been asked only once and were missed.');
  });
  it('stuck: needs 10 runs with 0 new; 9 runs, or 1 run with a new fact in the last 10, do not fire', () => {
    const none = Array.from({ length: 10 }, (_, i) => run(i));
    expect(alerts(base({ sessions: none })).some((x) => x.kind === 'stuck')).toBe(true);
    expect(alerts(base({ sessions: none.slice(1) })).some((x) => x.kind === 'stuck')).toBe(false);
    const one = none.map((r, i) => (i === 9 ? { ...r, newLearned: 1 } : r));
    expect(alerts(base({ sessions: one })).some((x) => x.kind === 'stuck')).toBe(false);
  });
  it('stuck: silent when no group is waiting (every group open)', () => {
    const none = Array.from({ length: 10 }, (_, i) => run(i));
    const settings = { ...A.settings, modules: { facts: true }, groupsUnlocked: { facts: 5 } as const };
    expect(alerts(base({ sessions: none, settings })).some((x) => x.kind === 'stuck')).toBe(false);
  });
  it('pace: new facts per day for 14 days, runs of today, and a week line', () => {
    const sessions = [run(0, { newLearned: 4 }), run(1, { newLearned: 2 }), run(30, { newLearned: 5 }), run(24 * 10, { newLearned: 7 }), run(24 * 20, { newLearned: 9 })];
    const p = newFactPace(sessions, noon);
    expect(p.days).toHaveLength(14);
    expect(p.today.reduce((t, n) => t + n, 0)).toBeGreaterThanOrEqual(6);
    expect(p.days[13]!.day).toBe(dayKey(noon));
    expect(p.days.reduce((t, d) => t + d.newFacts, 0)).toBe(4 + 2 + 5 + 7); // the run 20 days ago is outside the window
    expect(newFactPace([run(0, { newLearned: 1 })], noon).line).toBe('1 new fact this week');
    expect(newFactPace([], noon).line).toBe('0 new facts this week');
  });
  it('trend: per-day accuracy and median time over 14 days; empty days are null', () => {
    const t = trend([run(0, { graded: 10, correct: 8, medianMs: 3000 }), run(1, { graded: 10, correct: 10, medianMs: 1000 })], noon);
    expect(t).toHaveLength(14);
    const today = t[13]!;
    expect(today.graded).toBeGreaterThanOrEqual(10);
    expect(today.accuracy).not.toBeNull();
    expect(t[0]!.accuracy).toBeNull();
    expect(t[0]!.medianMs).toBeNull();
  });
  it('needs work: at most 8, recent misses first, then lapses, then stability', () => {
    const f = (id: string, o: Partial<CardState> & { lapses?: number; stability?: number } = {}) => {
      const c = card(id, { attempts: 4, correct: 2, ...o });
      return { ...c, fsrs: { ...c.fsrs, lapses: o.lapses ?? 0, stability: o.stability ?? 1 } };
    };
    const cards: CardMap = {};
    for (let a = 2; a <= 11; a++) cards[`mul:${a}x12`] = f(`mul:${a}x12`, { lapses: a, stability: 1 });
    cards['mul:0x1'] = f('mul:0x1', { missDay: dayKey(noon), lapses: 0 });
    const r = needsWork(base({ cards }));
    expect(r).toHaveLength(8);
    expect(r[0]!.id).toBe('mul:0x1');
    expect(r[0]!.missedThisWeek).toBe(true);
    expect(r[1]!.lapses).toBeGreaterThanOrEqual(r[2]!.lapses);
  });
});
