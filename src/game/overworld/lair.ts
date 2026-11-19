import { factBaseline, thresholdsFor } from '../../engine/grading';
import { dayKey } from '../../engine/game';
import { BOSS_TIMER_FACTORS, bossTimerOf, bossTimerPreOn, learnerOf, paceOf, type CardMap, type CardState, type KidSettings, type Learner, type SessionLog } from '../../engine/models';
import { getCardDef } from '../../engine/modules';
import { shuffled, type Problem, type Rng } from '../../engine/problemBase';
import { riddleProblem } from '../../engine/riddles';
import { isDue, median } from '../../engine/scheduler';
import type { Entry, PlanItem, SessionRunner } from '../../engine/session';
import { BOSS_GEMS, bossReward } from './boss';
import { hash } from './chests';
import { lookFor, type Entity } from './encounters';
import { LAIRS, findTiles, roomOf, tileAt, doorNeed, type LairDef, type Point, type RegionId } from './maps';
import { ladderCards, regionCards } from './regions';
import { TRIP_MAX_AGE_MS } from './trip';
import type { WorldState } from './worldState';

// A lair is a walkable dungeon (maps.ts LAIRS) with a fresh plan on every visit: 24 questions in the rooms (18 for a pre-reader,
// 12 on a retry) and a 6-question boss. This file is pure engine: the plan, the boss budget and clock, the outcome rules, the saved
// state and the replay reward. Overworld.tsx only draws it and calls it.

/** Questions in the rooms: a reader 24, a pre-reader 18, any retry after a lost fight 12. */
export type LairSize = 24 | 18 | 12;
export const LAIR_SIZE_READER = 24;
export const LAIR_SIZE_PREREADER = 18;
export const LAIR_SIZE_RETRY = 12;
/** Questions in the boss fight. */
export const LAIR_BOSS_QUESTIONS = 6;
/** Right answers that win the fight: 5 of 6 for a reader, 4 of 6 for a pre-reader whose parent turned the timer on. */
export const LAIR_BOSS_WIN = 5;
export const LAIR_BOSS_WIN_PRE = 4;
/** One fact is asked at most this many times in one lair (rooms and boss together), while the region has enough cards for it. */
export const LAIR_FACT_CAP = 3;
/** Gems a won replay pays, before the throttle (`grant()` applies it and the 10-gem write cap). */
export const REPLAY_GEMS = 3;
/** The boss budget is the sum of the six fast bars times this, clamped to BOSS_BUDGET_MIN..BOSS_BUDGET_MAX before the parent factor. */
export const BOSS_BUDGET_SLACK = 1.5;
export const BOSS_BUDGET_MIN_MS = 30_000;
export const BOSS_BUDGET_MAX_MS = 90_000;
/** A pre-reader whose parent turned the boss timer on gets this on top of the clamped budget. */
export const BOSS_PRE_FACTOR = 2;

/** The size of the room plan: a retry is always 12. */
export function lairSizeFor(learner: Learner, retry = false): LairSize {
  return retry ? LAIR_SIZE_RETRY : learner === 'prereader' ? LAIR_SIZE_PREREADER : LAIR_SIZE_READER;
}

// ---- plan ---------------------------------------------------------------------------------------------------------------

/** monster = a plain fight; guard = the monster at the room's exit door; chest = stands on a chest tile; trap = a riddle. */
export type LairRole = 'monster' | 'guard' | 'chest' | 'trap';

export interface LairItem extends PlanItem {
  role: LairRole;
  /** A chest's tile. */
  at?: Point;
}

export interface LairRoomPlan {
  /** Index into `LAIRS[region].rooms`. */
  room: number;
  items: LairItem[];
}

export type FormKind = 'missing' | 'twostep';

export interface BossItem extends PlanItem {
  /** Set on a form question ("? × 8 = 56" is 'missing', "7 × 8 − 6" is 'twostep'). Absent on a plain fact. */
  form?: FormKind;
}

export interface LairPlan {
  region: RegionId;
  size: LairSize;
  /** One per room before the boss room, in play order. Room i is cleared when its monsters and guard are answered; then door i+1 opens. */
  rooms: LairRoomPlan[];
  boss: BossItem[];
}

export interface LairPlanInput {
  region: RegionId;
  cards: CardMap;
  settings: KidSettings;
  learner: Learner;
  now: number;
  rng: Rng;
  /** Questions in the rooms. Default: `lairSizeFor(learner)`. */
  rooms?: LairSize;
}

