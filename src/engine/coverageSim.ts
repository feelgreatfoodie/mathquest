import { availableCards, unlockedGroups } from './mastery';
import { dayKey } from './game';
import { learnerOf, modulesOf, type CardMap, type CardState, type KidSettings } from './models';
import { MODULES, moduleOfCard } from './modules';
import { getCardDef } from './content';
import { mulberry32 } from './problems';
import * as session from './session';

/**
 * A deterministic evening of runs for one kid: seeded rng, a fixed accuracy, fixed pauses. It plans each run with
 * `buildPlan` when the build has it and with the old available-cards + planSession recipe when it does not, so the
 * same file measures main (before) and the coverage build (after).
 */
export interface EveningInput {
  cards: CardMap;
  settings: KidSettings;
  start: number;
  runs: number;
  accuracy: number;
  seed: number;
  /** Fact ids that count as "the module" for coverage metrics. */
  universe: string[];
}

export interface RunLog {
  entries: { cardId: string; kind: string; correct: boolean; preview: boolean }[];
}

export interface EveningResult {
  runs: RunLog[];
  cards: CardMap;
  seenAtEnd: number;
  universe: number;
  maxGradedPerCard: number;
  cardsOverCap: number;
  /** Cards that did not come back in the next run, and how many of those had 3 graded answers already. */
  missedNotBack: number;
  missedNotBackAtCap: number;
  missedTotal: number;
  /** First run (1-based) in which each unseen-at-start group's cards first appeared; undefined if never. */
  firstSeenRun: Record<string, number | undefined>;
  maxPreviewsPerRun: number;
  /** First run (1-based) at whose start each later group was open, e.g. add10:g2. */
  openedAtRun: Record<string, number | undefined>;
  emptyRuns: number;
  /** Planned items per run (before in-run retries). */
  planned: number[];
  /** Cards whose FSRS state changed after the first run with no graded answer in it. */
  fsrsChangedAfterCap: number;
  /** First run (1-based) with no graded answer, if any. */
  firstUngradedRun?: number;
  shortRuns: number;
  answers: number;
  /** Largest number of graded answers any card got, and the 5 cards with the most. */
  top: { id: string; graded: number }[];
  /** FSRS reps and stability per card changed during the evening, for the same-day check. */
  maxRepsGain: number;
}

type Loose = {
  buildPlan?: (i: { cards: CardMap; settings: KidSettings; now: number; rng: () => number }) => session.PlanItem[];
};

function planFor(cards: CardMap, settings: KidSettings, now: number, rng: () => number): session.PlanItem[] {
  const b = (session as unknown as Loose).buildPlan;
  if (b) return b({ cards, settings, now, rng });
  const prereader = learnerOf(settings) === 'prereader';
  const available = availableCards(cards, settings).filter((c) => !prereader || moduleOfCard(c.id)?.input === 'choices');
  return session.planSession({ cards, available, now, size: settings.sessionSize, maxNew: settings.maxNew, rng });
}

