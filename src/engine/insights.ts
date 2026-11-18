import { dayKey } from './game';
import { factBaseline } from './grading';
import { GROUP_UNLOCK_SHARE, LEVEL_LABELS, cardLevel, groupProgress, groupSteady, moduleCoverage, unlockedGroups, type Level } from './mastery';
import { learnerOf, modulesOf, paceOf, type CardMap, type CardState, type KidSettings, type SessionLog } from './models';
import { MODULES, getCardDef, type FactCardDef, type ModuleDef } from './modules';
import { addId, subId } from './modules/early';
import { factId } from './modules/legacy';
import { median } from './scheduler';

// Parent "Learning progress" panel. Pure functions over a kid's cards, sessions and settings. Nothing here reads
// or writes storage, and every threshold comes from mastery.ts (GROUP_UNLOCK_SHARE, cardLevel, groupProgress,
// groupSteady, unlockedGroups) so the panel can never disagree with the planner.

/** Graded answers of one fact in one day above which the panel flags the imbalance. */
export const IMBALANCE_PER_DAY = 3;
/** Runs in a row with no new fact before the panel flags a stuck gate. */
export const STUCK_RUNS = 10;
const DAY_MS = 86_400_000;

type InsightSettings = Pick<KidSettings, 'tracks' | 'modules' | 'factGroupsUnlocked' | 'groupsUnlocked' | 'paceMultiplier' | 'learner'>;

export interface InsightInput {
  cards: CardMap;
  sessions: SessionLog[];
  settings: InsightSettings;
  /** Epoch ms. Passed in so tests never depend on the clock. */
  now: number;
}

// ---- matrix ----

export interface MatrixCell {
  /** Row and column number (the two operands). */
  a: number;
  b: number;
  id: string;
  level: Level;
  /** The kid has answered it at least once. */
  seen: boolean;
  /** Seen early through the preview sprinkle: its group is still locked. */
  preview: boolean;
  groupIndex: number;
  groupLabel: string;
  /** Spoken label, e.g. "6 times 7, not seen". */
  label: string;
  attempts: number;
  correct: number;
  medianMs: number | null;
  lastSeen: number | null;
  due: number | null;
}

export interface Matrix {
  moduleId: ModuleDef['id'];
  kind: 'square' | 'triangle';
  /** Operands run 0 to `max`. */
  max: number;
  /** One row per `a`, one cell per `b`. null = no card there (a gap, drawn grey). */
  rows: (MatrixCell | null)[][];
  /** Distinct cards drawn (a symmetric pair counts once). */
  cardCount: number;
}

function factOp(mod: ModuleDef): { word: string; max: number; kind: 'square' | 'triangle'; idOf: (a: number, b: number) => string | null } {
  if (mod.id === 'add10') return { word: 'plus', max: 10, kind: 'square', idOf: (a, b) => (a + b <= 10 ? addId(a, b) : null) };
  if (mod.id === 'sub10') return { word: 'minus', max: 10, kind: 'triangle', idOf: (a, b) => (b <= a ? subId(a, b) : null) };
  return { word: 'times', max: 12, kind: 'square', idOf: (a, b) => factId(a, b) };
}

/** The cards that make a module's matrix, or null for a module without one (skills). */
export function hasMatrix(mod: ModuleDef): boolean {
  return mod.id === 'facts' || mod.id === 'add10' || mod.id === 'sub10';
}

export function buildMatrix(mod: ModuleDef, input: InsightInput): Matrix {
  const { cards, settings } = input;
  const op = factOp(mod);
  const baseline = factBaseline(cards);
  const pace = paceOf(settings);
  const open = unlockedGroups(mod, cards, settings);
  const defs = new Map(mod.cards.map((c) => [c.id, c]));
  const seenIds = new Set<string>();
  const rows: (MatrixCell | null)[][] = [];
  for (let a = 0; a <= op.max; a++) {
    const row: (MatrixCell | null)[] = [];
    for (let b = 0; b <= op.max; b++) {
      const id = op.idOf(a, b);
      const def = id ? (defs.get(id) as FactCardDef | undefined) : undefined;
      if (!id || !def) {
        row.push(null);
        continue;
      }
      seenIds.add(id);
      const st = cards[id];
      const level = cardLevel(st, baseline, pace);
      const seen = !!st; // same test as moduleCoverage: a card exists once the kid answered it
      const preview = seen && def.groupIndex >= open;
      const groupLabel = mod.groups?.[def.groupIndex]?.label ?? '';
      const state = level === 0 ? 'not seen' : LEVEL_LABELS[level].toLowerCase();
      row.push({
        a,
        b,
        id,
        level,
        seen,
        preview,
        groupIndex: def.groupIndex,
        groupLabel,
        label: `${a} ${op.word} ${b}, ${state}${preview ? ', seen early in a preview' : ''}`,
        attempts: st?.attempts ?? 0,
        correct: st?.correct ?? 0,
        medianMs: st && st.recentMs.length ? median(st.recentMs) : null,
        lastSeen: st ? (st.fsrs.last_review ?? st.updatedAt ?? null) : null,
        due: st ? st.fsrs.due : null,
      });
    }
    rows.push(row);
  }
  return { moduleId: mod.id, kind: op.kind, max: op.max, rows, cardCount: seenIds.size };
}

