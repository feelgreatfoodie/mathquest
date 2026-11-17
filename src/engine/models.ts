import type { Track } from './content';

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
}

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
};

export const DEFAULT_GAME: KidGame = {
  xp: 0,
  gems: 0,
  streakDays: 0,
  lastPlayedDay: null,
  bestCombo: 0,
  heroes: ['knight'],
  hero: 'knight',
};
