import type { GameModeId } from '../modes/types';
import { addChest } from '../../engine/chestLedger';
import { MAPS, REGION_IDS, heroStart, isWalkable, type RegionId } from './maps';

/** Most chests the save remembers. The rules cap the list at the same number; the oldest drop first. */
export const MAX_OPENED = 500;
export type Facing = 'up' | 'down' | 'left' | 'right';
const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right'];
const MAX_KEYS = 99;
const LAST_MODES: readonly string[] = ['dungeon', 'prereader', 'overworld'];

/** One kid's place in the world. It is also the stored doc (families/{uid}/kids/{kidId}/world/main): 9 fields, 10 with lastMode. */
export interface WorldState {
  region: RegionId;
  x: number;
  y: number;
  facing: Facing;
  /** The chest ledger: a "#<n>" marker with the count of chests opened (engine/chestLedger.ts), after the card ids an older app stored. Which chests are open on a trip lives with the trip (trip.ts). */
  openedChests: string[];
  bossesDefeated: RegionId[];
  keys: number;
  version: 1;
  updatedAt: number;
  /** The kid's last mode pick. Optional: a doc from before it, or from an old bundle, has none and the device value is used. */
  lastMode?: GameModeId;
}

export type WorldAction =
  | { t: 'move'; x: number; y: number; facing?: Facing }
  | { t: 'chest' }
  | { t: 'key' }
  | { t: 'boss'; region: RegionId }
  | { t: 'region'; region: RegionId; x: number; y: number };

export function newWorld(now: number): WorldState {
  const s = heroStart(MAPS.meadow);
  return { region: 'meadow', x: s.x, y: s.y, facing: 'down', openedChests: [], bossesDefeated: [], keys: 0, version: 1, updatedAt: now };
}

/** The pure reducer. A boss gives one key the first time it is defeated. A chest adds 1 to the lifetime count. A key chest gives a key only to a kid who holds none. */
export function worldReducer(s: WorldState, a: WorldAction, now: number = s.updatedAt): WorldState {
  switch (a.t) {
    case 'move':
      return { ...s, x: a.x, y: a.y, facing: a.facing ?? s.facing, updatedAt: now };
    case 'chest':
      return { ...s, openedChests: addChest(s.openedChests), updatedAt: now };
    case 'key':
      return s.keys >= 1 ? s : { ...s, keys: 1, updatedAt: now };
    case 'boss':
      if (s.bossesDefeated.includes(a.region)) return s;
      return { ...s, bossesDefeated: [...s.bossesDefeated, a.region], keys: Math.min(MAX_KEYS, s.keys + 1), updatedAt: now };
    case 'region':
      return { ...s, region: a.region, x: a.x, y: a.y, updatedAt: now };
  }
}

export function toDoc(s: WorldState): WorldState {
  return { ...s, openedChests: [...s.openedChests], bossesDefeated: [...s.bossesDefeated] };
}

/** Reads a stored doc. Anything damaged reads as the default for that field, so a bad save never blocks the world. */
export function fromDoc(raw: unknown, now: number): WorldState {
  const base = newWorld(now);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const region = REGION_IDS.find((id) => id === r.region) ?? base.region;
  const map = MAPS[region];
  const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  const strings = (v: unknown, max: number) => (Array.isArray(v) ? (v.filter((x) => typeof x === 'string' && x.length > 0 && x.length <= 40) as string[]).slice(-max) : []);
  const start = heroStart(map);
  const x = int(r.x, 0, map.w - 1, start.x);
  const y = int(r.y, 0, map.h - 1, start.y);
  const at = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : now;
  return {
    region,
    x: x === r.x && y === r.y ? x : start.x,
    y: x === r.x && y === r.y ? y : start.y,
    facing: FACINGS.find((f) => f === r.facing) ?? 'down',
    openedChests: strings(r.openedChests, MAX_OPENED),
    bossesDefeated: [...new Set(strings(r.bossesDefeated, 3).filter((b): b is RegionId => (REGION_IDS as readonly string[]).includes(b)))],
    keys: int(r.keys, 0, MAX_KEYS, 0),
    version: 1,
    updatedAt: at,
    ...(LAST_MODES.includes(r.lastMode as GameModeId) ? { lastMode: r.lastMode as GameModeId } : {}),
  };
}

/**
 * A saved hero standing on a tile that is not walkable now (a map was redrawn since the save) moves to the region's start.
 * Gates count as open and the key and bridge kit as missing, so a hero never loads onto a tile that needs an item.
 */
export function settleHero(w: WorldState): WorldState {
  const map = MAPS[w.region];
  if (isWalkable(map, w.x, w.y, { gateOpen: true, hasKey: false, hasBridgeKit: false })) return w;
  const s = heroStart(map);
  return { ...w, x: s.x, y: s.y };
}