// ---- summary and ladder ----

export interface LadderRow {
  id: string;
  label: string;
  total: number;
  seen: number;
  /** Share of the group at "reviewing" or better (0 to 1): the first unlock rule. Hidden for a pre-reader. */
  reviewing: number;
  /** Share seen with the last two graded answers right (0 to 1): the second unlock rule. */
  steady: number;
  state: 'open' | 'locked';
  /** True on the first locked row: it opens when the group before it reaches the marker. */
  nextToOpen: boolean;
  /** The group before this one and how close it is, for the first locked row only. */
  gate: { label: string; reviewing: number; steady: number } | null;
}

export interface ModuleInsight {
  moduleId: ModuleDef['id'];
  name: string;
  seen: number;
  total: number;
  /** Facts at "reviewing" or better. */
  reviewingPlus: number;
  /** "Times tables: 81 of 91 facts seen · 56 reviewing or better · next group: 6s, 7s, 8s (locked)" */
  summary: string;
  prereader: boolean;
  /** The unlock marker (0.8), from mastery.ts. */
  marker: number;
  ladder: LadderRow[];
}

export function moduleInsight(mod: ModuleDef, input: InsightInput): ModuleInsight {
  const { cards, settings } = input;
  const baseline = factBaseline(cards);
  const pace = paceOf(settings);
  const cov = moduleCoverage(mod, cards);
  const reviewingPlus = mod.cards.filter((c) => c.kind === 'fact' && cardLevel(cards[c.id], baseline, pace) >= 2).length;
  const open = unlockedGroups(mod, cards, settings);
  const prereader = learnerOf(settings) === 'prereader';
  const groups = mod.groups ?? [];
  const ladder: LadderRow[] = groups.map((g, i) => {
    const locked = i >= open;
    const nextToOpen = i === open;
    const prev = groups[i - 1];
    return {
      id: g.id,
      label: g.label,
      total: g.cardIds.length,
      seen: g.cardIds.filter((id) => cards[id]).length,
      reviewing: groupProgress(mod, i, cards),
      steady: groupSteady(mod, i, cards),
      state: locked ? 'locked' : 'open',
      nextToOpen,
      gate: nextToOpen && prev ? { label: prev.label, reviewing: groupProgress(mod, i - 1, cards), steady: groupSteady(mod, i - 1, cards) } : null,
    };
  });
  const next = groups[open];
  const summary = `${mod.name}: ${cov.seen} of ${cov.total} facts seen · ${reviewingPlus} reviewing or better${next ? ` · next group: ${next.label} (locked)` : ' · every group open'}`;
  return { moduleId: mod.id, name: mod.name, seen: cov.seen, total: cov.total, reviewingPlus, summary, prereader, marker: GROUP_UNLOCK_SHARE, ladder };
}

/** The status line of a ladder row: "open", "locked", or "unlocks at 80% (now 45%)". */
export function ladderStatus(row: LadderRow, prereader: boolean): string {
  if (row.state === 'open') return 'open';
  if (!row.gate) return 'locked';
  const pct = Math.round((prereader ? row.gate.steady : Math.max(row.gate.reviewing, row.gate.steady)) * 100);
  return `unlocks at ${Math.round(GROUP_UNLOCK_SHARE * 100)}% (now ${pct}%)`;
}

// ---- facts counted for enabled modules ----

/** Facts (not skills) of the modules a parent turned on, as card states that exist. */
function enabledFacts(input: InsightInput): CardState[] {
  const on = modulesOf(input.settings);
  const out: CardState[] = [];
  for (const mod of MODULES) {
    if (!on[mod.id]) continue;
    for (const c of mod.cards) {
      if (c.kind !== 'fact') continue;
      const st = input.cards[c.id];
      if (st) out.push(st);
    }
  }
  return out;
}

// ---- pace ----

export interface PaceDay {
  day: string;
  newFacts: number;
  runs: number;
}

export interface Pace {
  /** Oldest first, one entry per day for the last `days` days (days with no run have 0). */
  days: PaceDay[];
  /** New facts per run for runs that started today, oldest first. */
  today: number[];
  weekTotal: number;
  /** "12 new facts this week" */
  line: string;
}

