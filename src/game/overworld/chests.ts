import { MAPS, findTiles, heroStart, isWalkable, type Point, type RegionId, type TileMap } from './maps';

// Chests on the Adventure map. Every trip has 3 to 5 chests in each land (3 for a pre-reader). Which spots they stand on is a
// function of the trip id and the land, so a trip that reopens finds the same spots, and the chests opened on it stay open.

/** The trip's chest spots are chosen from the land's own chest tiles. Ids name the land and the tile, so a chest keeps its id however many there are. */
export const spotId = (region: RegionId, p: Point): string => `${region}:${p.x},${p.y}`;

/** Every chest tile of a land in reading order, with its id. */
export function chestSpots(region: RegionId): Array<Point & { id: string }> {
  return findTiles(MAPS[region], 'chest').map((p) => ({ ...p, id: spotId(region, p) }));
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Chests in a land on one trip: 3 for a pre-reader, 3 to 5 for a reader. */
export function chestCountFor(tripId: string, region: RegionId, prereader: boolean): number {
  return prereader ? 3 : 3 + (hash(`${tripId}|${region}|n`) % 3);
}

/** Tiles the hero reaches from the start with the gate open and no key or bridge kit. */
export function reachableWithoutItems(map: TileMap): Set<string> {
  const ctx = { gateOpen: true, hasKey: false, hasBridgeKit: false };
  const s = heroStart(map);
  const seen = new Set<string>([`${s.x},${s.y}`]);
  const queue: Point[] = [s];
  while (queue.length) {
    const p = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const q = { x: p.x + dx, y: p.y + dy };
      const k = `${q.x},${q.y}`;
      if (!seen.has(k) && isWalkable(map, q.x, q.y, ctx)) {
        seen.add(k);
        queue.push(q);
      }
    }
  }
  return seen;
}

export interface TripSpot extends Point {
  id: string;
  /** The land's key chest on this trip: it holds a key while the kid has none. It stands where the hero reaches without a key. */
  key: boolean;
}

/**
 * The chest spots of a trip in a land. The first is the key chest, picked among the spots the hero reaches from the start
 * with no key and no bridge kit, so a key can always be found before the first door. `atLeast` raises the count when more
 * new skills need a chest (each one shows its teach card there).
 */
export function tripChestSpots(tripId: string, region: RegionId, prereader: boolean, atLeast = 0): TripSpot[] {
  const all = chestSpots(region).sort((a, b) => hash(`${tripId}|${a.id}`) - hash(`${tripId}|${b.id}`));
  if (!all.length) return [];
  const reach = reachableWithoutItems(MAPS[region]);
  const keyAt = all.find((s) => reach.has(`${s.x},${s.y}`)) ?? all[0]!;
  const count = Math.min(all.length, Math.max(chestCountFor(tripId, region, prereader), atLeast));
  return [keyAt, ...all.filter((s) => s.id !== keyAt.id)].slice(0, count).map((s) => ({ ...s, key: s.id === keyAt.id }));
}

/** Gems a chest pays before the throttle: 1 or 2, fixed by the trip and the spot. */
export function chestGems(tripId: string, id: string): 1 | 2 {
  return hash(`${tripId}|${id}|g`) % 2 === 0 ? 1 : 2;
}
