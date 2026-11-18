import type { Track } from './content';
import { MODULE_IDS, type ModuleId } from './modules/types';
import { DEFAULT_GAME as GAME_DEFAULTS } from './gameDefaults';
import { slotOf } from '../game/shop/catalog';
import type { VaultPointer, VaultSettings } from '../game/vault';

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
  /** Local day (YYYY-MM-DD) of the last graded answer, and how many graded answers that day. Absent on old cards. */
  day?: string;
  dayGraded?: number;
  /** Outcomes of the last two graded answers, newest last. Absent on old cards. */
  lastResults?: boolean[];
  /** Local day of the last miss. */
  missDay?: string;
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
   * A parent's floor per module: every group up to this number is open (1 = only the first). Optional on stored
   * docs: a missing module reads as today's rule (times tables use `factGroupsUnlocked`, the others start at
   * group 1). Progress can still open more. Read it through `groupFloor` in mastery.ts.
   */
  groupsUnlocked?: Partial<Record<ModuleId, number>>;
  /**
   * Multiplies every fast and slow time bar (3 = most time, 1 = the original bars).
   * Optional on stored docs: a missing value reads as 3. Read it through `paceOf`.
   */
  paceMultiplier?: number;
  /** The item shop (weapons, gear, pets, adventure, camp): off until a parent turns it on. A missing value reads as off. Read it through `shop2On`. */
  shop2?: boolean;
  /** The gem vault: off until a parent turns it on, with editable bonus rates per 10 gems (d3, d7, d14). A missing value reads as off with the default rates. Read it through `vaultOn` and `rateOf` in game/vault.ts. */
  vault?: VaultSettings;
  /** Gem speed: 0.5 (Slow), 1 (Normal) or 1.5 (Fast). A missing value reads as 1. Read it through `gemSpeedOf` in gems.ts. */
  gemSpeed?: number;
  /** Gems earned today at full rate (half to twice this, a quarter after). A missing value reads as 25 (reader) or 15 (pre-reader). Read it through `gemFullRateOf`. */
  gemFullRate?: number;
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
  /** Items bought in the shop (src/game/shop/catalog.ts). Never loses an entry. Absent before shop-2: read it through `ownedItems`. */
  items?: string[];
  /** Worn items by slot. Each must be in `items`. Absent before shop-2: read it through `equippedOf`. */
  equipped?: { weapon?: string; gear?: string; pet?: string };
  /** The item or hero the kid is saving for (the jar on home). */
  goal?: string;
  /** Set by the write that buys a hero or an item: the id of its purchases doc, so the rules can find that doc. */
  lastPurchaseId?: string;
  /** Gems earned from runs on `gemsDay` (local YYYY-MM-DD). Absent on a game from before the throttle. Read it through `earnedTodayOf`. */
  gemsEarnedToday?: number;
  gemsDay?: string;
}

/** The shop fields as stored in the kid doc's top-level `inventory` map. */
export interface Inventory {
  items: string[];
  equipped?: { weapon?: string; gear?: string; pet?: string };
  goal?: string;
}

/** One hero or item bought: written with the game change in the same transaction, never edited or deleted. Exactly one of heroId and itemId. */
export interface PurchaseLog {
  id: string;
  heroId?: string;
  itemId?: string;
  cost: number;
  /** Epoch ms. */
  at: number;
}

export interface Kid {
  id: string;
  name: string;
  createdAt: number;
  settings: KidSettings;
  game: KidGame;
  /**
   * The stored home of the shop fields (owned items, equipped slots, savings goal). On a loaded Kid these are merged
   * into `game` (items, equipped, goal) and this field is dropped; `splitGame` pulls them out again to write. They
   * live outside `game` so a save from an old bundle, which writes `game` without them, stays valid.
   */
  inventory?: Inventory;
  /**
   * The vault pointers (active count, newest deposit id, last closed id). The deposits are in the vault/ subcollection.
   * Kept out of `game` so a save from a bundle that predates the vault stays valid. Absent until the first deposit.
   */
  vault?: VaultPointer;
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

export function shop2On(settings: { shop2?: boolean } | undefined | null): boolean {
  return settings?.shop2 === true;
}

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

/** Lives in gameDefaults.ts so plain-Node scripts can load it. The annotation fails typecheck if it drifts from KidGame. */
export const DEFAULT_GAME: KidGame = GAME_DEFAULTS;

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
  const items = Array.isArray(g.items) ? (g.items.filter((i) => typeof i === 'string') as string[]) : [];
  const eq = g.equipped && typeof g.equipped === 'object' ? (g.equipped as Record<string, unknown>) : {};
  const equipped: NonNullable<KidGame['equipped']> = {};
  for (const slot of ['weapon', 'gear', 'pet'] as const) {
    const id = eq[slot];
    // Each slot keeps only an owned item that fits it: junk and a stale slot read as empty.
    if (typeof id === 'string' && items.includes(id) && slotOf(id) === slot) equipped[slot] = id;
  }
  return {
    xp: num(g.xp, DEFAULT_GAME.xp),
    gems: num(g.gems, DEFAULT_GAME.gems),
    streakDays: num(g.streakDays, DEFAULT_GAME.streakDays),
    lastPlayedDay: typeof g.lastPlayedDay === 'string' ? g.lastPlayedDay : DEFAULT_GAME.lastPlayedDay,
    bestCombo: num(g.bestCombo, DEFAULT_GAME.bestCombo),
    heroes,
    hero: str(g.hero, DEFAULT_GAME.hero),
    ...(items.length ? { items } : {}),
    ...(Object.keys(equipped).length ? { equipped } : {}),
    ...(typeof g.goal === 'string' && g.goal ? { goal: g.goal } : {}),
    ...(typeof g.gemsDay === 'string' && typeof g.gemsEarnedToday === 'number' && Number.isFinite(g.gemsEarnedToday)
      ? { gemsEarnedToday: g.gemsEarnedToday, gemsDay: g.gemsDay }
      : {}),
  };
}

export function normalizeKid(raw: Kid): Kid {
  const { inventory, ...rest } = raw;
  const g = (raw as { game?: unknown }).game;
  const base = g && typeof g === 'object' ? (g as Record<string, unknown>) : {};
  // The stored inventory wins over any items, equipped or goal left in game.
  const inv = inventory && typeof inventory === 'object' ? (inventory as unknown as Record<string, unknown>) : {};
  const merged = { ...base, ...(inventory ? { items: inv.items, equipped: inv.equipped, goal: inv.goal } : {}) };
  return { ...rest, game: normalizeGame(merged) };
}

/**
 * Splits a game into what the `game` field stores and what the `inventory` field stores. The inventory is undefined
 * for a game with no items, no equipped slot and no goal, so a kid who never shopped keeps a doc with no inventory.
 */
export function splitGame(game: KidGame): { game: KidGame; inventory: Inventory | undefined } {
  const { items, equipped, goal, ...rest } = game;
  const hasEquipped = !!equipped && Object.keys(equipped).length > 0;
  const hasAny = (items?.length ?? 0) > 0 || hasEquipped || !!goal;
  const inventory: Inventory | undefined = hasAny
    ? { items: items ?? [], ...(hasEquipped ? { equipped } : {}), ...(goal ? { goal } : {}) }
    : undefined;
  return { game: rest, inventory };
}

/** True when two inventories hold the same items, equipped slots and goal (an absent inventory equals an empty one). */
export function sameInventory(a: Inventory | undefined, b: Inventory | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
