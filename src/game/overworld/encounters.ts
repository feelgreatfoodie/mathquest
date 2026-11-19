import { moduleOfCard } from '../../engine/modules';
import type { Rng } from '../../engine/problems';
import type { Entry } from '../../engine/session';
import { findTiles, isWalkable, tileAt, type Point, type TileMap, type WalkCtx } from './maps';
import { hash, type TripSpot } from './chests';

export type Look = 'slime' | 'bat' | 'ghost' | 'skeleton' | 'boss';

export interface Entity {
  /** The id of the entry it asks. */
  id: string;
  kind: 'monster' | 'chest';
  x: number;
  y: number;
  look: Look;
  cardId: string;
  /** A chest for a new skill: the teach entry to show before the question. */
  teachId?: string;
  /** A chest's spot id (`land:x,y`). Opening it records the id on the trip. */
  spotId?: string;
  /** The land's key chest on this trip. */
  key?: boolean;
  /** Monsters past MAX_VISIBLE wait off the map. */
  shown: boolean;
}

export const MAX_VISIBLE = 6;
/** How far from the hero a monster first appears, in tiles (Manhattan). */
export const SPAWN_MIN = 6;
export const SPAWN_MAX = 15;
export const RETRY_RADIUS = 3;

/** Facts are slimes and bats, multidigit skeletons, fractions ghosts. The same card always looks the same. */
export function lookFor(cardId: string): Look {
  const m = moduleOfCard(cardId)?.id;
  if (m === 'multidigit') return 'skeleton';
  if (m === 'fractions') return 'ghost';
  return hash(cardId) % 2 === 0 ? 'slime' : 'bat';
}

const key = (p: Point) => `${p.x},${p.y}`;
const dist = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
function shuffled<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Fill order for the chests: a new fact first, then a preview, then a fact that needs work, then a riddle. */
export function chestRank(e: Entry, needsWork: ReadonlySet<string>): number {
  if (e.kind === 'graded' && e.isNew && !e.preview) return 0;
  if (e.kind === 'graded' && e.preview) return 1;
  if (e.kind === 'graded' && !e.isNew && needsWork.has(e.cardId)) return 2;
  if (e.kind === 'practice' && e.riddle) return 3;
  return 4;
}

/**
 * Turns the run's entries into things on the map. A graded or practice entry is one entity; a teach entry joins the graded
 * entry after it as a chest. The trip's closed chest spots (`spots` minus `opened`) each take the next entry in fill order
 * (see chestRank), the key chest first. Everything else is a monster on a spawn tile 6 to 15 tiles from the hero (nearest
 * free tiles when that band is too small). Nothing stands on a blocked tile or on another entity. Only the first 6 monsters
 * show; the rest wait.
 */
export function planEntities({
  entries,
  map,
  hero,
  spots,
  opened,
  needsWork,
  rng,
  ctx,
  skip = [],
}: {
  entries: Entry[];
  map: TileMap;
  hero: Point;
  /** The trip's chest spots in this land, key chest first. */
  spots: TripSpot[];
  /** Spot ids already opened on this trip. */
  opened: string[];
  /** Fact ids that need work (insights.ts). */
  needsWork: ReadonlySet<string>;
  rng: Rng;
  ctx: WalkCtx;
  /** Entry ids that already have an entity or are not part of the map (boss questions). */
  skip?: string[];
}): Entity[] {
  const skipped = new Set(skip);
  const taken = new Set<string>([key(hero)]);
  const spawns = shuffled(findTiles(map, 'spawn').filter((p) => isWalkable(map, p.x, p.y, ctx)), rng);
  const out: Entity[] = [];
  const teachFor = new Map<string, string>();
  for (const e of entries) if (e.kind === 'teach') teachFor.set(e.cardId, e.id);
  let shown = 0;

  const closed = spots.filter((s) => !opened.includes(s.id));
  const asked = entries.filter((e) => e.kind !== 'teach' && !skipped.has(e.id));
  const ranked = asked.map((e, i) => ({ e, i, r: chestRank(e, needsWork) })).filter((x) => x.r < 4).sort((a, b) => a.r - b.r || a.i - b.i);
  const chestOf = new Map<string, TripSpot>();
  ranked.slice(0, closed.length).forEach((x, i) => chestOf.set(x.e.id, closed[i]!));

  const free = (p: Point) => !taken.has(key(p));
  for (const e of asked) {
    const spot = chestOf.get(e.id);
    if (spot && free(spot)) {
      taken.add(key(spot));
      const teachId = teachFor.get(e.cardId);
      out.push({ id: e.id, kind: 'chest', x: spot.x, y: spot.y, look: lookFor(e.cardId), cardId: e.cardId, spotId: spot.id, ...(spot.key ? { key: true } : {}), ...(teachId ? { teachId } : {}), shown: true });
      continue;
    }
    const candidates = spawns.filter(free);
    const band = candidates.filter((p) => dist(p, hero) >= SPAWN_MIN && dist(p, hero) <= SPAWN_MAX);
    const pool = band.length ? band : [...candidates].sort((a, b) => Math.abs(dist(a, hero) - SPAWN_MIN) - Math.abs(dist(b, hero) - SPAWN_MIN));
    const p = pool[0] ?? findAnyFree(map, ctx, taken, hero);
    taken.add(key(p));
    out.push({ id: e.id, kind: 'monster', x: p.x, y: p.y, look: lookFor(e.cardId), cardId: e.cardId, shown: shown++ < MAX_VISIBLE });
  }
  return out;
}

/** The last resort: any free grass or path tile, nearest the hero. */
function findAnyFree(map: TileMap, ctx: WalkCtx, taken: Set<string>, hero: Point): Point {
  let best: Point = { x: hero.x + 1, y: hero.y };
  let bestD = Infinity;
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const t = tileAt(map, x, y);
      if ((t !== 'grass' && t !== 'path' && t !== 'spawn') || !isWalkable(map, x, y, ctx) || taken.has(`${x},${y}`)) continue;
      const d = dist({ x, y }, hero);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  return best;
}

/** The monster that missed comes back as a retry within 3 tiles of where it stood, looking the same. */
export function retryEntity({ prev, entry, map, taken, rng, ctx }: { prev: Entity; entry: Entry; map: TileMap; taken: Point[]; rng: Rng; ctx: WalkCtx }): Entity {
  const used = new Set(taken.map(key));
  const options: Point[] = [];
  for (let dy = -RETRY_RADIUS; dy <= RETRY_RADIUS; dy++)
    for (let dx = -RETRY_RADIUS; dx <= RETRY_RADIUS; dx++) {
      const p = { x: prev.x + dx, y: prev.y + dy };
      const t = tileAt(map, p.x, p.y);
      if ((t === 'grass' || t === 'spawn' || t === 'path') && isWalkable(map, p.x, p.y, ctx) && !used.has(key(p))) options.push(p);
    }
  const pick = options.length ? options[Math.floor(rng() * options.length)]! : { x: prev.x, y: prev.y };
  return { id: entry.id, kind: 'monster', x: pick.x, y: pick.y, look: prev.look, cardId: entry.cardId, shown: true };
}
