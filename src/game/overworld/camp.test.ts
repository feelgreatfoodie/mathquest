import { describe, expect, it } from 'vitest';
import { MAX_FLAGS, MAX_PLACED, campReducer, canPlaceAt, flagsIn, fromCampDoc, newCamp, placeBlock, sortPlaced, tentOf, toCampDoc, type Placed } from './camp';
import { LAIRS, MAPS, REGION_IDS, findTiles, tileAt, type Point, type RegionId } from './maps';

// The camp: a tent and up to 3 flags per land, saved in world/camp. The load filter drops what cannot stand where it was saved.
const flag = (region: RegionId, x: number, y: number): Placed => ({ region, kind: 'flag', x, y });
const tent = (region: RegionId, x: number, y: number): Placed => ({ region, kind: 'tent', x, y });
const docOf = (placed: unknown[]) => ({ placed, version: 1, updatedAt: 5 });

/** Open grass tiles of a land, in reading order. */
const grass = (r: RegionId): Point[] => {
  const out: Point[] = [];
  for (let y = 0; y < MAPS[r].h; y++) for (let x = 0; x < MAPS[r].w; x++) if (canPlaceAt(MAPS[r], x, y)) out.push({ x, y });
  return out;
};

describe('where decor may stand', () => {
  it('every land has room for the 3 flags and the tent', () => {
    for (const r of REGION_IDS) expect(grass(r).length, r).toBeGreaterThan(40);
  });
  it('allows only plain grass with no door, gate, chest, camp, start or crossing within one tile', () => {
    for (const r of REGION_IDS) {
      const map = MAPS[r];
      for (const p of grass(r)) {
        expect(tileAt(map, p.x, p.y)).toBe('grass');
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) expect(['gate', 'back', 'door', 'span', 'bridge', 'boss', 'camp', 'start', 'chest', 'exit', 'rdoor']).not.toContain(tileAt(map, p.x + dx, p.y + dy));
      }
    }
  });
  it('refuses a path, a spawn tile, water, a tree, the boss door, a gate and the camp fire', () => {
    for (const r of REGION_IDS) {
      const map = MAPS[r];
      for (const t of ['path', 'spawn', 'water', 'tree', 'boss', 'gate', 'back', 'camp', 'start', 'chest'] as const)
        for (const p of findTiles(map, t).slice(0, 12)) expect(canPlaceAt(map, p.x, p.y), `${r} ${t} ${p.x},${p.y}`).toBe(false);
    }
  });
  it('refuses every tile of a lair, so a lair exit and its rooms stay clear', () => {
    for (const r of REGION_IDS) {
      const map = LAIRS[r].map;
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) expect(canPlaceAt(map, x, y)).toBe(false);
    }
  });
  it('refuses a tile outside the map and a fraction', () => {
    const m = MAPS.meadow;
    expect(canPlaceAt(m, -1, 3)).toBe(false);
    expect(canPlaceAt(m, 3, 30)).toBe(false);
    expect(canPlaceAt(m, 40, 3)).toBe(false);
    expect(canPlaceAt(m, 3.5, 3)).toBe(false);
    expect(canPlaceAt(m, NaN, 3)).toBe(false);
  });
});

describe('placing', () => {
  const g = grass('meadow');
  it('a 4th flag in one land is refused, a flag in another land is not', () => {
    let c = newCamp(1);
    for (let i = 0; i < 3; i++) c = campReducer(c, { t: 'place', item: flag('meadow', g[i * 5]!.x, g[i * 5]!.y) }, 2);
    expect(flagsIn(c.placed, 'meadow')).toBe(MAX_FLAGS);
    expect(placeBlock(c.placed, flag('meadow', g[20]!.x, g[20]!.y))).toBe('flags');
    expect(campReducer(c, { t: 'place', item: flag('meadow', g[20]!.x, g[20]!.y) }, 3)).toBe(c);
    const f = grass('forest')[0]!;
    expect(campReducer(c, { t: 'place', item: flag('forest', f.x, f.y) }, 3).placed).toHaveLength(4);
  });
  it('a second tent moves the first, so there is only ever 1 tent', () => {
    let c = campReducer(newCamp(1), { t: 'place', item: tent('meadow', g[0]!.x, g[0]!.y) }, 2);
    c = campReducer(c, { t: 'place', item: tent('forest', grass('forest')[0]!.x, grass('forest')[0]!.y) }, 3);
    expect(c.placed.filter((p) => p.kind === 'tent')).toHaveLength(1);
    expect(tentOf(c.placed)!.region).toBe('forest');
  });
  it('one item per tile, and removing frees the tile', () => {
    let c = campReducer(newCamp(1), { t: 'place', item: flag('meadow', g[0]!.x, g[0]!.y) }, 2);
    expect(placeBlock(c.placed, tent('meadow', g[0]!.x, g[0]!.y))).toBe('taken');
    c = campReducer(c, { t: 'remove', region: 'meadow', x: g[0]!.x, y: g[0]!.y }, 3);
    expect(c.placed).toEqual([]);
  });
  it('the saved list is in the order the rules require: the tent first, then flags by region name', () => {
    const c = sortPlaced([flag('meadow', 1, 1), flag('castle', 2, 2), tent('meadow', 3, 3), flag('forest', 4, 4)]);
    expect(c.map((p) => p.kind + ':' + p.region)).toEqual(['tent:meadow', 'flag:castle', 'flag:forest', 'flag:meadow']);
    expect(toCampDoc({ ...newCamp(1), placed: [flag('meadow', 1, 1), tent('castle', 2, 2)] }).placed[0]!.kind).toBe('tent');
  });
  it('a full camp (1 tent and 3 flags in each land) is MAX_PLACED entries', () => {
    expect(MAX_PLACED).toBe(10);
  });
});

