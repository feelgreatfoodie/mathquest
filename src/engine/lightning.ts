import { newCardState, repeatAnswer, median } from './scheduler';
import { thresholdsFor, factBaseline } from './grading';
import { needsWork, type InsightInput } from './insights';
import { cardLevel, previewPool } from './mastery';
import { learnerOf, paceOf, type CardMap, type CardState, type Learner, type KidSettings, type SessionLog } from './models';
import { getCardDef, moduleOfCard, cardLabel } from './modules';
import { PREVIEW_FLOOR, PREVIEW_MAX } from './session';
import { answerText, checkAnswer, generateProblem, shuffled, type AnswerInput, type Problem, type Rng } from './problems';
import { GEM_RUN_MAX } from './gems';

// Lightning Round: taped problems (the fact is shown and read, the kid answers before the reveal, and the reveal delay
// shrinks as the fact gets easy) mixed by incremental rehearsal (about 1 unknown fact among 9 known ones).
// Practice only. Every counted answer goes through repeatAnswer() (practice() plus attempts and correct), never review(),
// so the FSRS fields, the daily graded count (dayGraded) and the daily cap are never touched.

export const LIGHTNING = {
  /** Targets in a deck. */
  targets: 10,
  /** Known facts between one target and the next in the deck (incremental rehearsal, about 1 unknown to 9 known). */
  knownsPerTarget: 9,
  /** A round ends at this many cards or this many ms, whichever comes first. */
  maxCards: 60,
  maxMs: 3 * 60_000,
  /** The most gems one round can earn. */
  maxGems: 3,
  xpPerHit: 5,
  /** A miss comes back this many cards later (inclusive). */
  requeueMin: 3,
  requeueMax: 5,
  /** After a hit a target comes back after 1, then 2, then 3 cards (the run of knowns between repeats grows). */
  repeatGaps: [1, 2, 3] as readonly number[],
  /** Hits under this many ms count as fast. */
  fastMs: 1500,
  /** The delay range a card may store (firestore.rules checks the same range). */
  delayMin: 1000,
  delayMax: 4000,
} as const;

// ---- delay ladder ----

const LADDER: Record<Learner, readonly number[]> = { reader: [3000, 2000, 1500, 1000], prereader: [4000, 3000, 2000] };
/** The shortest delay a learner ever sees: readers 1 s, pre-readers 2 s. */
export const LEARNER_FLOOR: Record<Learner, number> = { reader: 1000, prereader: 2000 };

/** The delay floor in ms: the parent's advanced setting when valid, never below the learner's own floor. */
export function floorOf(settings: Pick<KidSettings, 'learner' | 'lightningFloorMs'> | undefined | null): number {
  const learner = learnerOf(settings);
  const set = settings?.lightningFloorMs;
  const own = LEARNER_FLOOR[learner];
  if (typeof set !== 'number' || !Number.isFinite(set)) return own;
  return Math.min(LIGHTNING.delayMax, Math.max(own, Math.round(set)));
}

/** The delays a card steps through, longest first, none below the floor. A floor above the first step gives that one delay. */
export function ladderFor(learner: Learner, floorMs: number = LEARNER_FLOOR[learner]): number[] {
  const steps = LADDER[learner].filter((v) => v >= floorMs);
  return steps.length ? [...steps] : [Math.min(LIGHTNING.delayMax, floorMs)];
}

function levelIndex(ladder: readonly number[], ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 0;
  let best = 0;
  ladder.forEach((v, i) => {
    if (Math.abs(v - ms) < Math.abs(ladder[best]! - ms)) best = i;
  });
  return best;
}

/** The delay a card shows now: its stored delay snapped to the ladder, else the ladder's first step (readers 3 s, pre-readers 4 s). */
export function delayOf(card: Pick<CardState, 'lightningDelayMs'> | undefined, learner: Learner, floorMs: number = LEARNER_FLOOR[learner]): number {
  const ladder = ladderFor(learner, floorMs);
  return ladder[levelIndex(ladder, card?.lightningDelayMs)]!;
}

/** One step shorter after a right answer before the reveal. Stops at the floor. */
export function stepDown(ms: number | undefined, learner: Learner, floorMs: number = LEARNER_FLOOR[learner]): number {
  const ladder = ladderFor(learner, floorMs);
  return ladder[Math.min(ladder.length - 1, levelIndex(ladder, ms) + 1)]!;
}

