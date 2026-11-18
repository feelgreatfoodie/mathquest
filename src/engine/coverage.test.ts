import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from './content';
import { dayKey } from './game';
import * as mastery from './mastery';
import { PRESETS, type CardMap, type CardState, type KidSettings } from './models';
import { mulberry32 } from './problems';
import { newCardState, retrievability, review } from './scheduler';
import { getModule } from './modules';
import * as session from './session';

// coverage-1. Every id, name and number is made up. Written first and run on main: the tests that need
// the new behavior fail there, the ones that guard existing behavior pass.
const T0 = Date.parse('2026-11-17T20:00:00Z');
const H = 3_600_000;
const DAY = 86_400_000;
const TODAY = dayKey(T0);

const readerSettings = (over: Partial<KidSettings> = {}): KidSettings => ({
  tracks: { facts: true, multidigit: false, fractions: false },
  sessionSize: 30,
  maxNew: 8,
  factGroupsUnlocked: 1,
  paceMultiplier: 3,
  ...over,
});
const prereaderSettings = (): KidSettings => ({ ...PRESETS.prereader, tracks: { ...PRESETS.prereader.tracks }, modules: { add10: true, sub10: false }, sessionSize: 10, maxNew: 4 });

/** A card answered once at `at`, with the given grade. */
function answered(id: string, at: number, grade: 1 | 3 = Rating.Good as 3, ok = true): CardState {
  const c = review(newCardState(id, at), grade, 1500, ok, at);
  return { ...c, lastResults: [ok], day: dayKey(at), dayGraded: 1 } as CardState;
}
const plan = (cards: CardMap, settings: KidSettings, now = T0, seed = 1) =>
  (session as unknown as { buildPlan: (i: unknown) => session.PlanItem[] }).buildPlan({ cards, settings, now, rng: mulberry32(seed) });
const factIds = (g: number) => ALL_CARDS.filter((c) => c.kind === 'fact' && c.track === 'facts' && c.groupIndex === g).map((c) => c.id);

describe('root cause 1: retrievability ties', () => {
  it('a card missed 2 hours ago (stability 0.2) ranks weaker than one reviewed 1 minute ago (stability 8.3)', () => {
    const missed = answered('mul:11x11', T0 - 2 * H, Rating.Again as 1, false);
    const fresh = { ...answered('mul:1x2', T0 - 60_000), fsrs: { ...answered('mul:1x2', T0 - 60_000).fsrs, stability: 8.3 } };
    const m = { ...missed, fsrs: { ...missed.fsrs, stability: 0.2 } };
    expect(retrievability(m, T0)).toBeLessThan(retrievability(fresh, T0));
    expect(retrievability(m, T0)).toBeLessThan(0.99);
  });
  it('retrievability falls with elapsed hours inside one day (no whole-day rounding)', () => {
    const c = { ...answered('mul:3x4', T0 - 6 * H), fsrs: { ...answered('mul:3x4', T0 - 6 * H).fsrs, stability: 0.5 } };
    const r = [0, 1, 3, 6].map((h) => retrievability(c, T0 - 6 * H + h * H));
    expect(new Set(r).size).toBe(4);
    expect(r).toEqual([...r].sort((a, b) => b - a));
  });
  it('the practice-ahead fill no longer returns the first N seen cards in curriculum order', () => {
    const ids = factIds(0).slice(0, 12);
    const cards: CardMap = {};
    // Same day, same stability, reviewed 1 to 12 minutes ago; the LAST ids in curriculum order are the stalest.
    ids.forEach((id, i) => (cards[id] = { ...answered(id, T0 - (i + 1) * 60_000), fsrs: { ...answered(id, T0).fsrs, stability: 0.5, due: T0 + DAY, last_review: T0 - (i + 1) * 60_000 } }));
    const p = plan(cards, readerSettings({ sessionSize: 6, maxNew: 0 })); // 2 slots go to previews
    const fill = p.filter((x) => !x.isNew).map((x) => x.cardId);
    expect(fill).toHaveLength(4);
    expect(fill).toEqual(expect.arrayContaining(ids.slice(-4)));
  });
});

