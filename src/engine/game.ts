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

export function applyRun(game: KidGame, run: RunSummary, now: number): KidGame {
  const today = dayKey(now);
  let streakDays = game.streakDays;
  if (game.lastPlayedDay !== today) {
    streakDays = game.lastPlayedDay === previousDay(today) ? streakDays + 1 : 1;
  }
  return {
    ...game,
    xp: game.xp + run.xp,
    gems: game.gems + run.gems,
    streakDays,
    lastPlayedDay: today,
    bestCombo: Math.max(game.bestCombo, run.bestCombo),
  };
}

export function buyHero(game: KidGame, heroId: string): KidGame | null {
  const hero = HEROES.find((h) => h.id === heroId);
  if (!hero || game.heroes.includes(heroId) || game.gems < hero.cost) return null;
  return { ...game, gems: game.gems - hero.cost, heroes: [...game.heroes, heroId], hero: heroId };
}
