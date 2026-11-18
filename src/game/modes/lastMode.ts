import type { GameModeId } from './types';

// The kid's last mode pick. It lives in world/main when that doc exists, and on this device always: a kid token cannot
// write the kid's settings, and the pick is a convenience, never a rule. Storage that throws or holds junk reads as no pick.
const key = (kidId: string) => `mathquest:v1:lastMode:${kidId}`;
const IDS: readonly string[] = ['dungeon', 'prereader', 'overworld'];

/** The pick stored in a world doc (any shape): a known mode id, else null. Kept apart from worldState so the Home screen does not load the maps. */
export function lastModeOf(world: unknown): GameModeId | null {
  const v = world && typeof world === 'object' ? (world as { lastMode?: unknown }).lastMode : undefined;
  return typeof v === 'string' && IDS.includes(v) ? (v as GameModeId) : null;
}

export function readLastMode(kidId: string): GameModeId | null {
  try {
    const v = localStorage.getItem(key(kidId));
    return v && IDS.includes(v) ? (v as GameModeId) : null;
  } catch {
    return null;
  }
}

export function writeLastMode(kidId: string, mode: GameModeId): void {
  try {
    localStorage.setItem(key(kidId), mode);
  } catch {
    // Not saved; the next run starts in the default mode.
  }
}