/** One step longer after a miss. Stops at the ladder's first step. */
export function stepUp(ms: number | undefined, learner: Learner, floorMs: number = LEARNER_FLOOR[learner]): number {
  const ladder = ladderFor(learner, floorMs);
  return ladder[Math.max(0, levelIndex(ladder, ms) - 1)]!;
}

// ---- deck ----

export interface DeckCard {
  cardId: string;
  /** A fact being learned (Needs work, or a preview). The rest are known facts. */
  target: boolean;
  /** A target from a locked group the kid has not met. Follows the coverage-1 preview limits. */
  preview?: boolean;
}

export interface Deck {
  cards: DeckCard[];
  /** Target ids, weakest first. */
  targets: string[];
}

export interface DeckInput {
  cards: CardMap;
  sessions: SessionLog[];
  settings: InsightInput['settings'] & Pick<KidSettings, 'learner'>;
  now: number;
  rng: Rng;
}

/** True when a card can be asked here: a fact whose answer a reader types or a pre-reader taps among 3 pictures-and-numbers choices. */
export function lightningCard(cardId: string, learner: Learner): boolean {
  const def = getCardDef(cardId);
  const input = moduleOfCard(cardId)?.input;
  if (!def || def.kind !== 'fact') return false;
  return learner === 'prereader' ? input === 'choices' : input === 'keypad' || input === 'choices';
}

/** Reviewing or better, and answered within the fast bar: the facts the kid already knows. */
export function isKnown(cardId: string, cards: CardMap, baseline: number, pace: number): boolean {
  const st = cards[cardId];
  const def = getCardDef(cardId);
  if (!st || !def || cardLevel(st, baseline, pace) < 2) return false;
  const med = median(st.recentMs);
  return Number.isFinite(med) && med <= thresholdsFor(def, baseline, pace).fastMs;
}

/**
 * The deck: up to 10 targets, then known facts at 9 per target. Targets come from the parent "Needs work" list (needsWork in
 * insights.ts, reused, not copied), plus previews of locked groups within the coverage-1 limits (PREVIEW_MAX, and none in the
 * first PREVIEW_FLOOR cards). Each unit is 9 knowns with its target placed after the first PREVIEW_FLOOR of them, so a round
 * opens with known facts and no two targets touch. Parent pins do not exist yet and are not an input.
 */
export function buildDeck({ cards, sessions, settings, now, rng }: DeckInput): Deck {
  const learner = learnerOf(settings);
  const baseline = factBaseline(cards);
  const pace = paceOf(settings);
  const ok = (id: string) => lightningCard(id, learner);

  const previews = previewPool(cards, settings as KidSettings)
    .filter((d) => ok(d.id))
    .slice(0, PREVIEW_MAX[learner])
    .map((d) => d.id);
  const needs = needsWork({ cards, sessions, settings, now }, 60)
    .filter((n) => ok(n.id))
    .slice(0, Math.max(0, LIGHTNING.targets - previews.length))
    .map((n) => n.id);
  const targetIds = [...needs, ...previews];
  if (!targetIds.length) return { cards: [], targets: [] };

  const taken = new Set(targetIds);
  const pool = shuffled(
    Object.keys(cards).filter((id) => !taken.has(id) && ok(id) && isKnown(id, cards, baseline, pace)),
    rng,
  );
  const lead = Math.min(PREVIEW_FLOOR[learner], LIGHTNING.knownsPerTarget);
  const out: DeckCard[] = [];
  let at = 0;
  const nextKnown = (): DeckCard | null => (pool.length ? { cardId: pool[at++ % pool.length]!, target: false } : null);
  targetIds.forEach((id) => {
    const unit: DeckCard[] = [];
    for (let i = 0; i < LIGHTNING.knownsPerTarget; i++) {
      if (i === lead) unit.push({ cardId: id, target: true, ...(previews.includes(id) ? { preview: true } : {}) });
      const k = nextKnown();
      if (k) unit.push(k);
    }
    if (!unit.some((u) => u.target)) unit.push({ cardId: id, target: true, ...(previews.includes(id) ? { preview: true } : {}) });
    out.push(...unit);
  });
  return { cards: out, targets: targetIds };
}

