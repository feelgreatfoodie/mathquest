import { GEM_RUN_MAX, earnedTodayOf, gemsForRun, type GemRunStats, type GemSettings } from './gems';
import { EQUIP_SLOTS, itemById, type EquipSlot } from '../game/shop/catalog';
import type { KidGame, Learner } from './models';
import type { RunSummary } from './session';

export interface Hero {
  id: string;
  name: string;
  cost: number;
}

export const HEROES: Hero[] = [
  { id: 'knight', name: 'Knight', cost: 0 },
  { id: 'wizard', name: 'Wizard', cost: 15 },
  { id: 'ranger', name: 'Ranger', cost: 35 },
  { id: 'robot', name: 'Robot', cost: 60 },
  { id: 'dragon', name: 'Dragon Rider', cost: 100 },
];

/** Level grows with the square root of XP so early levels come quickly. */
export function levelFor(xp: number): { level: number; into: number; span: number } {
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const start = 100 * (level - 1) ** 2;
  const end = 100 * level ** 2;
  return { level, into: xp - start, span: end - start };
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y!, m! - 1, d! - 1).getTime());
}

/**
 * A change to a kid's game totals. This is the only shape a game write takes: a repo applies it to the
 * game it reads at write time (applyGameDelta), so a screen holding an old copy cannot overwrite newer totals.
 */
export interface GameDelta {
  /** XP earned. Never negative. */
  xp?: number;
  /** Gems earned (positive) or spent (negative). The total may not go below 0. */
  gems?: number;
  /**
   * A finished run's gems, worked out from the game this delta is applied to (so a stale screen or a second
   * device cannot skip the throttle). When set it replaces `gems`. Needs `playedAt`.
   */
  gemRun?: { stats: GemRunStats; learner: Learner; settings: GemSettings };
  /** A combo from this run. The stored best only moves up. */
  bestCombo?: number;
  /** When a run finished (epoch ms). Moves the day streak. Leave it out for a shop action. */
  playedAt?: number;
  /** A hero or an item (catalog id) to buy: spends its catalog price and equips it. Fails when owned or too expensive. */
  purchase?: string;
  /** An owned hero or item to equip. An item takes its slot. */
  equip?: string;
  /** Empties a slot. The item stays owned. */
  unequip?: EquipSlot;
  /** Pins the hero or item the kid is saving for. null clears it. An owned hero or item cannot be a goal. */
  goal?: string | null;
}

/** The delta cannot apply to the current game (a hero already owned, not enough gems). Retrying will not help. */
export class GameDeltaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameDeltaError';
  }
}

/**
 * The gems a delta adds to `game`: the throttled run gems when `gemRun` is set, else `delta.gems`.
 * A run delta from a bundle older than the gem economy has an absolute `gems` (11 or 12 on a long run) and no
 * `gemRun`. The rules refuse a raise above GEM_RUN_MAX, so a positive `gems` on a run delta is clamped to it. A negative `gems`
 * (a price) is unchanged.
 */
export function awardedGems(game: KidGame, delta: GameDelta): number {
  if (!delta.gemRun) {
    const g = delta.gems ?? 0;
    // Only a run (it carries playedAt) is clamped. A bare grant, as the tests and the parent tools write, is not.
    return delta.playedAt !== undefined && g > GEM_RUN_MAX ? GEM_RUN_MAX : g;
  }
  if (delta.playedAt === undefined) throw new GameDeltaError('A run needs the time it finished.');
  const { stats, learner, settings } = delta.gemRun;
  return gemsForRun(stats, learner, settings, earnedTodayOf(game, delta.playedAt));
}