const num = (x: number) => (Number.isFinite(x) ? x : 0);

/** Weakest first: a miss today, then the lowest FSRS stability, then the slowest median time. */
function byWeakness(cards: CardMap, now: number) {
  const today = dayKey(now);
  return (a: string, b: string) => {
    const ca = cards[a]!;
    const cb = cards[b]!;
    return Number(cb.missDay === today) - Number(ca.missDay === today) || ca.fsrs.stability - cb.fsrs.stability || num(median(cb.recentMs)) - num(median(ca.recentMs));
  };
}

/** Hardest first (the boss): the slowest median, then the most misses, then the lowest stability. */
function byHardness(cards: CardMap) {
  const misses = (c: CardState) => c.attempts - c.correct;
  return (a: string, b: string) => {
    const ca = cards[a]!;
    const cb = cards[b]!;
    return num(median(cb.recentMs)) - num(median(ca.recentMs)) || misses(cb) - misses(ca) || ca.fsrs.stability - cb.fsrs.stability;
  };
}

/** The ids sorted by `cmp`, equal ones in a random order (the shuffle runs first and the sort is stable). */
const sortedBy = (ids: string[], rng: Rng, cmp: (a: string, b: string) => number) => shuffled(ids, rng).sort(cmp);

/** A plan item for a card: unseen is new, a card that is not due is ungraded fill (like the old boss), a due card is a normal review. */
function itemFor(id: string, cards: CardMap, now: number): PlanItem {
  const c = cards[id];
  if (!c) return { cardId: id, isNew: true };
  return isDue(c, now) ? { cardId: id, isNew: false } : { cardId: id, isNew: false, fill: true };
}

/** A card that has a riddle story (a fact shaped "a op b"): a trap can only be one of these. */
const hasStory = (cardId: string) => riddleProblem(cardId, () => 0.5) !== null;

/**
 * The questions of the rooms. Only the region's own cards (`regionCards`) come up, seen ones weakest first, then its unseen facts.
 * Each pass walks that list again, so a fact comes up at most `LAIR_FACT_CAP` times. Only when the region is too small for the size
 * do other seen cards of the kid's ladder join, and only when even they are too few does a fact go past the cap (least used first).
 */
function roomIds(i: LairPlanInput, size: number, region: string[], seenRegion: string[], unseenRegion: string[]): string[] {
  const { cards, now, rng, settings } = i;
  const own = [...sortedBy(seenRegion, rng, byWeakness(cards, now)), ...unseenRegion];
  const inRegion = new Set(region);
  const other = sortedBy([...new Set(ladderCards(settings))].filter((id) => cards[id] && !inRegion.has(id) && getCardDef(id)), rng, byWeakness(cards, now));
  const used = new Map<string, number>();
  const out: string[] = [];
  const take = (id: string, cap: number) => {
    if ((used.get(id) ?? 0) >= cap) return;
    used.set(id, (used.get(id) ?? 0) + 1);
    out.push(id);
  };
  for (let pass = 1; pass <= LAIR_FACT_CAP && out.length < size; pass++) {
    for (const id of own) if (out.length < size) take(id, pass);
  }
  for (let pass = 1; pass <= LAIR_FACT_CAP && out.length < size; pass++) {
    for (const id of other) if (out.length < size) take(id, pass);
  }
  // Too few cards for the cap: least used first, so no fact repeats more than it has to.
  const pool = [...own, ...other];
  while (out.length < size && pool.length) {
    const next = pool.reduce((best, id) => ((used.get(id) ?? 0) < (used.get(best) ?? 0) ? id : best));
    take(next, Infinity);
  }
  return out;
}

/** Splits `size` over `n` rooms, the first rooms taking the extra one. */
const split = (size: number, n: number) => Array.from({ length: n }, (_, k) => Math.floor(size / n) + (k < size % n ? 1 : 0));

/**
 * The plan of one visit. Pure: the same inputs and rng give the same plan, and a second call with a new rng gives a fresh one.
 *  - Rooms: `rooms` questions (24 / 18 / 12), weakest first across the rooms in order, a fact at most 3 times, only from
 *    `regionCards(region, settings)` unless the region is too small (see `roomIds`).
 *  - Per room: its last question is the guard at the exit door, 2 to 3 chests stand on the map's chest tiles (3 at size 24, else 2),
 *    1 to 2 riddle traps (2 at size 24, else 1; only on cards with a story, so a lair for a kid with none has none).
 *  - Boss: the 6 hardest cards the kid has seen in the region; a reader gets 1 to 2 of them as forms (missing factor, two-step).
 */