export function runEvening(inp: EveningInput): EveningResult {
  const rng = mulberry32(inp.seed);
  const ans = mulberry32(inp.seed + 1);
  let cards: CardMap = { ...inp.cards };
  let now = inp.start;
  const runs: RunLog[] = [];
  const graded: Record<string, number> = {};
  const startReps = Object.fromEntries(Object.entries(cards).map(([id, c]) => [id, c.fsrs.reps]));
  const firstSeenRun: Record<string, number | undefined> = {};
  let missedNotBack = 0;
  let missedNotBackAtCap = 0;
  let missedTotal = 0;
  let prevMissed: { id: string; atCap: boolean }[] = [];
  let maxPreviewsPerRun = 0;
  const openedAtRun: Record<string, number | undefined> = {};
  let emptyRuns = 0;
  const planned: number[] = [];
  let capSnapshot: Record<string, string> | null = null;
  let firstUngradedRun: number | undefined;
  let shortRuns = 0;
  const groupOf = (id: string) => {
    const d = getCardDef(id);
    return d && d.kind === 'fact' ? `${d.track}:g${d.groupIndex + 1}` : null;
  };
  for (let r = 1; r <= inp.runs; r++) {
    const on = modulesOf(inp.settings);
    for (const mod of MODULES) {
      if (!on[mod.id] || !mod.groups) continue;
      const open = unlockedGroups(mod, cards, inp.settings);
      for (let g = 2; g <= open; g++) if (openedAtRun[`${mod.id}:g${g}`] === undefined) openedAtRun[`${mod.id}:g${g}`] = r;
    }
    const plan = planFor(cards, inp.settings, now, rng);
    const log: RunLog = { entries: [] };
    runs.push(log);
    planned.push(plan.length);
    if (plan.length === 0) {
      emptyRuns++;
      prevMissed.forEach(() => void 0);
      for (const m of prevMissed) {
        missedNotBack++;
        if (m.atCap) missedNotBackAtCap++;
      }
      prevMissed = [];
      now += 120_000;
      continue;
    }
    if (plan.length < inp.settings.sessionSize) shortRuns++;
    const runner = new session.SessionRunner(plan, cards, mulberry32(inp.seed + 100 + r), () => now, inp.settings);
    const missedHere: { id: string; atCap: boolean }[] = [];
    let guard = 0;
    while (!runner.done() && guard++ < 400) {
      const e = runner.current()!;
      if (e.kind === 'teach') {
        runner.acknowledge();
        continue;
      }
      const a = e.problem.answer;
      const right = ans() < inp.accuracy;
      const input = a.kind === 'int' ? { kind: 'int' as const, value: right ? a.value : a.value + 1 } : a;
      const fb = runner.answer(input, 2500);
      const preview = !!(e as { preview?: boolean }).preview;
      log.entries.push({ cardId: e.cardId, kind: e.kind, correct: fb.verdict === 'correct', preview });
      if (e.kind === 'graded') {
        graded[e.cardId] = (graded[e.cardId] ?? 0) + 1;
        if (fb.verdict !== 'correct') {
          missedTotal++;
          missedHere.push({ id: e.cardId, atCap: (graded[e.cardId] ?? 0) >= 3 });
        }
      }
      const g = groupOf(e.cardId);
      if (g && firstSeenRun[g] === undefined && !startReps[e.cardId]) firstSeenRun[g] = r;
      runner.advance();
      now += 4000;
    }
    maxPreviewsPerRun = Math.max(maxPreviewsPerRun, log.entries.filter((x) => x.preview).length);
    // Misses of the previous run must be in this one.
    const inThis = new Set(log.entries.map((x) => x.cardId));
    for (const m of prevMissed) {
      if (!inThis.has(m.id)) {
        missedNotBack++;
        if (m.atCap) missedNotBackAtCap++;
      }
    }
    prevMissed = missedHere;
    if (firstUngradedRun === undefined && !log.entries.some((x) => x.kind === 'graded')) {
      firstUngradedRun = r;
    }
    cards = { ...cards, ...Object.fromEntries(runner.changedCards().map((c: CardState) => [c.id, c])) };
    if (firstUngradedRun === r && !capSnapshot) capSnapshot = Object.fromEntries(Object.entries(cards).map(([id, c]) => [id, JSON.stringify(c.fsrs)]));
    now += 120_000;
  }
  const seenAtEnd = inp.universe.filter((id) => cards[id]).length;
  const counts = Object.values(graded);
  const top = Object.entries(graded).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, g]) => ({ id, graded: g }));
  const maxRepsGain = Math.max(0, ...Object.entries(cards).map(([id, c]) => c.fsrs.reps - (startReps[id] ?? 0)));
  return {
    runs,
    cards,
    seenAtEnd,
    universe: inp.universe.length,
    maxGradedPerCard: Math.max(0, ...counts),
    cardsOverCap: counts.filter((n) => n > 3).length,
    missedNotBack,
    missedNotBackAtCap,
    missedTotal,
    firstSeenRun,
    maxPreviewsPerRun,
    openedAtRun,
    emptyRuns,
    planned,
    fsrsChangedAfterCap: capSnapshot ? Object.entries(capSnapshot).filter(([id, f]) => JSON.stringify(cards[id]!.fsrs) !== f).length : 0,
    ...(firstUngradedRun !== undefined ? { firstUngradedRun } : {}),
    shortRuns,
    answers: runs.reduce((n, r) => n + r.entries.length, 0),
    top,
    maxRepsGain,
  };
}

export { dayKey };