// ---- round ----

export interface LightningCard {
  /** Unique within the round. */
  id: string;
  cardId: string;
  target: boolean;
  preview: boolean;
  /** The reveal delay for this showing, from the card's stored delay. */
  delayMs: number;
  problem: Problem;
}

export type Phase = 'ask' | 'miss' | 'hit';

export interface AnswerResult {
  /** Right, and before the ring closed. */
  hit: boolean;
  correct: boolean;
  xp: number;
  /** The card's delay after this answer. */
  delayMs: number;
}

export interface FasterFact {
  cardId: string;
  label: string;
  beforeMs: number;
  afterMs: number;
}

export interface RoundResult {
  /** Counted answers (right before the reveal, or wrong). A ring that closed with nothing answered is not counted. */
  answered: number;
  hits: number;
  /** Longest run of right answers before the reveal (the fastest streak). */
  bestStreak: number;
  fast: number;
  medianMs: number;
  xp: number;
  /** Cards shown, requeues included. */
  shown: number;
  missed: string[];
  faster: FasterFact[];
  /** Up to 3 facts to start the next round with: missed this round first, then the slowest targets. */
  focus: string[];
}

export class LightningRound {
  readonly id: string;
  readonly learner: Learner;
  readonly floorMs: number;
  readonly startedAt: number;
  private queue: LightningCard[] = [];
  private index = 0;
  private cards: CardMap;
  private changed = new Set<string>();
  private phaseNow: Phase = 'ask';
  /** The card on screen was shown and is not finished: the round cannot end under it. */
  private inPlay = false;
  private nextId = 0;
  private hitsOf = new Map<string, number>();
  private requeues = new Map<string, number>();
  private stats = { answered: 0, hits: 0, fast: 0, xp: 0, streak: 0, bestStreak: 0, shown: 0 };
  private hitTimes: number[] = [];
  private missedSet = new Set<string>();
  private before = new Map<string, number>();
  private best = new Map<string, number>();
  private slow = new Map<string, number>();
  private targetIds: Set<string>;
  seq = 0;

  constructor(
    deck: Deck,
    cards: CardMap,
    settings: Pick<KidSettings, 'learner' | 'lightningFloorMs'>,
    private rng: Rng,
    private clock: () => number = Date.now,
    id = `lr${Math.floor(rng() * 1e9).toString(36)}${Math.floor(clock()).toString(36)}`,
  ) {
    this.id = id;
    this.learner = learnerOf(settings);
    this.floorMs = floorOf(settings);
    this.startedAt = clock();
    this.cards = { ...cards };
    this.targetIds = new Set(deck.targets);
    deck.cards.forEach((d) => this.queue.push(this.make(d)));
  }

  private make(d: DeckCard): LightningCard {
    return {
      id: `c${this.nextId++}`,
      cardId: d.cardId,
      target: d.target,
      preview: !!d.preview,
      delayMs: delayOf(this.cards[d.cardId], this.learner, this.floorMs),
      problem: generateProblem(d.cardId, this.rng),
    };
  }

  get phase(): Phase {
    return this.phaseNow;
  }

  get position(): number {
    return this.index;
  }

  /** The card on screen. Null when the round is over. */
  current(): LightningCard | null {
    return this.over() ? null : (this.queue[this.index] ?? null);
  }

  /** The round is over: 60 cards shown, 3 minutes passed, or the deck is used up. Checked between cards, so a card in play always finishes. */
  over(): boolean {
    if (this.phaseNow !== 'ask' || this.inPlay) return false;
    return this.index >= this.queue.length || this.stats.shown >= LIGHTNING.maxCards || this.clock() - this.startedAt >= LIGHTNING.maxMs;
  }

  /** Marks the current card as shown. Call once when it appears. */
  show(): void {
    if (this.inPlay) return;
    this.inPlay = true;
    this.stats.shown++;
  }

