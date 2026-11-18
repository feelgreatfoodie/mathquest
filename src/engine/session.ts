import type { Grade } from 'ts-fsrs';
import { Rating } from 'ts-fsrs';
import { getCardDef, moduleOfCard, type CardDef } from './modules';
import { factBaseline, gradeAnswer, thresholdsFor } from './grading';
import { cardLevel } from './mastery';
import { learnerOf, learnerParams, paceOf, type CardMap, type CardState, type KidSettings } from './models';
import { answerText, checkAnswer, generateProblem, ICON_IDS, type AnswerInput, type IconId, type Problem, type Rng, type Verdict } from './problems';
import { isDue, median, newCardState, practice, retrievability, review } from './scheduler';

export interface PlanItem {
  cardId: string;
  isNew: boolean;
}

export interface PlanInput {
  cards: CardMap;
  available: CardDef[];
  now: number;
  size: number;
  maxNew: number;
  rng: Rng;
}

/** Most new skill (procedure) cards per run; the rest of the new budget goes to facts. */
const MAX_NEW_SKILLS = 2;

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
 *  1. due reviews, most-forgotten first (capped at size)
 *  2. new cards in curriculum order, if there is room (facts and skills both)
 *  3. "practice ahead" on the weakest seen cards to fill the run
 * New cards are spread through the first 70% of the run so misses can be retried before the end.
 */
export function planSession({ cards, available, now, size, maxNew, rng }: PlanInput): PlanItem[] {
  const seen = available.filter((d) => cards[d.id]);
  const byWeakest = (a: CardDef, b: CardDef) => retrievability(cards[a.id]!, now) - retrievability(cards[b.id]!, now);

  const due = seen.filter((d) => isDue(cards[d.id]!, now)).sort(byWeakest);
  const reviews = due.slice(0, size);

  const room = Math.max(0, size - reviews.length);
  const unseen = available.filter((d) => !cards[d.id]);
  const newSkills = unseen.filter((d) => d.kind === 'skill').slice(0, Math.min(MAX_NEW_SKILLS, room, maxNew));
  const newFacts = unseen.filter((d) => d.kind !== 'skill').slice(0, Math.min(room, maxNew) - newSkills.length);
  const fresh = [...newSkills, ...newFacts];

  const fillCount = Math.max(0, size - reviews.length - fresh.length);
  const dueIds = new Set(reviews.map((d) => d.id));
  const ahead = seen.filter((d) => !dueIds.has(d.id)).sort(byWeakest).slice(0, fillCount);

  // Short on history (e.g. the first runs)? Probe more unseen facts. A fast correct answer on a
  // never-seen fact means it is already known, so these double as a placement test.
  const short = size - reviews.length - fresh.length - ahead.length;
  if (short > 0) {
    const chosen = new Set(fresh.map((d) => d.id));
    fresh.push(...unseen.filter((d) => d.kind !== 'skill' && !chosen.has(d.id)).slice(0, short));
  }

  const base: PlanItem[] = shuffle([...reviews, ...ahead], rng).map((d) => ({ cardId: d.id, isNew: false }));
  const out = [...base];
  const span = Math.max(1, Math.floor(Math.max(out.length, fresh.length) * 0.7));
  shuffle(fresh, rng).forEach((d, i) => {
    const pos = Math.min(out.length, Math.floor(((i + 0.5) * span) / fresh.length) + i);
    out.splice(pos, 0, { cardId: d.id, isNew: true });
  });
  return out;
}

export interface Entry {
  cardId: string;
  /** teach = show a worked example (new skills); graded = first scored attempt; practice = in-run retry */
  kind: 'teach' | 'graded' | 'practice';
  isNew: boolean;
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
  /** Facts whose time this run beat their previous median. */
  faster: string[];
}

const MAX_RETRIES = 2;

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
  private lastIcon: IconId | null = null;
  private combo = 0;
  private bestCombo = 0;
  private xp = 0;
  private times: number[] = [];
  private stats = { answered: 0, graded: 0, correct: 0, fast: 0, newLearned: 0 };
  private missed = new Set<string>();
  private faster = new Set<string>();

  constructor(
    plan: PlanItem[],
    cards: CardMap,
    private rng: Rng,
    private clock: () => number = Date.now,
    settings?: Pick<KidSettings, 'paceMultiplier' | 'learner'>,
  ) {
    this.pace = paceOf(settings);
    this.retryGap = learnerParams(learnerOf(settings)).retryGap;
    this.cards = { ...cards };
    this.baseline = factBaseline(cards);
    for (const item of plan) {
      const def = getCardDef(item.cardId);
      if (!def) continue;
      const problem = this.make(item.cardId, rng);
      if (item.isNew && def.kind === 'skill') {
        this.queue.push({ cardId: item.cardId, kind: 'teach', isNew: true, problem });
        this.queue.push({ cardId: item.cardId, kind: 'graded', isNew: true, problem: this.make(item.cardId, rng) });
      } else {
        this.queue.push({ cardId: item.cardId, kind: 'graded', isNew: item.isNew, problem });
      }
    }
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

  acknowledge(): void {
    if (this.current()?.kind === 'teach') this.index++;
  }

  advance(): void {
    this.index++;
  }

  /**
   * Grades one answer. `peeked` is for pre-readers who hid the pictures and looked: a peek grades Hard at best.
   */
  answer(input: AnswerInput, ms: number, opts: { peeked?: boolean } = {}): Feedback {
    const entry = this.current();
    if (!entry || entry.kind === 'teach') throw new Error('No question to answer');
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
      next = review(prev, rating, ms, correct, now);
      this.stats.graded++;
      if (correct) this.stats.correct++;
      if (fast) this.stats.fast++;
      if (entry.isNew && correct) this.stats.newLearned++;
      if (!correct) this.missed.add(entry.cardId);
    } else {
      next = practice(prev, ms, correct, now);
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
      const at = Math.min(this.queue.length, this.index + 1 + this.retryGap);
      this.queue.splice(at, 0, {
        cardId: entry.cardId,
        kind: 'practice',
        isNew: false,
        problem: this.make(entry.cardId, this.rng),
      });
    }

    this.combo = correct ? this.combo + 1 : 0;
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
    };
  }

  getCard(id: string): CardState | undefined {
    return this.cards[id];
  }

  /** Cards changed this run (save these). */
  changedCards(): CardState[] {
    return [...this.changed].map((id) => this.cards[id]!);
  }

  summary(): RunSummary {
    const gems = Math.floor(this.stats.correct / 5) + (this.bestCombo >= 10 ? 2 : 0) + (this.stats.newLearned >= 3 ? 1 : 0);
    return {
      ...this.stats,
      medianMs: this.times.length ? Math.round(median(this.times)) : 0,
      xp: this.xp,
      gems,
      bestCombo: this.bestCombo,
      missed: [...this.missed],
      faster: [...this.faster],
    };
  }
}
