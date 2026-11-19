import { MAPS, REGION_IDS, isWalkable, tileAt, type RegionId, type Tile, type TileMap } from './maps';

// The camp: a tent and up to 3 flags in each land that a kid places on the map. Cosmetic only: no gems, no XP, no grading.
// Stored in its own doc (families/{uid}/kids/{kidId}/world/camp) because world/main is full at 10 fields. Items are never
// solid: the hero walks over them, so none can block a path, a door, a gate, the boss door or a lair exit. They also only
// stand on plain grass with no special tile beside them, so the approach to every door stays clear to the eye.

export type CampKind = 'tent' | 'flag';
export const CAMP_KINDS: readonly CampKind[] = ['tent', 'flag'];
export const MAX_FLAGS = 3;
export const MAX_TENTS = 1;
/** 1 tent plus 3 flags in each of the 3 lands. The rules cap the list at the same number. */
export const MAX_PLACED = MAX_TENTS + MAX_FLAGS * REGION_IDS.length;

export interface Placed {
  region: RegionId;
  kind: CampKind;
  x: number;
  y: number;
}

/** The stored doc. The rules allow exactly these 3 fields. */
export interface CampDoc {
  placed: Placed[];
  version: 1;
  updatedAt: number;
}

export type CampAction = { t: 'place'; item: Placed } | { t: 'remove'; region: RegionId; x: number; y: number };

export const newCamp = (now: number): CampDoc => ({ placed: [], version: 1, updatedAt: now });

/** Tiles that stay clear of decor: the doors, gates, the camp fire, the start, the chests and any water crossing. */
const KEEP_CLEAR: ReadonlySet<Tile> = new Set<Tile>(['gate', 'back', 'door', 'span', 'bridge', 'boss', 'camp', 'start', 'chest', 'exit', 'rdoor']);
const OPEN: { gateOpen: true; hasKey: false; hasBridgeKit: false } = { gateOpen: true, hasKey: false, hasBridgeKit: false };

/** True when a tile may hold decor: walkable plain grass in the overworld, and no door, gate, chest, camp or crossing within one tile (8 ways). */
export function canPlaceAt(map: TileMap, x: number, y: number): boolean {
  if (map.lair) return false;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  if (tileAt(map, x, y) !== 'grass' || !isWalkable(map, x, y, OPEN)) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (KEEP_CLEAR.has(tileAt(map, x + dx, y + dy))) return false;
  return true;
}

export const flagsIn = (placed: readonly Placed[], region: RegionId): number => placed.filter((p) => p.kind === 'flag' && p.region === region).length;
export const tentOf = (placed: readonly Placed[]): Placed | undefined => placed.find((p) => p.kind === 'tent');
export const itemAt = (placed: readonly Placed[], region: RegionId, x: number, y: number): Placed | undefined => placed.find((p) => p.region === region && p.x === x && p.y === y);

/** Why a placement is refused, or null when it is allowed. A second tent is never refused: it moves the first. */
export function placeBlock(placed: readonly Placed[], item: Placed): 'tile' | 'taken' | 'flags' | null {
  if (!canPlaceAt(MAPS[item.region], item.x, item.y)) return 'tile';
  if (itemAt(placed, item.region, item.x, item.y)) return 'taken';
  if (item.kind === 'flag' && flagsIn(placed, item.region) >= MAX_FLAGS) return 'flags';
  return null;
}

export function campReducer(c: CampDoc, a: CampAction, now: number): CampDoc {
  if (a.t === 'remove') {
    const placed = c.placed.filter((p) => !(p.region === a.region && p.x === a.x && p.y === a.y));
    return placed.length === c.placed.length ? c : { ...c, placed, updatedAt: now };
  }
  if (placeBlock(c.placed, a.item)) return c;
  const rest = a.item.kind === 'tent' ? c.placed.filter((p) => p.kind !== 'tent') : c.placed;
  return { ...c, placed: sortPlaced([...rest, { region: a.item.region, kind: a.item.kind, x: a.item.x, y: a.item.y }]), updatedAt: now };
}

/** The order the rules require: the tent first, then the flags sorted by region name (then by tile, so the order is stable). */
export function sortPlaced(placed: readonly Placed[]): Placed[] {
  const rank = (p: Placed) => (p.kind === 'tent' ? 0 : 1);
  return [...placed].sort((a, b) => rank(a) - rank(b) || (a.region < b.region ? -1 : a.region > b.region ? 1 : 0) || a.y - b.y || a.x - b.x);
}

export const toCampDoc = (c: CampDoc): CampDoc => ({ ...c, placed: sortPlaced(c.placed).map((p) => ({ ...p })) });

/**
 * Reads a stored camp doc. Damaged data reads as an empty camp. Each entry must have a known region and kind, whole-number x and y,
 * and stand on a tile that canPlaceAt accepts now (a map redrawn since the save drops the items that no longer fit). Duplicated tiles,
 * a second tent and a 4th flag in a land drop too, so a doc from any source never shows more than the rules would have taken.
 */
export function fromCampDoc(raw: unknown, now: number): CampDoc {
  const base = newCamp(now);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.placed)) return { ...base, updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : now };
  const placed: Placed[] = [];
  for (const e of r.placed) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const region = REGION_IDS.find((id) => id === o.region);
    const kind = CAMP_KINDS.find((k) => k === o.kind);
    if (!region || !kind || typeof o.x !== 'number' || typeof o.y !== 'number') continue;
    const item: Placed = { region, kind, x: o.x, y: o.y };
    if (placed.length >= MAX_PLACED) break;
    if (placeBlock(placed, item)) continue;
    if (kind === 'tent' && tentOf(placed)) continue;
    placed.push(item);
  }
  const at = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : now;
  return { placed: sortPlaced(placed), version: 1, updatedAt: at };
}