export function buildLairPlan(i: LairPlanInput): LairPlan {
  const size = i.rooms ?? lairSizeFor(i.learner);
  const def = LAIRS[i.region];
  const region = [...new Set(regionCards(i.region, i.settings))].filter((id) => getCardDef(id));
  const seenRegion = region.filter((id) => i.cards[id]);
  const unseenRegion = region.filter((id) => !i.cards[id] && getCardDef(id)?.kind === 'fact');
  const ids = roomIds(i, size, region, seenRegion, unseenRegion);

  // Rooms in order, each a slice of the ranked list.
  const rooms: LairRoomPlan[] = [];
  let at = 0;
  split(ids.length, def.rooms.length - 1).forEach((n, room) => {
    const items: LairItem[] = ids.slice(at, at + n).map((id) => ({ ...itemFor(id, i.cards, i.now), role: 'monster' as LairRole }));
    at += n;
    if (items.length) items[items.length - 1]!.role = 'guard';
    rooms.push({ room, items });
  });

  // Chests: round-robin over the rooms that still have a chest tile, each taking its room's first question.
  const tiles = rooms.map((r) => findTiles(def.map, 'chest').filter((p) => roomOf(def, p.x, p.y) === r.room));
  const chests = size === LAIR_SIZE_READER ? 3 : 2;
  for (let k = 0, placed = 0; placed < chests && tiles.some((t) => t.length) && k < 100; k++) {
    const r = rooms[k % rooms.length]!;
    const tile = tiles[r.room]!.shift();
    const item = r.items.find((x) => x.role === 'monster');
    if (!tile || !item) continue;
    item.role = 'chest';
    item.at = tile;
    placed++;
  }

  // Traps: a riddle needs a card with a story. Start at the second room so room 1 stays a plain welcome.
  const traps = size === LAIR_SIZE_READER ? 2 : 1;
  for (let k = 0, placed = 0; placed < traps && k < rooms.length * 2; k++) {
    const r = rooms[(k + 1) % rooms.length]!;
    const item = r.items.find((x) => x.role === 'monster' && hasStory(x.cardId));
    if (!item) continue;
    item.role = 'trap';
    placed++;
  }

  return { region: i.region, size, rooms, boss: buildBossPlan(i, region, seenRegion, ids) };
}

/** The boss questions: the 6 hardest seen cards, then up to 2 of them (never the hardest) turned into forms for a reader. */
function buildBossPlan(i: LairPlanInput, region: string[], seenRegion: string[], roomsIds: string[]): BossItem[] {
  const { cards, rng, now } = i;
  const used = new Map<string, number>();
  for (const id of roomsIds) used.set(id, (used.get(id) ?? 0) + 1);
  const inRegion = new Set(region);
  const hardOf = (ids: string[]) => sortedBy(ids, rng, byHardness(cards));
  const other = [...new Set(ladderCards(i.settings))].filter((id) => cards[id] && !inRegion.has(id) && getCardDef(id));
  const picked: string[] = [];
  const add = (ids: string[], cap: number) => {
    for (const id of ids) if (picked.length < LAIR_BOSS_QUESTIONS && !picked.includes(id) && (used.get(id) ?? 0) < cap) picked.push(id);
  };
  // Seen cards of the region first, under the cap, then other seen cards, then the cap gives way. An unseen fact never comes up.
  add(hardOf(seenRegion), LAIR_FACT_CAP);
  add(hardOf(other), LAIR_FACT_CAP);
  add(hardOf(seenRegion), Infinity);
  add(hardOf(other), Infinity);
  // A boss that still has fewer than 6 repeats its hardest cards rather than ask nothing.
  const all = [...hardOf(seenRegion), ...hardOf(other)];
  for (let k = 0; all.length && picked.length < LAIR_BOSS_QUESTIONS; k++) picked.push(all[k % all.length]!);

  const forms = new Map<string, FormKind>();
  if (learnerOf(i.settings) !== 'prereader' && i.learner !== 'prereader') {
    const eligible = picked.slice(1).filter((id) => formProblem(id, 'missing', () => 0.5) !== null).slice(0, 2);
    // The first form's kind comes from its card's hash; a second form is the other kind.
    const first: FormKind = eligible[0] && hash(`${eligible[0]}|form`) % 2 === 0 ? 'missing' : 'twostep';
    eligible.forEach((id, k) => forms.set(id, k === 0 ? first : first === 'missing' ? 'twostep' : 'missing'));
  }
  return picked.map((id): BossItem => ({ ...itemFor(id, cards, now), ...(forms.has(id) ? { form: forms.get(id)! } : {}) }));
}

