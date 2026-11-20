import { GROUP_UNLOCK_SHARE } from '../../engine/mastery';
import { DEFAULT_SETTINGS, type CardMap, type KidSettings } from '../../engine/models';
import { hash, reachableWithoutItems, spotId, type TripSpot } from './chests';
import { MAPS, heroStart, tileAt, type Point, type RegionId } from './maps';
import { regionProgress } from './regions';
import { saveTrip, type TripState } from './trip';

// Item powers, pets PR. PDR rule 1: a pet never touches a question, an answer, timing or grading. Nothing in this file reads the
// session, and nothing in the session reads this file. A pet moves a chest, shows a ring, digs a gem or plays an animation.
// A pet works only while it is owned and equipped. Gems any pet makes pay through `gemGrant` and the soft throttle, once per grant id.
//
// Where each pet acts:
//   Dog, Beetle   the five lands only (a lair has its own chests and no grass to dig in).
//   Owl           the land map: the ring sits on the lair door, which is on the land map.
//   Dragon Pup    the land boss and the lair boss: an animation after a right boss answer, and cheers at combos of 5, 10 and 20.
// Nothing here writes world/main, so a move inside a lair never does either.

export type PetKind = 'dog' | 'beetle' | 'owl' | 'pup';
const PET_OF: Record<string, PetKind> = { 'p-dog': 'dog', 'p-beetle': 'beetle', 'p-owl': 'owl', 'p-pup': 'pup' };

/** The pet whose power is on: the equipped one, and only while the kid owns it. */
export function activePet(equipped: string | undefined, owned: readonly string[]): PetKind | null {
  return equipped && owned.includes(equipped) ? PET_OF[equipped] ?? null : null;
}

const key = (p: Point) => `${p.x},${p.y}`;
const near = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Grass tiles the hero reaches with no item, at least `minFromStart` tiles from the start, not in `avoid`. */
function grassTiles(region: RegionId, minFromStart: number, avoid: readonly Point[]): Point[] {
  const m = MAPS[region];
  const s = heroStart(m);
  const reach = reachableWithoutItems(m);
  const bad = new Set(avoid.map(key));
  const out: Point[] = [];
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const p = { x, y };
      if (tileAt(m, x, y) !== 'grass' || !reach.has(key(p)) || bad.has(key(p)) || near(p, s) < minFromStart) continue;
      out.push(p);
    }
  return out;
}

function pick(tiles: Point[], seed: string): Point | null {
  return tiles.sort((a, b) => hash(`${seed}|${key(a)}`) - hash(`${seed}|${key(b)}`) || a.y - b.y || a.x - b.x)[0] ?? null;
}

// ---- Beetle: 1 gem a trip, dug up at a grass tile ----

export const BEETLE_GEMS = 1;
/** The grant id of the trip's dig. One per trip, whichever land the kid stands in. */
export const beetleId = (tripId: string): string => `beetle:${tripId}`;

/** Where the Beetle digs in a land on this trip: a grass tile at least 4 tiles from the start. It depends on the trip and the land only. */
export function beetleTile(tripId: string, region: RegionId): Point | null {
  const m = MAPS[region];
  const chests = findChestTiles(region);
  return pick(grassTiles(region, 4, [...chests, heroStart(m)]), `${tripId}|${region}|beetle`);
}

function findChestTiles(region: RegionId): Point[] {
  const m = MAPS[region];
  const out: Point[] = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (['chest', 'spawn', 'vault'].includes(tileAt(m, x, y))) out.push({ x, y });
  return out;
}

// ---- Dog: 1 hidden bonus chest a trip, found by a bark ----

/** The bonus chest pays a fixed 3 before the throttle (a plain chest pays 1 or 2). The throttle and the cap of 10 apply to it. */
export const DOG_CHEST_GEMS = 3;
/** The dog barks and the chest shows when the hero stands within this many tiles of it. */
export const DOG_SNIFF_RANGE = 4;

