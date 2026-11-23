import type { RunSummary } from '../../engine/session';
import type { SessionLog } from '../../engine/models';
import { BUILD } from '../../version';
import { dayKey } from '../../engine/game';
import { chestGems } from './chests';

// One Adventure trip = one session doc, sessions/{tripId}. The trip's identity and totals-so-far live on this device
// (world/main holds exactly 10 fields by rule, so they cannot go there) and in the session doc itself. A trip under
// 24 hours old that was not closed at the campfire resumes with the same id; otherwise a new one starts.

export const TRIP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Graded answers between checkpoints. */
export const CHECKPOINT_EVERY = 10;
const MISSED_MAX = 30;

/** Totals of the trip so far, over every open of it. */
export interface TripTotals {
  answered: number;
  graded: number;
  correct: number;
  fast: number;
  newLearned: number;
  xp: number;
  bestCombo: number;
  medianMs: number;
  missed: string[];
  /** Right answers on fill practice. A trip stored before this field reads as 0. */
  practiceCorrect?: number;
  /** Fill practice answers given, without retries. A trip stored before this field reads as 0. */
  fillAnswered?: number;
}

export interface TripState {
  tripId: string;
  startedAt: number;
  /** The last checkpoint number queued for this trip. The next is seq + 1. */
  seq: number;
  /** When the trip last changed. A trip older than TRIP_MAX_AGE_MS since `startedAt` does not resume. */
  updatedAt: number;
  finished: boolean;
  totals: TripTotals;
  /**
   * Chests opened today: spot ids (`land:x,y`). `day` is the local day (the throttle's key, dayKey) the list belongs to; a list from an
   * earlier day is dropped by syncChestDay, so every chest refills once per local day and not once per trip. `shut` holds the spots a
   * wrong answer kept shut on THIS trip: they open again on the next trip. Kept on this device with the trip, so a write from an older
   * app to world/main cannot reset it. A trip stored before `day` existed reads as the day it started.
   */
  chests?: { opened: string[]; day?: string; shut?: string[] };
  /** Lair boss fights logged on this trip: the next log doc is `${tripId}-lair${lairs + 1}`. Absent reads as 0. */
  lairs?: number;
  /** Grant ids of the pets' gems paid on this trip (`beetle:<trip>`). Kept on this device with the trip. An older app ignores it. */
  pets?: { claimed: string[] };
}

export const EMPTY_TOTALS: TripTotals = { answered: 0, graded: 0, correct: 0, fast: 0, newLearned: 0, xp: 0, bestCombo: 0, medianMs: 0, missed: [] };

const key = (kidId: string) => `mathquest:v1:trip:${kidId}`;

export function loadTrip(kidId: string): TripState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key(kidId)) ?? 'null') as Partial<TripState> | null;
    if (!raw || typeof raw.tripId !== 'string' || typeof raw.startedAt !== 'number' || typeof raw.seq !== 'number' || !raw.totals) return null;
    const opened = Array.isArray(raw.chests?.opened) ? raw.chests!.opened.filter((s): s is string => typeof s === 'string' && s.length <= 40).slice(0, 60) : [];
    const claimed = Array.isArray(raw.pets?.claimed) ? raw.pets!.claimed.filter((s): s is string => typeof s === 'string' && s.length <= 60).slice(0, 20) : [];
    const shut = Array.isArray(raw.chests?.shut) ? raw.chests!.shut.filter((s): s is string => typeof s === 'string' && s.length <= 40).slice(0, 60) : [];
    const day = typeof raw.chests?.day === 'string' ? raw.chests.day : undefined;
    return { ...(raw as TripState), chests: { opened, ...(day ? { day } : {}), ...(shut.length ? { shut } : {}) }, ...(claimed.length ? { pets: { claimed } } : {}), finished: raw.finished === true, updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : raw.startedAt, totals: { ...EMPTY_TOTALS, ...raw.totals } };
  } catch {
    return null;
  }
}