  private bump(cardId: string, ms: number, correct: boolean, delayMs: number): void {
    const prev = this.cards[cardId] ?? newCardState(cardId, this.clock());
    if (!this.before.has(cardId)) {
      const med = median(prev.recentMs);
      if (Number.isFinite(med)) this.before.set(cardId, med);
    }
    // repeatAnswer is practice() plus attempts and correct: the same counting as a later same-day answer. FSRS fields stay byte-identical.
    const next = { ...repeatAnswer(prev, ms, correct, this.clock()), lightningDelayMs: delayMs };
    this.cards[cardId] = next;
    this.changed.add(cardId);
  }

  /**
   * The kid answered while the ring was still open. A right answer is a hit: counted, the delay steps down, a target is scheduled
   * to come back. A wrong one is counted as a miss, the delay steps up, and the answer is shown for one copy-and-compare answer.
   */
  answer(input: AnswerInput, ms: number): AnswerResult {
    const card = this.current();
    if (!card || this.phaseNow !== 'ask') throw new Error('No card to answer');
    const correct = checkAnswer(card.problem, input) === 'correct';
    const inTime = ms <= card.delayMs;
    const stored = this.cards[card.cardId];
    if (correct && inTime) {
      const delayMs = stepDown(stored?.lightningDelayMs ?? card.delayMs, this.learner, this.floorMs);
      this.bump(card.cardId, ms, true, delayMs);
      this.stats.answered++;
      this.stats.hits++;
      this.stats.streak++;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
      if (ms <= LIGHTNING.fastMs) this.stats.fast++;
      this.stats.xp += LIGHTNING.xpPerHit;
      this.hitTimes.push(ms);
      const bestSoFar = this.best.get(card.cardId);
      if (bestSoFar === undefined || ms < bestSoFar) this.best.set(card.cardId, ms);
      this.phaseNow = 'hit';
      this.scheduleRepeat(card);
      return { hit: true, correct: true, xp: LIGHTNING.xpPerHit, delayMs };
    }
    // Wrong, or right but after the ring closed: the answer shows and a copy follows.
    const delayMs = stepUp(stored?.lightningDelayMs ?? card.delayMs, this.learner, this.floorMs);
    if (!correct) {
      this.bump(card.cardId, ms, false, delayMs);
      this.stats.answered++;
    } else {
      this.setDelay(card.cardId, delayMs);
    }
    this.missed(card, ms);
    return { hit: false, correct, xp: 0, delayMs };
  }

  /** The ring closed with nothing answered. The answer shows, the delay steps up, and the card comes back 3 to 5 cards later. Not counted as an answer. */
  timeout(): void {
    const card = this.current();
    if (!card || this.phaseNow !== 'ask') return;
    this.setDelay(card.cardId, stepUp(this.cards[card.cardId]?.lightningDelayMs ?? card.delayMs, this.learner, this.floorMs));
    this.missed(card, card.delayMs);
  }

  private setDelay(cardId: string, delayMs: number): void {
    const prev = this.cards[cardId] ?? newCardState(cardId, this.clock());
    this.cards[cardId] = { ...prev, lightningDelayMs: delayMs };
    this.changed.add(cardId);
  }

  private missed(card: LightningCard, ms: number): void {
    this.stats.streak = 0;
    this.missedSet.add(card.cardId);
    this.slow.set(card.cardId, Math.max(this.slow.get(card.cardId) ?? 0, ms));
    this.phaseNow = 'miss';
    const times = this.requeues.get(card.cardId) ?? 0;
    // A card comes back at most twice, so one hard fact cannot fill the round.
    if (times < 2) {
      this.requeues.set(card.cardId, times + 1);
      const span = LIGHTNING.requeueMax - LIGHTNING.requeueMin + 1;
      const gap = LIGHTNING.requeueMin + Math.floor(this.rng() * span);
      this.insert(card, this.index + gap);
    }
  }

  private scheduleRepeat(card: LightningCard): void {
    if (!card.target) return;
    const n = (this.hitsOf.get(card.cardId) ?? 0) + 1;
    this.hitsOf.set(card.cardId, n);
    const gap = LIGHTNING.repeatGaps[n - 1];
    if (gap !== undefined) this.insert(card, this.index + 1 + gap);
  }

  private insert(card: LightningCard, at: number): void {
    const copy: LightningCard = { ...this.make({ cardId: card.cardId, target: card.target, ...(card.preview ? { preview: true } : {}) }) };
    this.queue.splice(Math.min(this.queue.length, at), 0, copy);
  }

