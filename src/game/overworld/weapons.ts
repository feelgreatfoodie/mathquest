import { isWalkable, tileAt, type Point, type TileMap, type WalkCtx } from './maps';
import type { Entity } from './encounters';
import { snapPetTap } from './pets';

// Item powers, weapons PR. PDR rule 1: a weapon never touches a question, an answer, timing or grading. It only starts a fight the
// kid could have walked to, so it saves walking and never a question. Nothing here reads the session. A weapon works only while it
// is owned and equipped.

export type WeaponKind = 'bow' | 'boomerang';
const WEAPON_OF: Record<string, WeaponKind> = { 'w-bow': 'bow', 'w-boomerang': 'boomerang' };

/** The weapon whose power is on: the equipped one, and only while the kid owns it. */
export function activeWeapon(equipped: string | undefined, owned: readonly string[]): WeaponKind | null {
  return equipped && owned.includes(equipped) ? WEAPON_OF[equipped] ?? null : null;
}

const dist = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// ---- Bow: tap a monster up to 3 tiles away ----

/** The Bow reaches this many tiles (walking distance: columns plus rows). */
export const BOW_RANGE = 3;
/** The Boomerang finds a monster this many tiles from the hero. */
export const BOOMERANG_RANGE = 3;

/** Tiles an arrow or a boomerang cannot cross. Water, trees and rocks do not stop them. */
function blocksFlight(map: TileMap, p: Point): boolean {
  const t = tileAt(map, p.x, p.y);
  return t === 'wall' || t === 'door' || t === 'rdoor';
}

/** True when no wall or door stands between two tiles (a straight line, the end tiles excluded). */
export function clearShot(map: TileMap, a: Point, b: Point): boolean {
  const n = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  for (let i = 1; i < n; i++) {
    const p = { x: Math.round(a.x + ((b.x - a.x) * i) / n), y: Math.round(a.y + ((b.y - a.y) * i) / n) };
    if (blocksFlight(map, p)) return false;
  }
  return true;
}

/** Monsters (never chests) on the map that the hero could hit from `hero` within `range` tiles. */
export function monstersInRange(entities: readonly Entity[], hero: Point, map: TileMap, range: number): Entity[] {
  return entities.filter((e) => e.kind === 'monster' && e.shown && dist(e, hero) <= range && dist(e, hero) > 0 && clearShot(map, hero, e));
}

/**
 * The monster a Bow tap hits, or null. The tap is a 120 px target around each monster in range (see `snapPetTap`), so a pre-reader's
 * finger lands without aiming. A monster farther than the range is never a target: the tap walks, as without a Bow.
 */
export function bowTarget(
  click: Point,
  rect: { left: number; top: number; width: number },
  canvasPx: number,
  view: { t: number; left: number; top: number },
  entities: readonly Entity[],
  hero: Point,
  map: TileMap,
): Entity | null {
  const inRange = monstersInRange(entities, hero, map, BOW_RANGE);
  const hit = snapPetTap(click, rect, canvasPx, view, inRange);
  return hit ? inRange.find((e) => e.x === hit.x && e.y === hit.y) ?? null : null;
}

// ---- Boomerang: a 5-answer streak arms it, the next right answer throws it ----

export const BOOMERANG_STREAK = 5;

/**
 * The Boomerang's state after a graded answer. A streak that reaches a multiple of 5 arms it. The next right answer throws it, and
 * a throw disarms it, so another throw needs another 5 in a row. A wrong answer disarms it. `combo` is the run's streak after the
 * answer, as the session reports it.
 */
export function boomerangStep(armed: boolean, correct: boolean, combo: number): { armed: boolean; throws: boolean } {
  if (!correct) return { armed: false, throws: false };
  if (armed) return { armed: false, throws: true };
  return { armed: combo > 0 && combo % BOOMERANG_STREAK === 0, throws: false };
}

/** The monster the Boomerang clears: the nearest one in range (ties by position, so it is the same on every render), or null. */
export function boomerangTarget(entities: readonly Entity[], hero: Point, map: TileMap, ctx: WalkCtx): Entity | null {
  const near = monstersInRange(entities, hero, map, BOOMERANG_RANGE).filter((e) => isWalkable(map, e.x, e.y, ctx));
  return near.sort((a, b) => dist(a, hero) - dist(b, hero) || a.y - b.y || a.x - b.x)[0] ?? null;
}

/** A shot in flight: what flies, from where to where, and until when (ms on the performance clock), then the fight starts. */
export interface Shot {
  kind: 'arrow' | 'boomerang';
  from: Point;
  to: Point;
  start: number;
  until: number;
  entityId: string;
}
export const SHOT_MS = 450;