describe('fill fairness and the daily cap', () => {
  const seenCards = (n: number) => {
    const cards: CardMap = {};
    factIds(0).slice(0, n).forEach((id, i) => (cards[id] = { ...answered(id, T0 - (i + 2) * H), fsrs: { ...answered(id, T0 - (i + 2) * H).fsrs, due: T0 + DAY } }));
    return cards;
  };
  it('fill picks missed-today first, then least recently answered, then lowest retrievability', () => {
    const cards = seenCards(10);
    const ids = Object.keys(cards);
    cards[ids[0]!] = { ...cards[ids[0]!]!, lastResults: [false], missDay: TODAY } as CardState; // missed today
    const p = plan(cards, readerSettings({ sessionSize: 5, maxNew: 0 }));
    const picked = p.map((x) => x.cardId);
    expect(picked).toContain(ids[0]);
    expect(picked).toContain(ids[9]); // answered longest ago
  });
  it('a card with 3 graded answers today is not planned (due or fill)', () => {
    const cards = seenCards(6);
    const ids = Object.keys(cards);
    cards[ids[0]!] = { ...cards[ids[0]!]!, dayGraded: 3, day: TODAY, fsrs: { ...cards[ids[0]!]!.fsrs, due: T0 - H } } as CardState; // due AND capped
    cards[ids[1]!] = { ...cards[ids[1]!]!, dayGraded: 3, day: TODAY } as CardState;
    const picked = plan(cards, readerSettings({ sessionSize: 30, maxNew: 0 })).map((x) => x.cardId);
    expect(picked).not.toContain(ids[0]);
    expect(picked).not.toContain(ids[1]);
  });
  it('a cap from yesterday does not count today', () => {
    const cards = seenCards(3);
    const id = Object.keys(cards)[0]!;
    cards[id] = { ...cards[id]!, dayGraded: 3, day: dayKey(T0 - DAY) } as CardState;
    expect(plan(cards, readerSettings({ sessionSize: 30, maxNew: 0 })).map((x) => x.cardId)).toContain(id);
  });
  it("a card's FSRS stability is unchanged by its 2nd and 3rd answers on the same day", () => {
    const id = 'mul:6x7';
    const cards: CardMap = {};
    const p = [1, 2, 3, 4].map(() => ({ cardId: id, isNew: false }));
    let clock = T0;
    const runner = new session.SessionRunner(p, cards, mulberry32(3), () => (clock += 20_000), readerSettings());
    const stab: number[] = [];
    const reps: number[] = [];
    for (let i = 0; i < 4; i++) {
      const e = runner.current()!;
      const a = e.problem.answer;
      runner.answer(a, 1500);
      runner.advance();
      const c = runner.getCard(id)!;
      stab.push(c.fsrs.stability);
      reps.push(c.fsrs.reps);
    }
    expect(stab[0]).toBeGreaterThan(0);
    expect(stab[1]).toBe(stab[0]);
    expect(stab[2]).toBe(stab[0]);
    expect(reps).toEqual([1, 1, 1, 1]);
    expect((runner.getCard(id) as CardState & { dayGraded?: number }).dayGraded).toBe(4); // counted, so the plan stops asking at 3
  });
  it('the next day the first answer is a real review again', () => {
    const c0 = answered('mul:6x7', T0 - DAY);
    const runner = new session.SessionRunner([{ cardId: 'mul:6x7', isNew: false }], { 'mul:6x7': c0 }, mulberry32(3), () => T0, readerSettings());
    runner.answer(runner.current()!.problem.answer, 1500);
    expect(runner.getCard('mul:6x7')!.fsrs.reps).toBe(2);
  });
});

describe('missed facts come back in the next run', () => {
  it('a card whose last graded answer was wrong is planned in the very next run, though it is not due', () => {
    const cards: CardMap = {};
    for (const id of factIds(0).slice(0, 20)) cards[id] = { ...answered(id, T0 - 3 * H), fsrs: { ...answered(id, T0 - 3 * H).fsrs, due: T0 + 5 * DAY, stability: 6 } };
    const miss = factIds(0)[25]!;
    cards[miss] = { ...answered(miss, T0 - H, Rating.Again as 1, false), fsrs: { ...answered(miss, T0 - H, Rating.Again as 1, false).fsrs, due: T0 + 4 * H } };
    expect(plan(cards, readerSettings({ sessionSize: 10, maxNew: 0 })).map((x) => x.cardId)).toContain(miss);
  });
});

