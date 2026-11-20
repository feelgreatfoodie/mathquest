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
  return reachableWith(map, { hasKey: false, hasBridgeKit: false });
}

/** The adventure items whose power adds a chest spot to a land. */
export interface MapGear {
  key?: boolean;
  bridge?: boolean;
}
export type PowerKind = 'key' | 'bridge';

/** Tiles the hero reaches from the start with the gate open and the given items (and only those). */
export function reachableWith(map: TileMap, gear: { hasKey: boolean; hasBridgeKit: boolean }): Set<string> {
  const ctx = { gateOpen: true, ...gear };
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

/**
 * The power chest spots of a land (tiles `P`): a side room behind a door needs the key item, an island behind spans needs the
 * bridge kit item. The kind follows from what the hero can reach, so a map edit cannot leave a spot with the wrong item.
 */
export function powerSpots(region: RegionId): Array<Point & { id: string; power: PowerKind }> {
  const m = MAPS[region];
  const none = reachableWith(m, { hasKey: false, hasBridgeKit: false });
  const key = reachableWith(m, { hasKey: true, hasBridgeKit: false });
  const kit = reachableWith(m, { hasKey: false, hasBridgeKit: true });
  const out: Array<Point & { id: string; power: PowerKind }> = [];
  for (const p of findTiles(m, 'vault')) {
    const k = `${p.x},${p.y}`;
    if (none.has(k)) continue;
    if (key.has(k)) out.push({ ...p, id: spotId(region, p), power: 'key' });
    else if (kit.has(k)) out.push({ ...p, id: spotId(region, p), power: 'bridge' });
  }
  return out;
}

export interface TripSpot extends Point {
  id: string;
  /** Set on a spot that an owned item adds: it stands behind a key door or across the bridge kit's spans. */
  power?: PowerKind | 'dog';
  /** The Dog's bonus chest stands out of sight until the hero comes within a few tiles. */
  hidden?: true;
  /** The land's key chest on this trip: it holds a key while the kid has none. It stands where the hero reaches without a key. */
  key: boolean;
}

/**
 * The chest spots of a trip in a land. The first is the key chest, picked among the spots the hero reaches from the start
 * with no key and no bridge kit, so a key can always be found before the first door. `atLeast` raises the count when more
 * new skills need a chest (each one shows its teach card there).
 */
export function tripChestSpots(tripId: string, region: RegionId, prereader: boolean, atLeast = 0, gear: MapGear = {}, opened: readonly string[] = []): TripSpot[] {
  const all = chestSpots(region).sort((a, b) => hash(`${tripId}|${a.id}`) - hash(`${tripId}|${b.id}`));
  if (!all.length) return [];
  const reach = reachableWithoutItems(MAPS[region]);
  const keyAt = all.find((s) => reach.has(`${s.x},${s.y}`)) ?? all[0]!;
  const count = Math.min(all.length, Math.max(chestCountFor(tripId, region, prereader), atLeast));
  const base = [keyAt, ...all.filter((s) => s.id !== keyAt.id)].slice(0, count).map((s): TripSpot => ({ ...s, key: s.id === keyAt.id }));
  return withPowerSpots(tripId, region, base, gear, opened);
}

/**
 * An owned item moves a chest of the trip into its room or onto its island. The count never changes: a power chest takes the
 * place of a base spot (never the key chest, never a spot already opened), so the trip asks the same questions with the item as
 * without it. The spot a power picks depends on the trip and the land only, so a re-render finds the same chest.
 */
function withPowerSpots(tripId: string, region: RegionId, base: TripSpot[], gear: MapGear, opened: readonly string[]): TripSpot[] {
  const picks: TripSpot[] = [];
  for (const kind of ['key', 'bridge'] as const) {
    if (!(kind === 'key' ? gear.key : gear.bridge)) continue;
    const pool = powerSpots(region).filter((p) => p.power === kind).sort((a, b) => hash(`${tripId}|${a.id}|p`) - hash(`${tripId}|${b.id}|p`));
    // The spot opened on this trip stays the pick, so it keeps showing as opened.
    const pick = pool.find((p) => opened.includes(p.id)) ?? pool[0];
    if (pick) picks.push({ x: pick.x, y: pick.y, id: pick.id, key: false, power: kind });
  }
  if (!picks.length) return base;
  const out = [...base];
  for (const p of picks) {
    const at = out.findIndex((s) => !s.key && !s.power && !opened.includes(s.id));
    if (at >= 0) out[at] = p;
  }
  return out;
}

/** Gems a chest pays before the throttle: 1 or 2, fixed by the trip and the spot. */
export function chestGems(tripId: string, id: string): 1 | 2 {
  return hash(`${tripId}|${id}|g`) % 2 === 0 ? 1 : 2;
}