export function saveTrip(kidId: string, trip: TripState): void {
  try {
    localStorage.setItem(key(kidId), JSON.stringify(trip));
  } catch {
    // Not kept: the next open starts a new trip, and the session doc already holds what was credited.
  }
}

/**
 * The trip to play now. `resume` is the stored trip when it is open and under 24 h old. Otherwise a new trip starts, and
 * `close` is the stored trip when it was left open (expired): its session doc is closed as 'left'.
 */
export function resolveTrip(stored: TripState | null, now: number, newId: () => string): { trip: TripState; close: TripState | null } {
  if (stored && !stored.finished && now - stored.startedAt < TRIP_MAX_AGE_MS) return { trip: stored, close: null };
  const trip: TripState = { tripId: newId(), startedAt: now, seq: 0, updatedAt: now, finished: false, totals: EMPTY_TOTALS };
  return { trip, close: stored && !stored.finished ? stored : null };
}

/** The trip's totals after this open's runner: the totals at the start of the open plus the runner's own summary. */
export function addRun(base: TripTotals, run: RunSummary): TripTotals {
  return {
    answered: base.answered + run.answered,
    graded: base.graded + run.graded,
    correct: base.correct + run.correct,
    fast: base.fast + run.fast,
    newLearned: base.newLearned + run.newLearned,
    xp: base.xp + run.xp,
    bestCombo: Math.max(base.bestCombo, run.bestCombo),
    medianMs: run.medianMs || base.medianMs,
    missed: [...new Set([...base.missed, ...run.missed])].slice(0, MISSED_MAX),
    ...((base.practiceCorrect ?? 0) + (run.practiceCorrect ?? 0) ? { practiceCorrect: (base.practiceCorrect ?? 0) + (run.practiceCorrect ?? 0) } : {}),
    ...((base.fillAnswered ?? 0) + (run.fillAnswered ?? 0) ? { fillAnswered: (base.fillAnswered ?? 0) + (run.fillAnswered ?? 0) } : {}),
  };
}

/** The session log a checkpoint writes: cumulative totals, mode 'overworld', open unless `finished`. */
export function tripLog(trip: Pick<TripState, 'tripId' | 'startedAt'>, t: TripTotals, now: number, region: string, end?: 'camp' | 'left'): SessionLog {
  return {
    id: trip.tripId,
    startedAt: trip.startedAt,
    endedAt: now,
    answered: t.answered,
    graded: t.graded,
    correct: t.correct,
    fast: t.fast,
    newLearned: t.newLearned,
    medianMs: t.medianMs,
    xp: t.xp,
    gems: 0,
    bestCombo: t.bestCombo,
    missed: t.missed,
    ...(t.practiceCorrect ? { practiceCorrect: t.practiceCorrect } : {}),
    mode: 'overworld',
    build: BUILD,
    region,
    finished: end === 'camp',
    ...(end ? { endedBy: end } : {}),
  };
}

/** Spot ids of the chests opened today (the list is only trusted after syncChestDay). */
export function openedSpots(trip: Pick<TripState, 'chests'>): string[] {
  return trip.chests?.opened ?? [];
}

/** Spot ids a wrong answer kept shut on this trip. They are not opened: the next trip offers them again. */
export function shutSpots(trip: Pick<TripState, 'chests'>): string[] {
  return trip.chests?.shut ?? [];
}

/** The spots that offer no question right now: opened today, or shut by a wrong answer on this trip. */
export function offLimitsSpots(trip: Pick<TripState, 'chests'>): string[] {
  return [...openedSpots(trip), ...shutSpots(trip)];
}

// The opened chests of the local day, per kid, on this device. A trip lasts up to 24 hours and a new trip can start the same day,
// so the day's list lives outside the trip and every trip reads it.
const dayKeyOf = (kidId: string) => `mathquest:v1:chests-day:${kidId}`;
const MAX_OPENED = 200;
const validId = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 40;

