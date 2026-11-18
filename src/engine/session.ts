import type { Grade } from 'ts-fsrs';
import { Rating } from 'ts-fsrs';
import { getCardDef, moduleOfCard, type CardDef } from './modules';
import { factBaseline, gradeAnswer, thresholdsFor } from './grading';
import { cardLevel, availableCards, previewPool } from './mastery';
import { dayKey } from './game';
import { gemsForRun } from './gems';
import { learnerOf, learnerParams, paceOf, type CardMap, type CardState, type KidSettings, type Learner } from './models';
import { answerText, checkAnswer, generateProblem, ICON_IDS, type AnswerInput, type IconId, type Problem, type Rng, type Verdict } from './problems';
import { DAILY_GRADED_CAP, gradedToday, isDue, median, newCardState, noteGraded, practice, retrievability, review } from './scheduler';

export interface PlanItem {
  cardId: string;
  isNew: boolean;
  /** An unseen card from a locked group, shown with its hint. A miss on it does not count against the kid. */
  preview?: boolean;
  /** Ungraded practice that fills a run once no card has graded answers left today. FSRS does not change. */
  fill?: boolean;
}

export interface PlanInput {
  cards: CardMap;
  available: CardDef[];
  now: number;
  size: number;
  maxNew: number;
  rng: Rng;
  /** Unseen cards of locked groups in preview order (see previewPool). */
  locked?: CardDef[];
  /** Most previews in this run. */
  previewMax?: number;
  /** Slots at the start of the run that hold no preview. At least 1: a run opens with a known fact. */
  previewFloor?: number;
}

/** Slots at the start of a run with no preview: pre-readers 3, readers 2. */
export const PREVIEW_FLOOR = { prereader: 3, reader: 2 } as const;

/** Most new skill (procedure) cards per run; the rest of the new budget goes to facts. */
const MAX_NEW_SKILLS = 2;

/**
 * Moves previews so none sits in the first `floor` slots and no two sit next to each other. Each preview moves
 * the least it can, later only. The other items keep their order and slots. A run too short for both rules
 * packs the previews at the end.
 */
export function placePreviews(items: PlanItem[], floor: number): PlanItem[] {
  const n = items.length;
  const from = items.flatMap((x, i) => (x.preview ? [i] : []));
  const m = from.length;
  if (!m) return items;
  const pos: number[] = [];
  from.forEach((at, k) => pos.push(Math.max(at, floor, k ? pos[k - 1]! + 2 : 0)));
  for (let k = m - 1; k >= 0; k--) pos[k] = Math.min(pos[k]!, k === m - 1 ? n - 1 : pos[k + 1]! - 2);
  if (pos.some((p, k) => p < floor || p < k)) pos.splice(0, m, ...from.map((_, k) => n - m + k));
  const previews = items.filter((x) => x.preview);
  const rest = items.filter((x) => !x.preview);
  const at = new Set(pos);
  let r = 0;
  let q = 0;
  return items.map((_, i) => (at.has(i) ? previews[q++]! : rest[r++]!));
}

function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Builds one run:
 *  1. facts missed last time, then due reviews, most-forgotten first (capped at size)
 *  2. new cards in curriculum order, if there is room (facts and skills both)
 *  3. up to `previewMax` previews: unseen cards of locked groups, next locked group first
 *  4. "practice ahead" on seen cards to fill the run: missed today, then least recently answered, then weakest
 * A card that already had DAILY_GRADED_CAP graded answers today is left out of 1 and 4: it can only come back
 * as an in-run retry. New cards and previews are spread through the first 70% of the run so misses can be
 * retried before the end. Then previews move later so none is in the first `previewFloor` slots or next to another.
 */