// ---- boss forms ---------------------------------------------------------------------------------------------------------

/**
 * A form built from a times-table fact `mul:AxB`: 'missing' is "? × 8 = 56" (the answer is the missing factor), 'twostep' is
 * "7 × 8 − 6" (the answer is 50). Null for a card that is not a times fact. The problem keeps the card's id, so the answer feeds that card.
 */
export function formProblem(cardId: string, kind: FormKind, rng: Rng): Problem | null {
  const def = getCardDef(cardId);
  if (!def || def.kind !== 'fact' || !cardId.startsWith('mul:')) return null;
  const [a, b] = rng() < 0.5 ? [def.a, def.b] : [def.b, def.a];
  const product = a * b;
  if (kind === 'twostep' && product > 1) {
    const c = 1 + Math.floor(rng() * Math.min(9, product - 1));
    return {
      cardId,
      tokens: [{ t: 'num', v: a }, { t: 'op', v: '×' }, { t: 'num', v: b }, { t: 'op', v: '−' }, { t: 'num', v: c }],
      answer: { kind: 'int', value: product - c },
      hint: `${a} × ${b} = ${product}, then ${product} − ${c} = ${product - c}.`,
    };
  }
  return {
    cardId,
    tokens: [{ t: 'blank' }, { t: 'op', v: '×' }, { t: 'num', v: b }, { t: 'op', v: '=' }, { t: 'num', v: product }],
    answer: { kind: 'int', value: a },
    hint: `${a} × ${b} = ${product}, so the missing number is ${a}.`,
  };
}

// ---- boss clock and outcome ---------------------------------------------------------------------------------------------

/** True when the boss has a countdown: always for a reader, for a pre-reader only when a parent turned it on. */
export function bossTimerOn(settings: KidSettings): boolean {
  return learnerOf(settings) !== 'prereader' || bossTimerPreOn(settings);
}

/**
 * The boss countdown in ms for the given boss cards: the sum of each card's fast bar (`thresholdsFor` with the kid's baseline and pace)
 * times 1.5, clamped to 30 to 90 s, and THEN times the parent factor (easier 1.5, normal 1, harder 0.75) and, for a pre-reader, 2.
 * Clamping first keeps the parent's choice meaningful at both ends: "easier" is always 1.5 times "normal". A pre-reader's value is
 * only used when `bossTimerOn(settings)` says so.
 * Examples at the default pace 3 and the default 3.5 s baseline: 6 times-table cards fast = 9 s each, 54 s x 1.5 = 81 s; harder 60.75 s; easier 121.5 s.
 * At pace 1 the sum is 18 s x 1.5 = 27 s, which the floor lifts to 30 s. A pre-reader at the same 30 s with the timer on and easier gets 30 x 1.5 x 2 = 90 s.
 */
export function bossBudgetMs(cardIds: string[], cards: CardMap, settings: KidSettings): number {
  const baseline = factBaseline(cards);
  const pace = paceOf(settings);
  const fast = cardIds.reduce((sum, id) => {
    const def = getCardDef(id);
    return def ? sum + thresholdsFor(def, baseline, pace).fastMs : sum;
  }, 0);
  const clamped = Math.min(BOSS_BUDGET_MAX_MS, Math.max(BOSS_BUDGET_MIN_MS, fast * BOSS_BUDGET_SLACK));
  const pre = learnerOf(settings) === 'prereader' ? BOSS_PRE_FACTOR : 1;
  return Math.round(clamped * BOSS_TIMER_FACTORS[bossTimerOf(settings)] * pre);
}

/** The countdown of one fight. Time passes only while it runs: `pause()` while the page is hidden, `resume()` when it is back. */
export class BossClock {
  private spent = 0;
  private since: number | null = null;
  private started = false;