export function newFactPace(sessions: SessionLog[], now: number, days = 14): Pace {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(now - i * DAY_MS));
  const by = new Map<string, PaceDay>(keys.map((k) => [k, { day: k, newFacts: 0, runs: 0 }]));
  const todayKey = dayKey(now);
  const today: number[] = [];
  let weekTotal = 0;
  const weekStart = new Set(keys.slice(-7));
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    const k = dayKey(s.startedAt);
    const d = by.get(k);
    if (d) {
      d.newFacts += s.newLearned;
      d.runs += 1;
    }
    if (weekStart.has(k)) weekTotal += s.newLearned;
    if (k === todayKey) today.push(s.newLearned);
  }
  const line = weekTotal === 1 ? '1 new fact this week' : `${weekTotal} new facts this week`;
  return { days: keys.map((k) => by.get(k)!), today, weekTotal, line };
}

// ---- practice balance ----

export interface BalanceFact {
  id: string;
  label: string;
  attempts: number;
}

export interface Balance {
  most: BalanceFact[];
  least: BalanceFact[];
  /** Over the facts seen at least once, in enabled modules. */
  medianAttempts: number;
  maxAttempts: number;
  factCount: number;
}

function factLabel(id: string): string {
  const def = getCardDef(id);
  if (!def || def.kind !== 'fact') return id;
  const op = def.track === 'add10' ? '+' : def.track === 'sub10' ? '−' : '×';
  return `${def.a} ${op} ${def.b}`;
}

export function practiceBalance(input: InsightInput, top = 5): Balance {
  const facts = enabledFacts(input);
  const rows = facts.map((c) => ({ id: c.id, label: factLabel(c.id), attempts: c.attempts }));
  const byMost = [...rows].sort((a, b) => b.attempts - a.attempts || a.id.localeCompare(b.id));
  const byLeast = [...rows].sort((a, b) => a.attempts - b.attempts || a.id.localeCompare(b.id));
  return {
    most: byMost.slice(0, top),
    least: byLeast.slice(0, top),
    medianAttempts: rows.length ? median(rows.map((r) => r.attempts)) : 0,
    maxAttempts: rows.length ? Math.max(...rows.map((r) => r.attempts)) : 0,
    factCount: rows.length,
  };
}

// ---- needs work ----

export interface NeedsWorkFact {
  id: string;
  label: string;
  level: Level;
  attempts: number;
  correct: number;
  /** 0 to 1. */
  accuracy: number;
  medianMs: number | null;
  stability: number;
  lapses: number;
  /** Missed on a day in the last 7. */
  missedThisWeek: boolean;
}

/**
 * Up to `max` facts to look at: a miss in the last 7 days first, then most lapses, then lowest FSRS stability.
 * A fact is a candidate when it was missed at least once, or its last graded answer was wrong, or it is still
 * "learning" after several tries.
 */
export function needsWork(input: InsightInput, max = 8): NeedsWorkFact[] {
  const baseline = factBaseline(input.cards);
  const pace = paceOf(input.settings);
  const weekDays = new Set(Array.from({ length: 7 }, (_, i) => dayKey(input.now - i * DAY_MS)));
  const rows: NeedsWorkFact[] = enabledFacts(input)
    .map((c) => ({
      id: c.id,
      label: factLabel(c.id),
      level: cardLevel(c, baseline, pace),
      attempts: c.attempts,
      correct: c.correct,
      accuracy: c.attempts ? c.correct / c.attempts : 0,
      medianMs: c.recentMs.length ? median(c.recentMs) : null,
      stability: c.fsrs.stability,
      lapses: c.fsrs.lapses,
      missedThisWeek: !!c.missDay && weekDays.has(c.missDay),
    }))
    .filter((r) => r.attempts > r.correct || r.level === 1);
  rows.sort(
    (a, b) =>
      Number(b.missedThisWeek) - Number(a.missedThisWeek) ||
      b.lapses - a.lapses ||
      a.stability - b.stability ||
      b.attempts - b.correct - (a.attempts - a.correct) ||
      a.id.localeCompare(b.id),
  );
  return rows.slice(0, max);
}

// ---- trend ----

export interface TrendDay {
  day: string;
  graded: number;
  /** 0 to 1, or null on a day with no graded answers. */
  accuracy: number | null;
  /** Median of the runs' median fact times that day, or null. */
  medianMs: number | null;
}

export function trend(sessions: SessionLog[], now: number, days = 14): TrendDay[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(now - i * DAY_MS));
  return keys.map((k) => {
    const runs = sessions.filter((s) => dayKey(s.startedAt) === k);
    const graded = runs.reduce((t, s) => t + s.graded, 0);
    const correct = runs.reduce((t, s) => t + s.correct, 0);
    const times = runs.map((s) => s.medianMs).filter((m) => Number.isFinite(m) && m > 0);
    return { day: k, graded, accuracy: graded ? correct / graded : null, medianMs: times.length ? median(times) : null };
  });
}