describe('previews: a little of the locked groups, from the next locked group first', () => {
  const g1Open = () => {
    const cards: CardMap = {};
    for (const id of factIds(0)) cards[id] = { ...answered(id, T0 - 3 * DAY), fsrs: { ...answered(id, T0 - 3 * DAY).fsrs, due: T0 + 9 * DAY, stability: 1.5 } };
    return cards;
  };
  it('a run has up to 2 previews for a reader, from the next locked group', () => {
    const p = plan(g1Open(), readerSettings({ maxNew: 0 }));
    const previews = p.filter((x) => (x as { preview?: boolean }).preview);
    expect(previews).toHaveLength(2);
    expect(previews.every((x) => factIds(1).includes(x.cardId))).toBe(true);
  });
  it('later groups follow once the next one is all seen', () => {
    const cards = g1Open();
    for (const id of factIds(1)) cards[id] = { ...answered(id, T0 - 2 * DAY), fsrs: { ...answered(id, T0 - 2 * DAY).fsrs, due: T0 + 9 * DAY, stability: 1 } };
    const previews = plan(cards, readerSettings({ maxNew: 0 })).filter((x) => (x as { preview?: boolean }).preview);
    expect(previews.every((x) => factIds(2).includes(x.cardId))).toBe(true);
  });
  it('a pre-reader gets 1 preview per run', () => {
    const p = plan({}, prereaderSettings()).filter((x) => (x as { preview?: boolean }).preview);
    expect(p).toHaveLength(1);
  });
  it('a previewed card stays in review while its group is locked', () => {
    const cards = g1Open();
    const id = factIds(3)[0]!;
    cards[id] = { ...answered(id, T0 - 2 * H), fsrs: { ...answered(id, T0 - 2 * H).fsrs, due: T0 - H } };
    expect(mastery.availableCards(cards, readerSettings()).map((d) => d.id)).toContain(id);
    expect(plan(cards, readerSettings({ maxNew: 0 })).map((x) => x.cardId)).toContain(id);
  });
  it('an unseen card in a locked group is not available outside a preview', () => {
    expect(mastery.availableCards({}, readerSettings()).map((d) => d.id)).not.toContain(factIds(3)[0]);
  });
  it('a preview miss keeps the combo, adds no missed chip, and is scheduled like any miss', () => {
    const pv = factIds(3)[0]!;
    const warm = factIds(0).slice(0, 3);
    const items = [...warm.map((cardId) => ({ cardId, isNew: true })), { cardId: pv, isNew: true, preview: true }, { cardId: warm[0]!, isNew: false }] as session.PlanItem[];
    const runner = new session.SessionRunner(items, {}, mulberry32(5), () => T0, readerSettings());
    for (let i = 0; i < 3; i++) {
      runner.answer(runner.current()!.problem.answer, 1500);
      runner.advance();
    }
    expect(runner.current()!.cardId).toBe(pv);
    expect((runner.current() as { preview?: boolean }).preview).toBe(true);
    const a = runner.current()!.problem.answer;
    const wrong = a.kind === 'int' ? { kind: 'int' as const, value: a.value + 1 } : a;
    const fb = runner.answer(wrong, 4000);
    expect(fb.verdict).not.toBe('correct');
    expect(fb.combo).toBe(3); // not broken
    expect((fb as { preview?: boolean }).preview).toBe(true);
    expect(runner.summary().missed).not.toContain(pv);
    expect(runner.getCard(pv)!.fsrs.reps).toBe(1); // went through the one grader
    expect(runner.getCard(pv)!.lastRating).toBe(Rating.Again);
    runner.advance();
    const fb2 = runner.answer(runner.current()!.problem.answer, 1500); // a normal question after it
    expect(fb2.combo).toBe(4);
  });
  it('a real miss still breaks the combo and shows in missed', () => {
    const id = factIds(0)[0]!;
    const runner = new session.SessionRunner([{ cardId: id, isNew: true }, { cardId: factIds(0)[1]!, isNew: true }], {}, mulberry32(5), () => T0, readerSettings());
    runner.answer(runner.current()!.problem.answer, 1500);
    runner.advance();
    const a = runner.current()!.problem.answer;
    const fb = runner.answer(a.kind === 'int' ? { kind: 'int', value: a.value + 1 } : a, 4000);
    expect(fb.combo).toBe(0);
    expect(runner.summary().missed).toHaveLength(1);
  });
});