  constructor(readonly budgetMs: number, private now: () => number = Date.now) {}

  /** Starts the clock. A second call does nothing. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.since = this.now();
  }

  pause(): void {
    if (this.since === null) return;
    this.spent += this.now() - this.since;
    this.since = null;
  }

  resume(): void {
    if (this.started && this.since === null) this.since = this.now();
  }

  get running(): boolean {
    return this.since !== null;
  }

  /** Time the clock has run so far. */
  elapsedMs(): number {
    return this.spent + (this.since === null ? 0 : this.now() - this.since);
  }

  remainingMs(): number {
    return Math.max(0, this.budgetMs - this.elapsedMs());
  }

  expired(): boolean {
    return this.started && this.remainingMs() <= 0;
  }
}

/** What `watchVisibility` needs from a document, so a test can hand it a small stand-in. */
export interface VisibilitySource {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

/** Pauses the clock while the page is hidden and resumes it when visible again. Returns the function that stops watching. */
export function watchVisibility(clock: BossClock, doc: VisibilitySource = document): () => void {
  const sync = () => (doc.visibilityState === 'hidden' ? clock.pause() : clock.resume());
  doc.addEventListener('visibilitychange', sync);
  if (doc.visibilityState === 'hidden') clock.pause();
  return () => doc.removeEventListener('visibilitychange', sync);
}

export type BossOutcome = 'pending' | 'win' | 'lose' | 'timeout';

/**
 * Where the fight stands.
 *  - win: enough right answers (5 of 6, or 4 of 6 for a pre-reader), at once. A pre-reader with the timer off wins after all 6 answers, whatever they were.
 *  - timeout: the clock ran out before the win.
 *  - lose: the win can no longer be reached (2 wrong for a reader), or all 6 are answered and too few were right.
 *  - pending: the fight goes on.
 * `remainingMs` is null when there is no countdown.
 */
export function bossOutcome(i: { correct: number; answered: number; remainingMs: number | null; prereader: boolean; timerOn: boolean }): BossOutcome {
  const need = i.prereader ? LAIR_BOSS_WIN_PRE : LAIR_BOSS_WIN;
  if (i.prereader && !i.timerOn) return i.answered >= LAIR_BOSS_QUESTIONS ? 'win' : 'pending';
  if (i.correct >= need) return 'win';
  if (i.timerOn && i.remainingMs !== null && i.remainingMs <= 0) return 'timeout';
  if (i.answered >= LAIR_BOSS_QUESTIONS || i.answered - i.correct > LAIR_BOSS_QUESTIONS - need) return 'lose';
  return 'pending';
}

// ---- reward and stats ---------------------------------------------------------------------------------------------------

/**
 * What a boss resolution pays. A loss pays nothing. The first win of a region pays what `bossReward` does (10 gems; the key and
 * the trophy follow in `worldReducer('boss')`, which pays once). Every later win pays REPLAY_GEMS, through the same grant path.
 */
export function lairReward(world: Pick<WorldState, 'bossesDefeated'>, region: RegionId, win: boolean): { gems: number; first: boolean } {
  if (!win) return { gems: 0, first: false };
  const first = bossReward(world, region);
  return first.first ? first : { gems: REPLAY_GEMS, first: false };
}

export { BOSS_GEMS };

export interface LairStats {
  /** Wins in this region, from the kid's lair logs. */
  beaten: number;
  /** The fastest win, or null with none. */
  bestMs: number | null;
  /** The most right answers in any fight here. */
  bestCorrect: number;
}

/** "Beaten N times" and the bests of a region, from the session logs (mode 'lair'). */
export function lairStats(logs: ReadonlyArray<Pick<SessionLog, 'mode' | 'region' | 'bossWon' | 'bossCorrect' | 'bossMs'>>, region: RegionId): LairStats {
  const mine = logs.filter((l) => l.mode === 'lair' && l.region === region);
  const wins = mine.filter((l) => l.bossWon === true);
  const times = wins.map((l) => l.bossMs).filter((t): t is number => typeof t === 'number' && t > 0);
  return {
    beaten: wins.length,
    bestMs: times.length ? Math.min(...times) : null,
    bestCorrect: mine.reduce((best, l) => Math.max(best, l.bossCorrect ?? 0), 0),
  };
}

// ---- entries, entities and clearing ------------------------------------------------------------------------------------

/** A planned question made into a runner entry. `slot` names it in the plan: `r<room>i<index>` for the rooms, `b<index>` for the boss. */
export interface LairEntry {
  slot: string;
  entry: Entry;
  /** Room index, or -1 for the boss. */
  room: number;
  role: LairRole | 'boss';
  form?: FormKind;
  at?: Point;
}

export interface LairBuild {
  rooms: LairEntry[];
  boss: LairEntry[];
  /** Runner entry id to slot. */
  slotOf: Record<string, string>;
}

const roomSlot = (room: number, i: number) => `r${room}i${i}`;
const bossSlot = (i: number) => `b${i}`;

/**
 * Puts the plan's questions on the runner: monsters, guards and chests as normal entries, traps as riddles, boss forms through
 * `appendForm` (practice, no retry). A trap whose card has no story, or a form that cannot be built, falls back to a plain entry.
 */
export function instantiateLair(runner: SessionRunner, plan: LairPlan, rng: Rng): LairBuild {
  const slotOf: Record<string, string> = {};
  const rooms: LairEntry[] = [];
  for (const r of plan.rooms) {
    r.items.forEach((item, k) => {
      const entry = (item.role === 'trap' ? runner.appendRiddle(item.cardId, rng) : null) ?? runner.append([item], rng).find((e) => e.kind !== 'teach');
      if (!entry) return;
      const slot = roomSlot(r.room, k);
      slotOf[entry.id] = slot;
      rooms.push({ slot, entry, room: r.room, role: item.role, ...(item.at ? { at: item.at } : {}) });
    });
  }
  const boss: LairEntry[] = [];
  plan.boss.forEach((item, k) => {
    const problem = item.form ? formProblem(item.cardId, item.form, rng) : null;
    const entry = problem ? runner.appendForm(item.cardId, problem) : runner.append([item], rng).find((e) => e.kind !== 'teach');
    if (!entry) return;
    const slot = bossSlot(k);
    slotOf[entry.id] = slot;
    boss.push({ slot, entry, room: -1, role: 'boss', ...(problem && item.form ? { form: item.form } : {}) });
  });
  return { rooms, boss, slotOf };
}

/** The spot id of a lair chest: `lair-<region>#<seq>:x,y`. A fresh plan has a new seq, so its chests are new chests. */
export const lairSpotId = (region: RegionId, seq: number, p: Point): string => `lair-${region}#${seq}:${p.x},${p.y}`;

const key = (p: Point) => `${p.x},${p.y}`;
const dist = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * The map entities of a lair: each room's monsters, guard and traps on free floor tiles inside that room (spawn tiles first,
 * the guard nearest its exit door), chests on their chest tiles. `done` slots are left out (a resumed lair). `Entity.room` says
 * which room an entity stands in; only rooms up to `roomsCleared` are `shown`. Boss questions are not entities.
 */
