import { isWalkable, type Point, type TileMap, type WalkCtx } from './maps';

const DIRS: readonly Point[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const key = (p: Point) => p.y * 1000 + p.x;

/**
 * A* on the tile grid, four directions, every step costing 1, Manhattan distance as the guess. The path lists each step
 * after `from` and ends on `to`. It is null when `to` is not a tile the hero can stand on or cannot be reached; it never
 * steps on water, a tree, a rock, a closed gate, a door without the key or a span without the bridge kit.
 */
export function findPath(map: TileMap, from: Point, to: Point, ctx: WalkCtx): Point[] | null {
  if (!isWalkable(map, to.x, to.y, ctx)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const h = (p: Point) => Math.abs(p.x - to.x) + Math.abs(p.y - to.y);
  const g = new Map<number, number>([[key(from), 0]]);
  const came = new Map<number, Point>();
  const open: Point[] = [from];
  const f = (p: Point) => (g.get(key(p)) ?? Infinity) + h(p);
  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (f(open[i]!) < f(open[best]!)) best = i;
    const cur = open.splice(best, 1)[0]!;
    if (cur.x === to.x && cur.y === to.y) {
      const out: Point[] = [];
      for (let p: Point | undefined = cur; p && key(p) !== key(from); p = came.get(key(p))) out.unshift(p);
      return out;
    }
    const gc = g.get(key(cur))!;
    for (const d of DIRS) {
      const n = { x: cur.x + d.x, y: cur.y + d.y };
      if (!isWalkable(map, n.x, n.y, ctx)) continue;
      const ng = gc + 1;
      if (ng >= (g.get(key(n)) ?? Infinity)) continue;
      g.set(key(n), ng);
      came.set(key(n), cur);
      if (!open.some((o) => key(o) === key(n))) open.push(n);
    }
  }
  return null;
}

/**
 * A path to `to`, or, when `to` is a tile nobody can stand on (the boss lair door, a closed gate), the shortest path to a
 * tile next to it. Null when neither can be reached.
 */
export function approach(map: TileMap, from: Point, to: Point, ctx: WalkCtx): Point[] | null {
  if (isWalkable(map, to.x, to.y, ctx)) return findPath(map, from, to, ctx);
  let best: Point[] | null = null;
  for (const d of DIRS) {
    const p = findPath(map, from, { x: to.x + d.x, y: to.y + d.y }, ctx);
    if (p && (!best || p.length < best.length)) best = p;
  }
  return best;
}