describe('the unlock gate', () => {
  // Seen, last two answers right, but still under 2 days of stability: not "reviewing" yet.
  const seenTwice = (id: string, ok2 = true): CardState => ({ ...answered(id, T0 - H), fsrs: { ...answered(id, T0 - H).fsrs, stability: 0.5 }, lastResults: [true, ok2] }) as CardState;
  const group = (cards: CardMap, g: number, make: (id: string, i: number) => CardState | null) =>
    factIds(g).forEach((id, i) => {
      const c = make(id, i);
      if (c) cards[id] = c;
    });
  const solid = (id: string) => ({ ...answered(id, T0 - 20 * DAY), fsrs: { ...answered(id, T0 - 20 * DAY).fsrs, stability: 9, reps: 4 } });
  const unlocked = (cards: CardMap, learner?: 'prereader') =>
    (mastery.unlockedGroups as (m: unknown, c: CardMap, s: KidSettings, l?: string) => number)(getModule('facts'), cards, readerSettings(), learner);
  it('opens on 80% reviewing+ as before', () => {
    const cards: CardMap = {};
    group(cards, 0, (id) => solid(id));
    expect(unlocked(cards)).toBeGreaterThanOrEqual(2);
  });
  it('opens when 80% are seen and their last 2 answers were correct, though none is reviewing yet', () => {
    const cards: CardMap = {};
    group(cards, 0, (id, i) => (i < Math.ceil(factIds(0).length * 0.85) ? seenTwice(id) : null));
    expect(unlocked(cards)).toBeGreaterThanOrEqual(2);
  });
  it('does not open when 80% are seen but a last answer was wrong', () => {
    const cards: CardMap = {};
    group(cards, 0, (id, i) => (i < Math.ceil(factIds(0).length * 0.85) ? seenTwice(id, i % 3 !== 0) : null));
    expect(unlocked(cards)).toBe(1);
  });
  it('does not open at 70% seen', () => {
    const cards: CardMap = {};
    group(cards, 0, (id, i) => (i < Math.floor(factIds(0).length * 0.7) ? seenTwice(id) : null));
    expect(unlocked(cards)).toBe(1);
  });
  it('a pre-reader opens add g2 on the second rule only: 80% seen with the last 2 answers right', () => {
    const g1 = getModule('add10')!.cards.filter((c) => c.kind === 'fact' && c.groupIndex === 0);
    const mk = (ok2: boolean): CardMap => Object.fromEntries(g1.map((c, i) => [c.id, i < 10 ? seenTwice(c.id, ok2) : answered(c.id, T0 - H)])) as CardMap;
    const open = (cards: CardMap) => (mastery.unlockedGroups as (m: unknown, c: CardMap, s: KidSettings) => number)(getModule('add10'), cards, prereaderSettings());
    expect(open(mk(true))).toBe(2); // 10 of 12 = 83%
    expect(open(mk(false))).toBe(1);
    // solid on stability alone does not open it for a pre-reader
    const solid = Object.fromEntries(g1.map((c) => [c.id, { ...answered(c.id, T0 - 9 * DAY), fsrs: { ...answered(c.id, T0 - 9 * DAY).fsrs, stability: 12, reps: 4 }, lastResults: [true, false] }])) as CardMap;
    expect(open(solid)).toBe(1);
  });
  it('keeps the parent start-at override', () => {
    expect((mastery.unlockedFactGroups as (c: CardMap, s: KidSettings) => number)({}, readerSettings({ factGroupsUnlocked: 3 }))).toBe(3);
  });
});