export function planLairEntities(i: { def: LairDef; build: LairBuild; seq: number; rng: Rng; done?: ReadonlySet<string>; roomsCleared?: number }): Entity[] {
  const { def, build, seq, rng } = i;
  const cleared = i.roomsCleared ?? 0;
  const taken = new Set<string>(findTiles(def.map, 'start').map(key));
  const out: Entity[] = [];
  for (const e of build.rooms) {
    if (i.done?.has(e.slot)) continue;
    const base = { id: e.entry.id, cardId: e.entry.cardId, look: lookFor(e.entry.cardId), room: e.room, shown: e.room <= cleared };
    if (e.role === 'chest' && e.at) {
      taken.add(key(e.at));
      out.push({ ...base, kind: 'chest', x: e.at.x, y: e.at.y, spotId: lairSpotId(def.region, seq, e.at) });
      continue;
    }
    const rect = def.rooms[e.room]!;
    const floor: Point[] = [];
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) if (!taken.has(`${x},${y}`) && tileAt(def.map, x, y) !== 'chest') floor.push({ x, y });
    const spawns = shuffled(floor.filter((p) => tileAt(def.map, p.x, p.y) === 'spawn'), rng);
    const door = findTiles(def.map, 'rdoor').find((p) => doorNeed(def.map, p.x, p.y) === e.room + 1);
    const pool = e.role === 'guard' && door ? [...spawns, ...floor].sort((a, b) => dist(a, door) - dist(b, door)) : [...spawns, ...shuffled(floor.filter((p) => tileAt(def.map, p.x, p.y) !== 'spawn'), rng)];
    const p = pool[0] ?? { x: rect.x, y: rect.y };
    taken.add(key(p));
    out.push({ ...base, kind: 'monster', x: p.x, y: p.y, ...(e.role === 'guard' ? { guard: true as const } : {}), ...(e.role === 'trap' ? { trap: true as const } : {}) });
  }
  return out;
}