// ---- skills ----

export interface SkillRow {
  id: string;
  name: string;
  /** "md" or "fr". */
  prefix: string;
  level: Level;
  attempts: number;
}

/** md: and fr: skills of enabled modules that the kid has met, listed apart from the fact matrix. */
export function skillRows(input: InsightInput): SkillRow[] {
  const on = modulesOf(input.settings);
  const baseline = factBaseline(input.cards);
  const pace = paceOf(input.settings);
  const out: SkillRow[] = [];
  for (const mod of MODULES) {
    if (!on[mod.id]) continue;
    for (const c of mod.cards) {
      if (c.kind !== 'skill') continue;
      const st = input.cards[c.id];
      if (!st) continue;
      out.push({ id: c.id, name: c.label, prefix: c.id.split(':')[0] ?? '', level: cardLevel(st, baseline, pace), attempts: st.attempts });
    }
  }
  return out;
}

// ---- alerts ----

export interface Alert {
  /** stuck: no new facts in 10 runs. unretried: asked once and missed. imbalance: one fact over the daily limit. */
  kind: 'stuck' | 'unretried' | 'imbalance';
  text: string;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function alerts(input: InsightInput): Alert[] {
  const out: Alert[] = [];
  const on = modulesOf(input.settings);
  const prereader = learnerOf(input.settings) === 'prereader';

  // Stuck: the last 10 runs added no new fact and a locked group is waiting.
  const recent = [...input.sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, STUCK_RUNS);
  if (recent.length >= STUCK_RUNS && recent.every((s) => s.newLearned === 0)) {
    for (const mod of MODULES) {
      if (!on[mod.id] || !mod.groups) continue;
      const open = unlockedGroups(mod, input.cards, input.settings);
      const gate = mod.groups[open - 1];
      const waiting = mod.groups[open];
      if (!gate || !waiting) continue;
      const share = prereader ? groupSteady(mod, open - 1, input.cards) : groupProgress(mod, open - 1, input.cards);
      out.push({
        kind: 'stuck',
        text: `No new facts in the last ${STUCK_RUNS} runs in ${mod.name}. Group '${gate.label}' is at ${Math.round(share * 100)}%${prereader ? ' steady (last two answers right)' : ''}, and '${waiting.label}' opens at ${Math.round(GROUP_UNLOCK_SHARE * 100)}%.`,
      });
    }
  }

  // Unretried misses: asked once and missed.
  const once = enabledFacts(input).filter((c) => c.attempts === 1 && c.correct === 0);
  if (once.length) {
    out.push({
      kind: 'unretried',
      text: `${once.length} ${plural(once.length, 'fact has', 'facts have')} been asked only once and ${plural(once.length, 'was', 'were')} missed.`,
    });
  }

  // Imbalance: more than 3 graded answers of one fact today.
  const today = dayKey(input.now);
  const heavy = enabledFacts(input)
    .filter((c) => c.day === today && (c.dayGraded ?? 0) > IMBALANCE_PER_DAY)
    .sort((a, b) => (b.dayGraded ?? 0) - (a.dayGraded ?? 0) || a.id.localeCompare(b.id));
  if (heavy.length) {
    const top = heavy[0]!;
    out.push({
      kind: 'imbalance',
      text:
        heavy.length === 1
          ? `One fact (${factLabel(top.id)}) got ${top.dayGraded} tries today.`
          : `${heavy.length} facts got more than ${IMBALANCE_PER_DAY} tries today. The most: ${factLabel(top.id)} with ${top.dayGraded}.`,
    });
  }
  return out;
}

// ---- the whole panel ----

export interface Insights {
  modules: { insight: ModuleInsight; matrix: Matrix | null }[];
  pace: Pace;
  balance: Balance;
  needsWork: NeedsWorkFact[];
  trend: TrendDay[];
  skills: SkillRow[];
  alerts: Alert[];
}

/** Everything the panel shows, for the modules a parent turned on. Modules without groups (skills) have no ladder or matrix. */
export function buildInsights(input: InsightInput): Insights {
  const on = modulesOf(input.settings);
  return {
    modules: MODULES.filter((m) => on[m.id] && m.groups && hasMatrix(m)).map((m) => ({
      insight: moduleInsight(m, input),
      matrix: buildMatrix(m, input),
    })),
    pace: newFactPace(input.sessions, input.now),
    balance: practiceBalance(input),
    needsWork: needsWork(input),
    trend: trend(input.sessions, input.now),
    skills: skillRows(input),
    alerts: alerts(input),
  };
}
