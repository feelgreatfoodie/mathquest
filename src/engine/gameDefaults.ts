// Zero imports on purpose. scripts/deploy-probe.mjs loads this file under plain Node, which cannot
// resolve extensionless imports the way Vite does. Keep it dependency-free (scripts/nodeImportSafety.test.ts).
// models.ts re-exports DEFAULT_GAME and checks it against KidGame.

export interface GameDefaults {
  xp: number;
  gems: number;
  streakDays: number;
  lastPlayedDay: string | null;
  bestCombo: number;
  heroes: string[];
  hero: string;
}

export const DEFAULT_GAME: GameDefaults = {
  xp: 0,
  gems: 0,
  streakDays: 0,
  lastPlayedDay: null,
  bestCombo: 0,
  heroes: ['knight'],
  hero: 'knight',
};