export function planSession({ cards, available, now, size, maxNew, rng, locked = [], previewMax = 0, previewFloor = 1 }: PlanInput): PlanItem[] {
  const today = dayKey(now);
  const seen = available.filter((d) => cards[d.id]);
  const open = seen.filter((d) => gradedToday(cards[d.id], now) < DAILY_GRADED_CAP);
  const byWeakest = (a: CardDef, b: CardDef) => retrievability(cards[a.id]!, now) - retrievability(cards[b.id]!, now);

  const due = open.filter((d) => isDue(cards[d.id]!, now)).sort(byWeakest);
  const dueIds = new Set(due.map((d) => d.id));
  // Last graded answer wrong: back in the very next run, not only when FSRS says it is due.
  const missed = open.filter((d) => !dueIds.has(d.id) && cards[d.id]!.lastResults?.at(-1) === false).sort(byWeakest);
  const reviews = [...missed, ...due].slice(0, size);

  const room = Math.max(0, size - reviews.length);
  const unseen = available.filter((d) => !cards[d.id]);
  const newSkills = unseen.filter((d) => d.kind === 'skill').slice(0, Math.min(MAX_NEW_SKILLS, room, maxNew));
  const newFacts = unseen.filter((d) => d.kind !== 'skill').slice(0, Math.min(room, maxNew) - newSkills.length);
  const fresh: PlanItem[] = [...newSkills, ...newFacts].map((d) => ({ cardId: d.id, isNew: true }));
  const previews: PlanItem[] = locked
    .filter((d) => !cards[d.id])
    .slice(0, previewMax)
    .map((d) => ({ cardId: d.id, isNew: true, preview: true }));

  const fillCount = Math.max(0, size - reviews.length - fresh.length - previews.length);
  const chosen = new Set(reviews.map((d) => d.id));
  const missedToday = (d: CardDef) => (cards[d.id]!.missDay === today ? 0 : 1);
  const byFill = (a: CardDef, b: CardDef) =>
    missedToday(a) - missedToday(b) || cards[a.id]!.updatedAt - cards[b.id]!.updatedAt || byWeakest(a, b);
  const ahead = open.filter((d) => !chosen.has(d.id)).sort(byFill).slice(0, fillCount);

  // Short on history (e.g. the first runs)? Probe more unseen facts. A fast correct answer on a
  // never-seen fact means it is already known, so these double as a placement test.
  const short = size - reviews.length - fresh.length - previews.length - ahead.length;
  if (short > 0) {
    const have = new Set(fresh.map((i) => i.cardId));
    fresh.push(...unseen.filter((d) => d.kind !== 'skill' && !have.has(d.id)).slice(0, short).map((d) => ({ cardId: d.id, isNew: true })));
  }

  // Nothing graded is left (every seen card hit today's cap)? Fill the rest of the run with ungraded practice,
  // least recently answered first, then weakest. The kid never meets an empty run; FSRS is not touched.
  const placed = reviews.length + ahead.length + fresh.length + previews.length;
  const aheadIds = new Set(ahead.map((d) => d.id));
  // A card answered in the last hour goes to the back, so a round does not repeat the cards the kid just saw; then the byFill order.
  const recent = (d: CardDef) => (now - cards[d.id]!.updatedAt < FILL_REST_MS ? 1 : 0);
  const practicePool = seen.filter((d) => !chosen.has(d.id) && !aheadIds.has(d.id)).sort((a, b) => recent(a) - recent(b) || byFill(a, b));
  const practiceItems: PlanItem[] = [];
  for (let i = 0; practicePool.length && placed + practiceItems.length < size; i++) {
    practiceItems.push({ cardId: practicePool[i % practicePool.length]!.id, isNew: false, fill: true });
  }

  const base: PlanItem[] = shuffle(
    [...reviews, ...ahead].map((d): PlanItem => ({ cardId: d.id, isNew: false })).concat(practiceItems),
    rng,
  );
  const out = [...base];
  const spread = [...fresh, ...previews];
  const span = Math.max(1, Math.floor(Math.max(out.length, spread.length) * 0.7));
  shuffle(spread, rng).forEach((item, i) => {
    const pos = Math.min(out.length, Math.floor(((i + 0.5) * span) / spread.length) + i);
    out.splice(pos, 0, item);
  });
  return placePreviews(out, previewFloor);
}

export interface BuildPlanInput {
  cards: CardMap;
  settings: KidSettings;
  now: number;
  rng: Rng;
}