function loadChestDay(kidId: string, day: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(dayKeyOf(kidId)) ?? 'null') as { day?: unknown; opened?: unknown } | null;
    return raw && raw.day === day && Array.isArray(raw.opened) ? raw.opened.filter(validId).slice(0, MAX_OPENED) : [];
  } catch {
    return [];
  }
}

function saveChestDay(kidId: string, day: string, opened: string[]): void {
  try {
    localStorage.setItem(dayKeyOf(kidId), JSON.stringify({ day, opened: opened.slice(0, MAX_OPENED) }));
  } catch {
    // Not kept: the synced game still holds the day's list.
  }
}

/**
 * Brings the trip's opened list to the local day `now` falls in (the day the gem throttle uses, dayKey). The list is the chests this
 * device opened today, the trip's own list when it is stamped with today (a trip stored before the stamp reads as the day it started),
 * and `synced`, the list the kid's game doc holds for today (another device's opens). A list from an earlier day is dropped.
 * Shut spots belong to the trip and stay. Saves the trip.
 */
export function syncChestDay(kidId: string, trip: TripState, now: number, synced?: { chestsDay?: string; chestsOpened?: string[] }): void {
  const day = dayKey(now);
  const own = (trip.chests?.day ?? dayKey(trip.startedAt)) === day ? openedSpots(trip) : [];
  const theirs = synced?.chestsDay === day && Array.isArray(synced.chestsOpened) ? synced.chestsOpened.filter(validId) : [];
  const opened = [...new Set([...loadChestDay(kidId, day), ...own, ...theirs])].slice(0, MAX_OPENED);
  const shut = shutSpots(trip);
  trip.chests = { opened, day, ...(shut.length ? { shut } : {}) };
  saveChestDay(kidId, day, opened);
  saveTrip(kidId, trip);
}

/** Marks a chest opened for the local day and saves it. Returns false when the chest was already open today: pay nothing then. */
export function openChest(kidId: string, trip: TripState, spot: string, now: number = Date.now()): boolean {
  syncChestDay(kidId, trip, now);
  if (openedSpots(trip).includes(spot)) return false;
  const day = dayKey(now);
  const opened = [...openedSpots(trip), spot];
  const shut = shutSpots(trip).filter((s) => s !== spot);
  trip.chests = { opened, day, ...(shut.length ? { shut } : {}) };
  saveChestDay(kidId, day, opened);
  saveTrip(kidId, trip);
  return true;
}

/**
 * What answering a chest's question does. A right answer writes the spot as opened for the local day first, then the gems it pays
 * (base 1 or 2, before the throttle) follow. The spot id is the grant's id: a second open of the same spot the same day, from a repeated
 * tap, a re-render or a new trip, returns `opened: false` and 0 gems. A wrong answer opens nothing and pays nothing: the spot is
 * shut for the rest of this trip (`shut: true`) and is offered again on the next trip. Every chest, power chests included, pays through
 * here and then through gemGrant, which applies the daily throttle and the once-a-day check against the stored game.
 */
export function claimChest(kidId: string, trip: TripState, spot: string, correct: boolean, base?: number, now: number = Date.now()): { opened: boolean; gems: number; shut?: boolean } {
  if (!correct) {
    syncChestDay(kidId, trip, now);
    if (openedSpots(trip).includes(spot)) return { opened: false, gems: 0 };
    if (!shutSpots(trip).includes(spot)) {
      trip.chests = { ...trip.chests!, opened: openedSpots(trip), shut: [...shutSpots(trip), spot] };
      saveTrip(kidId, trip);
    }
    return { opened: false, gems: 0, shut: true };
  }
  if (shutSpots(trip).includes(spot)) return { opened: false, gems: 0, shut: true }; // shut by a miss on this trip: no second try
  if (!openChest(kidId, trip, spot, now)) return { opened: false, gems: 0 };
  return { opened: true, gems: base ?? chestGems(trip.tripId, spot) };
}
