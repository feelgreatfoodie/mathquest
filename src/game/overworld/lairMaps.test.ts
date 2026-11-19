// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawScene, tileAtlas, type Scene } from './draw';
import { LAIRS, MAPS, REGION_IDS, doorNeed, findTiles, heroStart, isWalkable, roomOf, tileAt, type Point, type WalkCtx } from './maps';
import { findPath } from './pathfind';

const ctx = (roomsCleared: number): WalkCtx => ({ gateOpen: false, hasKey: false, hasBridgeKit: false, roomsCleared });

/** Tiles the hero reaches from the start with `roomsCleared` rooms done. */
function reach(region: (typeof REGION_IDS)[number], roomsCleared: number): Set<string> {
  const map = LAIRS[region].map;
  const s = heroStart(map);
  const seen = new Set([`${s.x},${s.y}`]);
  const queue: Point[] = [s];
  while (queue.length) {
    const p = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const q = { x: p.x + dx, y: p.y + dy };
      if (!seen.has(`${q.x},${q.y}`) && isWalkable(map, q.x, q.y, ctx(roomsCleared))) {
        seen.add(`${q.x},${q.y}`);
        queue.push(q);
      }
    }
  }
  return seen;
}

describe('lair maps', () => {
  it.each(REGION_IDS)('%s: a 24 by 18 rectangle of 3 to 4 rooms, an exit, doors 1..n-1 and one boss in the last room', (region) => {
    const def = LAIRS[region];
    const m = def.map;
    expect(m.lair).toBe(true);
    expect(m.id).toBe(region);
    expect([m.w, m.h]).toEqual([24, 18]);
    expect(m.rows.every((r) => r.length === 24)).toBe(true);
    expect(def.rooms.length).toBeGreaterThanOrEqual(3);
    expect(def.rooms.length).toBeLessThanOrEqual(4);
    expect(findTiles(m, 'exit')).toHaveLength(1);
    expect(findTiles(m, 'start')).toHaveLength(1);
    expect(findTiles(m, 'rdoor').map((p) => doorNeed(m, p.x, p.y)).sort()).toEqual(Array.from({ length: def.rooms.length - 1 }, (_, i) => i + 1));
    const boss = findTiles(m, 'boss');
    expect(boss).toHaveLength(1);
    expect(roomOf(def, boss[0]!.x, boss[0]!.y)).toBe(def.rooms.length - 1);
    expect(roomOf(def, heroStart(m).x, heroStart(m).y)).toBe(0);
    expect(findTiles(m, 'chest').length).toBeGreaterThanOrEqual(3);
  });
  it.each(REGION_IDS)('%s: no camp, gate or overworld door inside a lair', (region) => {
    const m = LAIRS[region].map;
    for (const t of ['camp', 'gate', 'back', 'door', 'span'] as const) expect(findTiles(m, t)).toHaveLength(0);
  });
  it.each(REGION_IDS)('%s: every room, chest, the exit and the boss are reachable with the doors opened in order', (region) => {
    const def = LAIRS[region];
    const m = def.map;
    const last = def.rooms.length - 1;
    // Before any room is cleared only room 0 is walkable, whatever is beyond.
    const none = reach(region, 0);
    for (const p of findTiles(m, 'rdoor')) expect(none.has(`${p.x},${p.y}`)).toBe(false);
    for (let n = 0; n <= last; n++) {
      const seen = reach(region, n);
      // Room n and every room before it is fully reachable (every floor tile), room n+1 is not.
      def.rooms.forEach((r, i) => {
        const corner = { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
        expect(seen.has(`${corner.x},${corner.y}`), `${region} room ${i} with ${n} cleared`).toBe(i <= n);
      });
    }
    const all = reach(region, last);
    for (const c of findTiles(m, 'chest')) expect(all.has(`${c.x},${c.y}`), `chest ${c.x},${c.y}`).toBe(true);
    const x = findTiles(m, 'exit')[0]!;
    expect(all.has(`${x.x},${x.y}`)).toBe(true);
    const b = findTiles(m, 'boss')[0]!;
    expect(isWalkable(m, b.x, b.y, ctx(last))).toBe(false);
    expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => all.has(`${b.x + dx!},${b.y + dy!}`))).toBe(true);
    // Chests and the exit are reachable by a path from the start with the doors opened in order, room by room.
    for (const c of findTiles(m, 'chest')) {
      const room = roomOf(def, c.x, c.y);
      expect(findPath(m, heroStart(m), c, ctx(Math.max(0, room)))).not.toBeNull();
    }
    expect(findPath(m, heroStart(m), x, ctx(0))).not.toBeNull();
  });
  it.each(REGION_IDS)('%s: each room has enough spawn tiles for its share of 24 questions and a chest tile', (region) => {
    const def = LAIRS[region];
    const r = def.rooms.length - 1;
    def.rooms.slice(0, -1).forEach((room, i) => {
      const spawns = findTiles(def.map, 'spawn').filter((p) => roomOf(def, p.x, p.y) === i);
      expect(spawns.length, `${region} room ${i}`).toBeGreaterThanOrEqual(Math.ceil(24 / r) - 2);
      expect(findTiles(def.map, 'chest').some((p) => roomOf(def, p.x, p.y) === i), `${region} room ${i} chest`).toBe(true);
      expect(room.w * room.h).toBeGreaterThan(24);
    });
  });
  it('the walls hold: nothing walkable on the border but the exit, and a door opens exactly at its number', () => {
    for (const region of REGION_IDS) {
      const m = LAIRS[region].map;
      for (let y = 0; y < m.h; y++)
        for (let x = 0; x < m.w; x++) {
          if (x && y && x < m.w - 1 && y < m.h - 1) continue;
          if (isWalkable(m, x, y, ctx(9))) expect(tileAt(m, x, y), `${region} ${x},${y}`).toBe('exit');
        }
      for (const p of findTiles(m, 'rdoor')) {
        const n = doorNeed(m, p.x, p.y);
        expect(isWalkable(m, p.x, p.y, ctx(n - 1))).toBe(false);
        expect(isWalkable(m, p.x, p.y, ctx(n))).toBe(true);
        expect(isWalkable(m, p.x, p.y, { gateOpen: true, hasKey: true, hasBridgeKit: true })).toBe(false);
      }
    }
  });
  it('an overworld map has no exit or room door', () => {
    for (const region of REGION_IDS) {
      expect(findTiles(MAPS[region], 'exit')).toHaveLength(0);
      expect(findTiles(MAPS[region], 'rdoor')).toHaveLength(0);
    }
  });
});