/** The plan for one run of one kid: available cards, previews and sizes all come from the kid's settings. */
export function buildPlan({ cards, settings, now, rng }: BuildPlanInput): PlanItem[] {
  const prereader = learnerOf(settings) === 'prereader';
  // A pre-reader only gets picture modules: a keypad question has nothing they could read.
  const ok = (d: CardDef) => !prereader || moduleOfCard(d.id)?.input === 'choices';
  return planSession({
    cards,
    available: availableCards(cards, settings).filter(ok),
    now,
    size: settings.sessionSize,
    maxNew: settings.maxNew,
    rng,
    locked: previewPool(cards, settings).filter(ok),
    previewMax: prereader ? 1 : 2,
    previewFloor: prereader ? PREVIEW_FLOOR.prereader : PREVIEW_FLOOR.reader,
  });
}

export interface Entry {
  /** Unique within one runner. A mode that lets the kid pick the order answers by this id. */
  id: string;
  cardId: string;
  /** teach = show a worked example (new skills); graded = first scored attempt; practice = in-run retry */
  kind: 'teach' | 'graded' | 'practice';
  isNew: boolean;
  /** A preview of a locked group: the hint shows first and a miss does not count against the kid. */
  preview?: boolean;
  /** Ungraded fill practice: answered through practice(), so FSRS does not change. */
  fill?: boolean;
  problem: Problem;
}

export interface Feedback {
  verdict: Verdict;
  correctAnswer: string;
  hint: string;
  rating: Grade | null;
  fast: boolean;
  xp: number;
  combo: number;
  /** The answered entry was a preview. */
  preview?: boolean;
}

export interface RunSummary {
  answered: number;
  graded: number;
  correct: number;
  fast: number;
  newLearned: number;
  medianMs: number;
  xp: number;
  gems: number;
  bestCombo: number;
  missed: string[];
  /** Right answers on ungraded fill practice. Present only when above 0, so the golden summary keeps its shape; a missing value reads as 0. */
  practiceCorrect?: number;
  /** Fill practice answers given (right or wrong), without in-run retries. Present only when above 0; a missing value reads as 0. */
  fillAnswered?: number;
  /** Facts whose time this run beat their previous median. */
  faster: string[];
}

const MAX_RETRIES = 2;
/** Fill practice prefers cards not answered in the last hour. */
export const FILL_REST_MS = 60 * 60 * 1000;

/**
 * Runs one session. Pure and UI-free: the UI shows `current()`, times the answer, and calls
 * `answer()` (or `acknowledge()` for teach entries), then `advance()`.
 */
export class SessionRunner {
  readonly queue: Entry[] = [];
  private index = 0;
  private cards: CardMap;
  private changed = new Set<string>();
  private retries = new Map<string, number>();
  private baseline: number;
  private pace: number;
  private retryGap: number;
  private learner: Learner;
  private lastIcon: IconId | null = null;
  private combo = 0;
  private bestCombo = 0;
  private xp = 0;
  private times: number[] = [];
  private stats = { answered: 0, graded: 0, correct: 0, fast: 0, newLearned: 0 };
  private newIds: string[] = [];
  private practiceCorrect = 0;
  private fillAnswered = 0;
  private missed = new Set<string>();
  private faster = new Set<string>();
  private nextId = 0;
  private resolved = new Set<string>();

  constructor(
    plan: PlanItem[],
    cards: CardMap,
    private rng: Rng,
    private clock: () => number = Date.now,
    settings?: Pick<KidSettings, 'paceMultiplier' | 'learner'>,
  ) {
    this.pace = paceOf(settings);
    this.learner = learnerOf(settings);
    this.retryGap = learnerParams(learnerOf(settings)).retryGap;
    this.cards = { ...cards };
    this.baseline = factBaseline(cards);
    this.append(plan, rng);
  }

  /**
   * Adds entries after the existing ones, from plan items, with fresh ids. The constructor builds the plan this way,
   * and a mode that adds a question mid-run (the Overworld boss fight) does the same. Teach and graded entries are built
   * exactly as for a plan.
   */
  append(plan: PlanItem[], rng: Rng = this.rng): Entry[] {
    const before = this.queue.length;
    for (const item of plan) {
      const def = getCardDef(item.cardId);
      if (!def) continue;
      const problem = this.make(item.cardId, rng);
      if (item.isNew && def.kind === 'skill') {
        this.queue.push({ id: this.mintId(), cardId: item.cardId, kind: 'teach', isNew: true, problem });
        this.queue.push({ id: this.mintId(), cardId: item.cardId, kind: 'graded', isNew: true, problem: this.make(item.cardId, rng) });
      } else if (item.fill) {
        this.queue.push({ id: this.mintId(), cardId: item.cardId, kind: 'practice', isNew: false, fill: true, problem });
      } else {
        this.queue.push({ id: this.mintId(), cardId: item.cardId, kind: 'graded', isNew: item.isNew, ...(item.preview ? { preview: true } : {}), problem });
      }
    }
    return this.queue.slice(before);
  }