/** The same entities with `shown` set for the rooms up to `roomsCleared` (the room the hero is in and the ones behind). */
export function showRooms(entities: Entity[], roomsCleared: number): Entity[] {
  return entities.map((e) => ({ ...e, shown: (e.room ?? 0) <= roomsCleared }));
}

/**
 * Rooms cleared: the number of leading rooms whose monsters and guard are all in `done`. Chests and traps are optional and never
 * hold a door shut. Door `n` opens when this reaches `n`.
 */
export function roomsClearedOf(plan: LairPlan, done: ReadonlySet<string>): number {
  let n = 0;
  for (const r of plan.rooms) {
    const need = r.items.flatMap((x, k) => (x.role === 'monster' || x.role === 'guard' ? [roomSlot(r.room, k)] : []));
    if (!need.every((s) => done.has(s))) break;
    n++;
  }
  return n;
}

/** Questions answered and questions planned, for the "Lair: 12 of 30" line. The boss counts in both. */
export function lairProgress(plan: LairPlan, done: ReadonlySet<string>): { answered: number; total: number } {
  const total = plan.rooms.reduce((s, r) => s + r.items.length, 0) + plan.boss.length;
  return { answered: Math.min(total, done.size), total };
}

// ---- saved state --------------------------------------------------------------------------------------------------------

/** One visit to a lair, kept on this device so leaving and coming back the same day resumes the room. */
export interface LairState {
  region: RegionId;
  tripId: string;
  enteredAt: number;
  /** Counts the fresh plans of this kid's lairs. Chest spot ids carry it. */
  seq: number;
  plan: LairPlan;
  /** Slots answered so far (see LairEntry.slot). */
  done: string[];
  /** The boss fight was resolved (won, or lost and left). A state with this set never resumes. */
  bossDone: boolean;
}

const KEY = (kidId: string) => `mathquest:v1:lair:${kidId}`;

export function loadLair(kidId: string): LairState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(kidId)) ?? 'null') as Partial<LairState> | null;
    if (!raw || typeof raw.region !== 'string' || !(raw.region in LAIRS) || typeof raw.enteredAt !== 'number' || typeof raw.seq !== 'number' || !raw.plan || !Array.isArray(raw.plan.rooms) || !Array.isArray(raw.plan.boss)) return null;
    const done = Array.isArray(raw.done) ? raw.done.filter((s): s is string => typeof s === 'string').slice(0, 200) : [];
    return { ...(raw as LairState), tripId: typeof raw.tripId === 'string' ? raw.tripId : '', done, bossDone: raw.bossDone === true };
  } catch {
    return null;
  }
}

export function saveLair(kidId: string, state: LairState): void {
  try {
    localStorage.setItem(KEY(kidId), JSON.stringify(state));
  } catch {
    // Not kept: the next entry builds a fresh plan.
  }
}

/** True when the saved lair is for this region, under 24 hours old and its boss is not resolved. */
export function canResumeLair(stored: LairState | null, region: RegionId, now: number): stored is LairState {
  return !!stored && stored.region === region && !stored.bossDone && now - stored.enteredAt < TRIP_MAX_AGE_MS;
}

/**
 * The lair to play on entry: the saved one when it can resume, otherwise a fresh plan (24 / 18, or 12 when `retry`) with the next seq.
 * The caller saves the result and keeps it saved as `done` grows.
 */
export function enterLair(i: LairPlanInput & { stored: LairState | null; tripId: string; retry?: boolean }): { state: LairState; resumed: boolean } {
  if (!i.retry && canResumeLair(i.stored, i.region, i.now)) return { state: i.stored, resumed: true };
  const plan = buildLairPlan({ ...i, rooms: i.retry ? LAIR_SIZE_RETRY : (i.rooms ?? lairSizeFor(i.learner)) });
  return { state: { region: i.region, tripId: i.tripId, enteredAt: i.now, seq: (i.stored?.seq ?? 0) + 1, plan, done: [], bossDone: false }, resumed: false };
}
