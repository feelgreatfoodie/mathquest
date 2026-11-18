import type { Track } from './content';
import { MODULE_IDS, type ModuleId } from './modules/types';

/** ts-fsrs Card, flattened to JSON-safe numbers (epoch ms) for Firestore and localStorage. */
export interface StoredFsrs {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
}

/** One kid's memory state for one card. */
export interface CardState {
  id: string;
  fsrs: StoredFsrs;
  attempts: number;
  correct: number;
  /** Response times (ms) of the most recent correct answers, newest last. */
  recentMs: number[];
  lastRating: number;
  updatedAt: number;
}

export type CardMap = Record<string, CardState>;

export interface KidSettings {
  tracks: Record<Track, boolean>;
  /** Graded questions per run. */
  sessionSize: number;
  /** Most new cards introduced per run. */
  maxNew: number;
  /** Fact groups a parent marks as already started (1 = only the first group). */
  factGroupsUnlocked: number;
  /**
   * Multiplies every fast and slow time bar (3 = most time, 1 = the original bars).
   * Optional on stored docs: a missing value reads as 3. Read it through `paceOf`.
   */
  paceMultiplier?: number;
  /** Who plays: a missing value reads as 'reader'. Read it through `learnerOf`. */
  learner?: Learner;
  /**
   * Which modules are on. Optional on stored docs: a missing value derives them from `tracks`.
   * Read it through `modulesOf`. `tracks` is still written for old clients.
   */
  modules?: Partial<Record<ModuleId, boolean>>;
}

export type Learner = 'prereader' | 'reader';

export interface KidGame {
  xp: number;
  gems: number;
  streakDays: number;
  lastPlayedDay: string | null;
  bestCombo: number;
  heroes: string[];
  hero: string;
}

export interface Kid {
  id: string;
  name: string;
  createdAt: number;
  settings: KidSettings;
  game: KidGame;
  /** Set by the setKidPin function. The PIN hash itself lives server-side only. */
  hasPin?: boolean;
}

export interface Family {
  pinHash: string | null;
  createdAt: number;
}

export interface SessionLog {
  id: string;
  startedAt: number;
  endedAt: number;
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
}

export const DEFAULT_SETTINGS: KidSettings = {
  tracks: { facts: true, multidigit: true, fractions: true },
  sessionSize: 30,
  maxNew: 8,
  factGroupsUnlocked: 1,
  paceMultiplier: 3,
};

export const DEFAULT_PACE = 3;

/** Starting settings for the two kinds of player. `reader` is today's DEFAULT_SETTINGS. */
export const PRESETS: Record<Learner, KidSettings> = {
  reader: DEFAULT_SETTINGS,
  prereader: {
    learner: 'prereader',
    modules: { add10: true },
    tracks: { facts: false, multidigit: false, fractions: false },
    sessionSize: 10,
    maxNew: 4,
    factGroupsUnlocked: 1,
    paceMultiplier: 3,
  },
};

export function learnerOf(settings: { learner?: Learner } | undefined | null): Learner {
  return settings?.learner === 'prereader' ? 'prereader' : 'reader';
}

const LEGACY_TRACKS: readonly ModuleId[] = ['facts', 'multidigit', 'fractions'];

/**
 * Which modules are on. `modules` wins when it names an id. The three old tracks fall back to
 * `tracks`, so a doc written before modules existed reads the same. Every other id defaults to off.
 */
export function modulesOf(settings: Pick<KidSettings, 'tracks' | 'modules'> | undefined | null): Record<ModuleId, boolean> {
  const out = {} as Record<ModuleId, boolean>;
  for (const id of MODULE_IDS) {
    const explicit = settings?.modules?.[id];
    out[id] = typeof explicit === 'boolean' ? explicit : LEGACY_TRACKS.includes(id) ? settings?.tracks?.[id as Track] === true : false;
  }
  return out;
}

/**
 * Turns one module on or off. `tracks` is kept in step for old clients. `modules` is written only
 * when it already exists or a new-style module is touched, so a reader doc that never uses one stays as it was.
 */
export function withModule(settings: KidSettings, id: ModuleId, on: boolean): KidSettings {
  const legacy = LEGACY_TRACKS.includes(id);
  const next: KidSettings = { ...settings, tracks: legacy ? { ...settings.tracks, [id as Track]: on } : settings.tracks };
  if (!legacy || settings.modules) next.modules = { ...settings.modules, [id]: on };
  return next;
}

export interface LearnerParams {
  /** Questions between a miss and its retry. */
  retryGap: number;
  /** Questions per monster. */
  blockSize: number;
}

export function learnerParams(learner: Learner): LearnerParams {
  return learner === 'prereader' ? { retryGap: 2, blockSize: 3 } : { retryGap: 3, blockSize: 5 };
}

/** The pace to grade with: a missing, zero, negative or non-finite value reads as 3. */
export function paceOf(settings: { paceMultiplier?: number } | undefined | null): number {
  const p = settings?.paceMultiplier;
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : DEFAULT_PACE;
}

export const DEFAULT_GAME: KidGame = {
  xp: 0,
  gems: 0,
  streakDays: 0,
  lastPlayedDay: null,
  bestCombo: 0,
  heroes: ['knight'],
  hero: 'knight',
};

/**
 * The one place a stored kid doc becomes a Kid. A doc written before a game field existed
 * (or with `game: {}`) reads with that field at its DEFAULT_GAME value, so no screen sees
 * undefined. Wrong-typed values also fall back. Every repo read goes through this.
 */
export function normalizeGame(raw: unknown): KidGame {
  const g = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d);
  const heroes = Array.isArray(g.heroes) && g.heroes.every((h) => typeof h === 'string') && g.heroes.length > 0
    ? (g.heroes as string[]).slice()
    : DEFAULT_GAME.heroes.slice();
  return {
    xp: num(g.xp, DEFAULT_GAME.xp),
    gems: num(g.gems, DEFAULT_GAME.gems),
    streakDays: num(g.streakDays, DEFAULT_GAME.streakDays),
    lastPlayedDay: typeof g.lastPlayedDay === 'string' ? g.lastPlayedDay : DEFAULT_GAME.lastPlayedDay,
    bestCombo: num(g.bestCombo, DEFAULT_GAME.bestCombo),
    heroes,
    hero: str(g.hero, DEFAULT_GAME.hero),
  };
}

export function normalizeKid(raw: Kid): Kid {
  return { ...raw, game: normalizeGame((raw as { game?: unknown }).game) };
}