  private mintId(): string {
    return `e${this.nextId++}`;
  }

  /** Builds a problem and gives picture problems a different icon from the one before. */
  private make(cardId: string, rng: Rng): Problem {
    const p = generateProblem(cardId, rng);
    if (p.visual) {
      if (p.visual.icon === this.lastIcon) p.visual = { ...p.visual, icon: ICON_IDS[(ICON_IDS.indexOf(p.visual.icon) + 1) % ICON_IDS.length]! };
      this.lastIcon = p.visual.icon;
    }
    return p;
  }

  current(): Entry | null {
    return this.queue[this.index] ?? null;
  }

  get position(): number {
    return this.index;
  }

  get length(): number {
    return this.queue.length;
  }

  done(): boolean {
    return this.index >= this.queue.length;
  }

  /**
   * How far through the run, 0 to 1: graded entries answered over graded entries planned. A retry, a teach card and
   * the answer in progress never count, and retries are spliced in after the current entry, so the entries before
   * the position never change: the value never goes down. A plan with no graded entry (all fill practice) counts the
   * fill entries instead.
   */
  progress(): number {
    const base = (e: Entry) => e.kind === 'graded';
    const anyGraded = this.queue.some(base);
    const counts = (e: Entry) => (anyGraded ? base(e) : !!e.fill);
    const total = this.queue.filter(counts).length;
    if (total === 0) return this.done() ? 1 : 0;
    return this.queue.slice(0, this.index).filter(counts).length / total;
  }

  acknowledge(): void {
    if (this.current()?.kind === 'teach') this.index++;
  }

  advance(): void {
    this.index++;
  }

  /**
   * Grades the entry at the current position. `peeked` is for pre-readers who hid the pictures and looked:
   * a peek grades Hard at best.
   */
  answer(input: AnswerInput, ms: number, opts: { peeked?: boolean } = {}): Feedback {
    const entry = this.current();
    if (!entry || entry.kind === 'teach') throw new Error('No question to answer');
    return this.grade(entry, this.index, input, ms, opts);
  }

  /**
   * Grades a chosen entry, for modes where the kid picks the order. It runs the same `grade()` as
   * `answer()`, so card states do not depend on the order. Each entry can be answered once.
   * Retries land after the answered entry. Walk the queue with `pending()`, not `advance()`.
   */
  answerEntry(entryId: string, input: AnswerInput, ms: number, opts: { peeked?: boolean } = {}): Feedback {
    const at = this.queue.findIndex((e) => e.id === entryId);
    const entry = this.queue[at];
    if (!entry) throw new Error(`No entry ${entryId}`);
    if (entry.kind === 'teach') throw new Error('No question to answer');
    if (this.resolved.has(entry.id)) throw new Error(`Entry ${entryId} was already answered`);
    return this.grade(entry, at, input, ms, opts);
  }

  /** Entries still waiting for an answer: not yet answered, and not teach cards. */
  pending(): Entry[] {
    return this.queue.filter((e) => e.kind !== 'teach' && !this.resolved.has(e.id));
  }

