import type { KidGame } from './models';
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
  /** A combo from this run. The stored best only moves up. */
  bestCombo?: number;
  /** When a run finished (epoch ms). Moves the day streak. Leave it out for a shop action. */
  playedAt?: number;
  /** A hero to buy: spends its cost and equips it. Fails when owned or too expensive. */
  purchase?: string;
  /** An owned hero to equip. */
  equip?: string;
}

/** The delta cannot apply to the current game (a hero already owned, not enough gems). Retrying will not help. */
export class GameDeltaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameDeltaError';
  }
}

export function applyDelta(game: KidGame, delta: GameDelta): KidGame {
  const xp = delta.xp ?? 0;
  const bestCombo = delta.bestCombo ?? 0;
  if (!Number.isFinite(xp) || xp < 0) throw new GameDeltaError('XP cannot go down.');
  if (!Number.isFinite(bestCombo) || bestCombo < 0) throw new GameDeltaError('Best combo cannot go down.');
  let next: KidGame = { ...game, xp: game.xp + xp, bestCombo: Math.max(game.bestCombo, bestCombo), heroes: [...game.heroes] };
  let gems = game.gems + (delta.gems ?? 0);
  if (!Number.isFinite(gems)) throw new GameDeltaError('Gems must be a number.');

  if (delta.playedAt !== undefined) {
    const today = dayKey(delta.playedAt);
    let streakDays = game.streakDays;
    if (game.lastPlayedDay !== today) {
      streakDays = game.lastPlayedDay === previousDay(today) ? streakDays + 1 : 1;
    }
    next = { ...next, streakDays, lastPlayedDay: today };
  }
  if (delta.purchase !== undefined) {
    const hero = HEROES.find((h) => h.id === delta.purchase);
    if (!hero) throw new GameDeltaError('That hero does not exist.');
    if (next.heroes.includes(hero.id)) throw new GameDeltaError('That hero is already owned.');
    if (gems < hero.cost) throw new GameDeltaError('Not enough gems.');
    gems -= hero.cost;
    next = { ...next, heroes: [...next.heroes, hero.id], hero: hero.id };
  }
  if (delta.equip !== undefined) {
    if (!next.heroes.includes(delta.equip)) throw new GameDeltaError('That hero is not owned.');
    next = { ...next, hero: delta.equip };
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