/**
 * With the Dog, one chest of the trip moves to a hidden grass tile. The count never changes: the bonus chest takes the place of
 * a plain base spot (never the key chest, never a power chest), so the trip asks the same questions with the Dog as without it.
 * The slot and the tile depend on the trip and the land only, so a re-render finds the same chest. A base spot opened before the
 * Dog came along is not swapped out, and an opened bonus chest keeps its slot.
 */
export function withDogSpot(tripId: string, region: RegionId, spots: TripSpot[], opened: readonly string[]): TripSpot[] {
  const eligible = spots.filter((s) => !s.key && !s.power);
  if (!eligible.length) return spots;
  const slot = [...eligible].sort((a, b) => hash(`${tripId}|${a.id}|dog`) - hash(`${tripId}|${b.id}|dog`))[0]!;
  const beetle = beetleTile(tripId, region);
  const avoid = [...findChestTiles(region), ...spots, ...(beetle ? [beetle] : [])];
  const tile = pick(grassTiles(region, 6, avoid), `${tripId}|${region}|dog`);
  if (!tile) return spots;
  const id = spotId(region, tile);
  if (opened.includes(slot.id) && !opened.includes(id)) return spots;
  return spots.map((s) => (s.id === slot.id ? { x: tile.x, y: tile.y, id, key: false, power: 'dog' as const, hidden: true as const } : s));
}

// ---- Owl: the lair ring ----

/** How full the ring around a lair door is: the region's share toward the lair rule, 0 to 1. It reads `regionProgress` and nothing else. */
export function lairRingFill(region: RegionId, cards: CardMap, settings: KidSettings = DEFAULT_SETTINGS): number {
  const p = regionProgress(region, cards, settings);
  return p.total ? Math.min(1, p.done / p.total / GROUP_UNLOCK_SHARE) : 0;
}

// ---- Dragon Pup: an animation after a right boss answer, cheers at combos ----

export const CHEER_COMBOS = [5, 10, 20] as const;
/** The cheer for a combo that just reached 5, 10 or 20, or null. */
export function pupCheer(combo: number): 5 | 10 | 20 | null {
  return (CHEER_COMBOS as readonly number[]).includes(combo) ? (combo as 5 | 10 | 20) : null;
}

// ---- Grants ----

/**
 * Records a pet's grant id on the trip, on this device, and says whether it pays. The same id a second time (a repeated tap, a
 * re-render, a reopen of the trip) pays 0. The caller sends `gems` through `gemGrant`, which applies the throttle and the cap.
 */
export function claimPetGrant(kidId: string, trip: TripState, id: string, base: number): { paid: boolean; gems: number } {
  const done = trip.pets?.claimed ?? [];
  if (done.includes(id)) return { paid: false, gems: 0 };
  trip.pets = { claimed: [...done, id] };
  saveTrip(kidId, trip);
  return { paid: true, gems: base };
}

// ---- Tap target ----

/** A pet's spot is a target this many CSS pixels across: a tap within half of it from the center counts as a tap on the spot. */
export const PET_TARGET_PX = 120;

/**
 * The spot a tap hits, or null. `view` is the canvas view in canvas pixels (`t` per tile, `left` and `top` of the scroll) and
 * `canvasPx` is the canvas width in canvas pixels, so the distance is measured in the CSS pixels the finger covers at any zoom
 * and any device pixel ratio.
 */
export function snapPetTap(click: Point, rect: { left: number; top: number; width: number }, canvasPx: number, view: { t: number; left: number; top: number }, spots: readonly Point[]): Point | null {
  const ratio = canvasPx / rect.width;
  let best: Point | null = null;
  let bestD = PET_TARGET_PX / 2;
  for (const p of spots) {
    const d = Math.hypot(rect.left + ((p.x + 0.5) * view.t - view.left) / ratio - click.x, rect.top + ((p.y + 0.5) * view.t - view.top) / ratio - click.y);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}