export function applyDelta(game: KidGame, delta: GameDelta): KidGame {
  const xp = delta.xp ?? 0;
  const bestCombo = delta.bestCombo ?? 0;
  if (!Number.isFinite(xp) || xp < 0) throw new GameDeltaError('XP cannot go down.');
  if (!Number.isFinite(bestCombo) || bestCombo < 0) throw new GameDeltaError('Best combo cannot go down.');
  let next: KidGame = { ...game, xp: game.xp + xp, bestCombo: Math.max(game.bestCombo, bestCombo), heroes: [...game.heroes] };
  // items and equipped carry through the spread above; they are replaced, never edited in place.
  const earned = awardedGems(game, delta);
  let gems = game.gems + earned;
  if (!Number.isFinite(gems)) throw new GameDeltaError('Gems must be a number.');

  if (delta.playedAt !== undefined) {
    const today = dayKey(delta.playedAt);
    let streakDays = game.streakDays;
    if (game.lastPlayedDay !== today) {
      streakDays = game.lastPlayedDay === previousDay(today) ? streakDays + 1 : 1;
    }
    next = { ...next, streakDays, lastPlayedDay: today };
    // A run's gems count toward today. A replay older than the stored day leaves the count alone.
    if (earned > 0 && (game.gemsDay === undefined || game.gemsDay <= today)) {
      next = { ...next, gemsEarnedToday: earnedTodayOf(game, delta.playedAt) + earned, gemsDay: today };
    }
  }
  if (delta.purchase !== undefined) {
    const hero = HEROES.find((h) => h.id === delta.purchase);
    const item = hero ? undefined : itemById(delta.purchase);
    if (!hero && !item) throw new GameDeltaError('That is not in the shop.');
    const cost = (hero ?? item)!.cost;
    const items = next.items ?? [];
    if (next.heroes.includes(delta.purchase) || items.includes(delta.purchase)) throw new GameDeltaError('That is already owned.');
    if (gems < cost) throw new GameDeltaError('Not enough gems.');
    gems -= cost;
    if (hero) {
      next = { ...next, heroes: [...next.heroes, hero.id], hero: hero.id };
    } else {
      next = { ...next, items: [...items, item!.id] };
      if (item!.slot) next = { ...next, equipped: { ...(next.equipped ?? {}), [item!.slot]: item!.id } };
    }
    // Buying the pinned goal ends the goal.
    if (next.goal === delta.purchase) {
      const { goal: _done, ...rest } = next;
      next = rest;
    }
  }
  if (delta.equip !== undefined) {
    const item = itemById(delta.equip);
    if (item) {
      if (!(next.items ?? []).includes(item.id)) throw new GameDeltaError('That item is not owned.');
      if (!item.slot) throw new GameDeltaError('That item is not worn.');
      next = { ...next, equipped: { ...(next.equipped ?? {}), [item.slot]: item.id } };
    } else {
      if (!next.heroes.includes(delta.equip)) throw new GameDeltaError('That hero is not owned.');
      next = { ...next, hero: delta.equip };
    }
  }
  if (delta.unequip !== undefined) {
    if (!EQUIP_SLOTS.includes(delta.unequip)) throw new GameDeltaError('That is not a slot.');
    const { [delta.unequip]: _gone, ...rest } = next.equipped ?? {};
    next = { ...next, equipped: rest };
  }
  if (delta.goal !== undefined) {
    if (delta.goal === null) {
      const { goal: _cleared, ...rest } = next;
      next = rest;
    } else {
      const known = HEROES.some((h) => h.id === delta.goal) || itemById(delta.goal);
      if (!known) throw new GameDeltaError('That is not in the shop.');
      if (next.heroes.includes(delta.goal) || (next.items ?? []).includes(delta.goal)) throw new GameDeltaError('That is already owned.');
      next = { ...next, goal: delta.goal };
    }
  }
  if (gems < 0) throw new GameDeltaError('Not enough gems.');
  return { ...next, gems };
}

export function applyRun(game: KidGame, run: RunSummary, now: number): KidGame {
  return applyDelta(game, { xp: run.xp, gems: run.gems, bestCombo: run.bestCombo, playedAt: now });
}

export function buyHero(game: KidGame, heroId: string): KidGame | null {
  try {
    return applyDelta(game, { purchase: heroId });
  } catch (e) {
    if (e instanceof GameDeltaError) return null;
    throw e;
  }
}

/** The purchases-log field that names what was bought: a hero id in heroId, an item id in itemId. Exactly one. */
export function purchaseTarget(id: string): { heroId: string } | { itemId: string } {
  return itemById(id) ? { itemId: id } : { heroId: id };
}