describe('lair drawing', () => {
  afterEach(() => vi.restoreAllMocks());

  function recorder() {
    const fills = new Set<string>();
    const calls: string[] = [];
    const target: Record<string, unknown> = {};
    const g = new Proxy(target, {
      get: (t, k: string) => (k in t ? t[k] : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : (...a: unknown[]) => void calls.push(`${k}:${a.length}`)),
      set: (t, k: string, v) => {
        if (k === 'fillStyle') fills.add(String(v));
        t[k] = v;
        return true;
      },
    });
    return { g: g as unknown as CanvasRenderingContext2D, fills, calls };
  }

  it.each(REGION_IDS)('%s: the atlas paints the exit and the room door, and a scene draws with doors shut and open', (region) => {
    const atlas = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(atlas.g as never);
    tileAtlas(region);
    // The room door's plank colour and the exit's sill both reach the atlas.
    expect(atlas.fills.has('#8a5a2b')).toBe(true);
    expect(atlas.fills.has('#fbbf24')).toBe(true);
    const map = LAIRS[region].map;
    const hero = heroStart(map);
    for (const roomsCleared of [0, 3]) {
      const out = recorder();
      const scene = { map, hero: { x: hero.x, y: hero.y, facing: 'right', frame: 0 }, heroSprite: 'knight', entities: [], gateOpen: false, campLit: true, bossDefeated: false, hasKey: false, hasBridgeKit: false, openedChests: [], lantern: false, time: 1, marker: null, roomsCleared } as unknown as Scene;
      drawScene(out.g, 480, 360, 3, scene);
      // 1 background fill + every visible tile is one drawImage from the atlas.
      expect(out.calls.filter((c) => c.startsWith('drawImage')).length).toBeGreaterThan(100);
    }
  });
});