describe('fromCampDoc: the load-time walkability filter', () => {
  const m = grass('meadow');
  const good = [flag('meadow', m[0]!.x, m[0]!.y), flag('meadow', m[9]!.x, m[9]!.y), tent('meadow', m[20]!.x, m[20]!.y)];
  const pathTile = findTiles(MAPS.meadow, 'path')[0]!;
  const treeTile = findTiles(MAPS.meadow, 'tree')[0]!;
  const bossDoor = findTiles(MAPS.meadow, 'boss')[0]!;
  const gate = findTiles(MAPS.meadow, 'gate')[0]!;
  const nextToGate = { x: gate.x - 1, y: gate.y };

  it('keeps good entries', () => {
    const c = fromCampDoc(docOf(good), 1);
    expect(c.placed).toHaveLength(3);
    expect(c.updatedAt).toBe(5);
    expect(c.placed.every((p) => good.some((q) => q.x === p.x && q.y === p.y && q.kind === p.kind))).toBe(true);
  });
  it('drops out-of-bounds, fractional, non-number and unknown entries and keeps the good ones', () => {
    const bad = [flag('meadow', -1, 3), flag('meadow', 3, 99), flag('meadow', 40, 3), { region: 'meadow', kind: 'flag', x: 2.5, y: 3 }, { region: 'meadow', kind: 'flag', x: '3', y: 3 }, { region: 'moon', kind: 'flag', x: 3, y: 3 }, { region: 'meadow', kind: 'banner', x: 3, y: 3 }, null, 'flag', 7];
    const c = fromCampDoc(docOf([...bad, ...good]), 1);
    expect(c.placed).toHaveLength(3);
  });
  it('drops entries on a tile that is not walkable (tree, water, rock) or not plain grass (path, boss door, gate and the tiles beside it)', () => {
    const water = findTiles(MAPS.meadow, 'water')[0]!;
    const rock = findTiles(MAPS.meadow, 'rock')[0]!;
    const bad = [flag('meadow', treeTile.x, treeTile.y), flag('meadow', water.x, water.y), flag('meadow', rock.x, rock.y), flag('meadow', pathTile.x, pathTile.y), flag('meadow', bossDoor.x, bossDoor.y), flag('meadow', gate.x, gate.y), flag('meadow', nextToGate.x, nextToGate.y)];
    expect(fromCampDoc(docOf(bad), 1).placed).toEqual([]);
    expect(fromCampDoc(docOf([...bad, ...good]), 1).placed).toHaveLength(3);
  });
  it('drops a tile that was right in another land (the same x,y read in the land named)', () => {
    const f = grass('forest');
    const onlyForest = f.find((p) => !canPlaceAt(MAPS.meadow, p.x, p.y))!;
    expect(fromCampDoc(docOf([flag('meadow', onlyForest.x, onlyForest.y)]), 1).placed).toEqual([]);
    expect(fromCampDoc(docOf([flag('forest', onlyForest.x, onlyForest.y)]), 1).placed).toHaveLength(1);
  });
  it('drops a duplicate tile, a 2nd tent and a 4th flag in a land', () => {
    const f = [0, 4, 8, 12].map((i) => flag('meadow', m[i]!.x, m[i]!.y));
    expect(fromCampDoc(docOf(f), 1).placed.filter((p) => p.kind === 'flag')).toHaveLength(3);
    expect(fromCampDoc(docOf([...good, tent('meadow', m[30]!.x, m[30]!.y)]), 1).placed.filter((p) => p.kind === 'tent')).toHaveLength(1);
    expect(fromCampDoc(docOf([good[0], good[0]]), 1).placed).toHaveLength(1);
  });
  it('reads damaged data as an empty camp', () => {
    for (const raw of [null, undefined, 5, 'x', [], {}, { placed: 'x' }, { placed: {} }]) expect(fromCampDoc(raw, 7).placed, String(raw)).toEqual([]);
    expect(fromCampDoc({ placed: 5, updatedAt: 9 }, 7).updatedAt).toBe(9);
    expect(fromCampDoc(null, 7).updatedAt).toBe(7);
  });
  it('never returns more than the rules take: at most 10 entries, 1 tent, 3 flags a land', () => {
    const many = REGION_IDS.flatMap((r) => grass(r).slice(0, 12).map((p, i) => (i === 0 ? tent(r, p.x, p.y) : flag(r, p.x, p.y))));
    const c = fromCampDoc(docOf(many), 1);
    expect(c.placed.length).toBeLessThanOrEqual(MAX_PLACED);
    expect(c.placed.filter((p) => p.kind === 'tent')).toHaveLength(1);
    for (const r of REGION_IDS) expect(flagsIn(c.placed, r)).toBeLessThanOrEqual(3);
  });
});