  private grade(entry: Entry, at: number, input: AnswerInput, ms: number, opts: { peeked?: boolean }): Feedback {
    this.resolved.add(entry.id);
    const def = getCardDef(entry.cardId)!;
    const mod = moduleOfCard(entry.cardId);
    const now = this.clock();
    const verdict = checkAnswer(entry.problem, input);
    const correct = verdict === 'correct';
    const th = thresholdsFor(def, this.baseline, this.pace);
    const fast = correct && ms <= th.fastMs;
    let rating: Grade | null = null;

    const prev = this.cards[entry.cardId] ?? newCardState(entry.cardId, now);
    const prevMedian = median(prev.recentMs);
    let next: CardState;
    if (entry.kind === 'graded') {
      rating = gradeAnswer(verdict, ms, th);
      // A new skill was just demonstrated, so its first answer can't prove long-term memory.
      if (entry.isNew && def.kind === 'skill' && rating === Rating.Easy) rating = Rating.Good;
      // With three buttons a first-time right answer may be a guess, so it can't be Easy.
      if (entry.isNew && correct && mod?.input === 'choices' && rating === Rating.Easy) rating = Rating.Good;
      if (opts.peeked && correct && (rating === Rating.Easy || rating === Rating.Good)) rating = Rating.Hard;
      // After a card's first graded answer today, later ones are practice: same-day repeats must not
      // inflate FSRS stability (a fluent look after one evening) or crush it (one slip).
      const repeatToday = gradedToday(prev, now) >= 1;
      next = noteGraded(repeatToday ? practice(prev, ms, correct, now) : review(prev, rating, ms, correct, now), correct, now);
      // A preview miss is information, not a mistake: it counts against nothing the kid sees.
      const free = !!entry.preview && !correct;
      if (!free) this.stats.graded++;
      if (correct) this.stats.correct++;
      if (fast) this.stats.fast++;
      if (entry.isNew && correct) {
        this.stats.newLearned++;
        this.newIds.push(entry.cardId);
      }
      if (!correct && !free) this.missed.add(entry.cardId);
    } else {
      next = practice(prev, ms, correct, now);
      // Fill practice only: an in-run retry of a missed card is not a new answer, and a teach card is not an answer.
      if (entry.fill) this.fillAnswered++;
      if (correct && entry.fill) this.practiceCorrect++;
    }
    this.cards[entry.cardId] = next;
    this.changed.add(entry.cardId);
    this.stats.answered++;
    if (correct) this.times.push(ms);
    if (correct && def.kind === 'fact' && Number.isFinite(prevMedian) && ms < prevMedian) this.faster.add(entry.cardId);

    // Retry misses and slow answers a few questions later; extra reps for skills still being learned.
    const tries = this.retries.get(entry.cardId) ?? 0;
    const slow = correct && rating === Rating.Hard;
    const learningSkill = correct && entry.kind === 'graded' && def.kind === 'skill' && cardLevel(prev, this.baseline, this.pace) < 3;
    if ((!correct || slow || learningSkill) && tries < MAX_RETRIES) {
      this.retries.set(entry.cardId, tries + 1);
      const insertAt = Math.min(this.queue.length, at + 1 + this.retryGap);
      this.queue.splice(insertAt, 0, {
        id: this.mintId(),
        cardId: entry.cardId,
        kind: 'practice',
        isNew: false,
        problem: this.make(entry.cardId, this.rng),
      });
    }

    // A preview miss leaves the combo alone.
    this.combo = correct ? this.combo + 1 : entry.preview ? this.combo : 0;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const gained = correct ? (entry.kind === 'graded' ? 10 : 5) + (fast ? 5 : 0) + (this.combo >= 5 ? 2 : 0) : 0;
    this.xp += gained;

    return {
      verdict,
      correctAnswer: answerText(entry.problem),
      hint: entry.problem.hint,
      rating,
      fast,
      xp: gained,
      combo: this.combo,
      ...(entry.preview ? { preview: true } : {}),
    };
  }

  getCard(id: string): CardState | undefined {
    return this.cards[id];
  }

  /** Cards changed this run (save these). */
  changedCards(): CardState[] {
    return [...this.changed].map((id) => this.cards[id]!);
  }

  /** Cards first answered correctly this run, in answer order. Kept out of summary(): the golden profile pins that shape. */
  newlyLearned(): string[] {
    return [...this.newIds];
  }

  summary(): RunSummary {
    // Gems at Normal speed and full rate. saveRun re-works them with the parent settings and today's count (gemsForRun).
    const gems = gemsForRun({ ...this.stats, practiceCorrect: this.practiceCorrect, bestCombo: this.bestCombo }, this.learner, {}, 0);
    return {
      ...this.stats,
      medianMs: this.times.length ? Math.round(median(this.times)) : 0,
      xp: this.xp,
      gems,
      bestCombo: this.bestCombo,
      missed: [...this.missed],
      faster: [...this.faster],
      ...(this.practiceCorrect ? { practiceCorrect: this.practiceCorrect } : {}),
      ...(this.fillAnswered ? { fillAnswered: this.fillAnswered } : {}),
    };
  }
}