  /**
   * Copy-and-compare: after a miss the answer is on screen and the kid answers once more. A right copy ends the card.
   * It is not a recall test, so it is never counted. Returns true when it was right.
   */
  copy(input: AnswerInput): boolean {
    const card = this.queue[this.index];
    if (!card || this.phaseNow !== 'miss') return false;
    return checkAnswer(card.problem, input) === 'correct';
  }

  /** Moves to the next card. Call after a hit, or after a right copy. */
  advance(): void {
    if (this.phaseNow === 'ask') return;
    this.phaseNow = 'ask';
    this.inPlay = false;
    this.index++;
  }

  /** The answer text for the card on screen, for the reveal and the voice. */
  answerOf(card: LightningCard): string {
    return answerText(card.problem);
  }

  get xp(): number {
    return this.stats.xp;
  }

  get answered(): number {
    return this.stats.answered;
  }

  /** Cards changed this round (save these). */
  changedCards(): CardState[] {
    return [...this.changed].map((id) => this.cards[id]!);
  }

  getCard(id: string): CardState | undefined {
    return this.cards[id];
  }

  result(): RoundResult {
    const faster: FasterFact[] = [];
    this.best.forEach((afterMs, cardId) => {
      const beforeMs = this.before.get(cardId);
      if (beforeMs !== undefined && beforeMs - afterMs >= 100) faster.push({ cardId, label: cardLabel(cardId), beforeMs, afterMs });
    });
    faster.sort((a, b) => b.beforeMs - b.afterMs - (a.beforeMs - a.afterMs));
    const missed = [...this.missedSet];
    const slowTargets = [...this.targetIds].filter((id) => !this.missedSet.has(id)).sort((a, b) => (this.best.get(b) ?? Infinity) - (this.best.get(a) ?? Infinity));
    return {
      answered: this.stats.answered,
      hits: this.stats.hits,
      bestStreak: this.stats.bestStreak,
      fast: this.stats.fast,
      medianMs: this.hitTimes.length ? Math.round(median(this.hitTimes)) : 0,
      xp: this.stats.xp,
      shown: this.stats.shown,
      missed,
      faster: faster.slice(0, 5),
      focus: [...missed, ...slowTargets].slice(0, 3),
    };
  }
}

// ---- rewards ----

/** The gem base for a round: 1 gem from 5 hits, 2 from 20, 3 from 40. Zero under 5 hits. */
export function lightningGemBase(hits: number): number {
  return hits >= 40 ? 3 : hits >= 20 ? 2 : hits >= 5 ? 1 : 0;
}

/**
 * The base sent in the gemGrant. The server runs throttledGems(base) on the stored daily count, and Gem speed can
 * raise a base by 1.5, so the base is cut until base x speed stays within 3: a round never pays more than 3 gems at any tier.
 */
export function lightningGrantBase(hits: number, gemSpeed: number): number {
  const base = lightningGemBase(hits);
  if (base === 0) return 0;
  const speed = gemSpeed === 0.5 || gemSpeed === 1.5 ? gemSpeed : 1;
  return Math.max(1, Math.min(base, LIGHTNING.maxGems, Math.floor(LIGHTNING.maxGems / speed + 1e-9)));
}

export { GEM_RUN_MAX };

/**
 * The session log for a round, as the checkpoint writer stores it. `answered` and `graded` both count the counted answers, so the
 * parent table reads sensibly and fillLine() (answered minus graded) finds no practice to report: a Lightning answer is counted once,
 * here, and never again as fill practice. `practiceCorrect` is never set.
 */
export function lightningLog(round: LightningRound, r: RoundResult, now: number, build: number, opts: { finished: boolean; left?: boolean; gems: number }): SessionLog {
  return {
    id: round.id,
    startedAt: round.startedAt,
    endedAt: now,
    answered: r.answered,
    graded: r.answered,
    correct: r.hits,
    fast: r.fast,
    newLearned: 0,
    medianMs: r.medianMs,
    xp: r.xp,
    gems: opts.gems,
    bestCombo: r.bestStreak,
    missed: r.missed,
    mode: 'lightning',
    build,
    finished: opts.finished,
    ...(opts.left ? { endedBy: 'left' as const } : {}),
  };
}
