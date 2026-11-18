// The three tile maps and how a tile behaves. Every map is a 40 by 30 text grid. Original layouts: drawn by a script, then
// checked by tests (every chest, the camp and the boss lair can be reached from the start with every gate open).
//
// Legend: . grass   , path   T tree   ~ water   # rock   = bridge   G gate to the next region   g gate back
//         C chest spot   s spawn zone (grass where monsters appear)   B boss lair door   H camp   @ hero start
//         D door (needs the key item)   b span (needs the bridge kit item)

export type RegionId = 'meadow' | 'forest' | 'castle';
export const REGION_IDS: readonly RegionId[] = ['meadow', 'forest', 'castle'];

export type Tile = 'grass' | 'path' | 'tree' | 'water' | 'rock' | 'bridge' | 'gate' | 'back' | 'chest' | 'spawn' | 'boss' | 'camp' | 'start' | 'door' | 'span';

const LEGEND: Record<string, Tile> = {
  '.': 'grass', ',': 'path', T: 'tree', '~': 'water', '#': 'rock', '=': 'bridge', G: 'gate', g: 'back',
  C: 'chest', s: 'spawn', B: 'boss', H: 'camp', '@': 'start', D: 'door', b: 'span',
};

export interface Point {
  x: number;
  y: number;
}

export interface TileMap {
  id: RegionId;
  w: number;
  h: number;
  rows: string[];
}

/** What changes where the hero can walk: the gate to the next region, the key item and the bridge kit item. */
export interface WalkCtx {
  gateOpen: boolean;
  hasKey: boolean;
  hasBridgeKit: boolean;
}

const ROWS: Record<RegionId, string[]> = {
  meadow: [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'T.ss........................~~########.T',
    'Tssss...T.........T......T..~~########.T',
    'Tsssss.....T................~~########.T',
    'Tsssss.ss...........T.....T.~~###B####.T',
    'T#sssss##s.......C.......T..~~...,,....T',
    'Tssssssssss......T.....#....~~...,,....T',
    'Tsssssssss#.........C.......~~...,,..C.T',
    'T.ssssHHs...................~~...,,....T',
    'TT..ss,,......s........C....~~...,,....T',
    'T...Ts,,C.s..sss......T.T...~~T..,,....T',
    'T.....,,sssssssss...........~~...,,....T',
    'T.....,,ss#sssCs............~~..T,,....T',
    'T.....,,ssCssssssT..T......C~~...,,#...T',
    'T..@,,,,,,,,,,,,,,,,,,,,,,,,==,,,,,,,,,G',
    'T..,,,,,,,,,,,,,,,,,,,,,,,,,==,,,,,,,,,G',
    'T............T..............~~.........T',
    'T.......s....sT.............~~...T.....T',
    'T......sss..sss.............~~.........T',
    'T.....ssssssssss...........T~~.........T',
    'T....sTsss..ss~~~~..#.T.....~~.........T',
    'T...sssss....s~bb~..#.T.....~~#..C.....T',
    'T..C.sss......~~~~.T#..T....~~........#T',
    'T.T.ssT.s.....~~~~..D.T.....~~..T#.....T',
    'T..sssTsss..........#.......~~.........T',
    'T.sssssssss.........#.......~~.........T',
    'TsssssCsss........C.#.......~~.......T.T',
    'Tssss..Ts.T.................~~.........T',
    'Tsss...#.TT.................~~.........T',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  forest: [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTT.....s.T..T....T........~~.########.T',
    'T......sss..#...T.....TT..T~~.########.T',
    'T.T#..sssss.T..T.......T...~~.########.T',
    'TT.T.T.sss.TC.T....TT....T.~~.###B####TT',
    'T.ssCsT.sssT.#........TT...~~....,,....T',
    'TTsssTssssss........T.....T~~....,,..CTT',
    'TTsssssssssss..#...T.....C.~~....,,....T',
    'T..ssTHHTssT..TC.T......T..~~....,,..T.T',
    'T.T..T,,..ss...T....T.T....~~....,,....T',
    'T.C...,,s.sss..............~~..T.,,..T.T',
    'T....s,,ssssss.....T.......~~T...,,....T',
    'T.....,,ssssss.T..T.......T~~T.T.,,.TT.T',
    'T.....,,ss.s#ss...s.T......~~.TT.,,...TT',
    'g..@,,,,,,,,,,,,,,,,,,,,,,,==,,,,,,,,,,G',
    'g..,,,,,,,,,,,,,,,,,,,,,,,,==,,,,,,,,,,G',
    'T.....sssss#ssT..sss.T....T~~..T...T...T',
    'T....ssssssss#ss..s...TTT..~~....T.....T',
    'T.T.sTssTTsssssss......#T..~~C.........T',
    'T.TTss.ssTs..sss...T..T..C.~~...TC.....T',
    'T#TTsssTsTss..~~~~.T#.T....~~........T.T',
    'T.TssssssssTs.~bb~.T#......~~.........TT',
    'TsCssssCssssT.~~~~..#......~~..........T',
    'TsTsTss#..s...~~~~..D......~~.T...T....T',
    'TTss..T............T#....T.~~.......T.TT',
    'TsT#.TT..TTT........#.#..T.~~.T......#TT',
    'TsssT......T........#......~~T....T....T',
    'Tsss..................#T...~~.#......C.T',
    'T.s.T.#..........T.....T...~~T..#T.....T',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  castle: [
    '########################################',
    '#..T....s............#.....~~.########.#',
    '#......ssT...#.......C.....~~.########.#',
    '#.....TssT#................~~.########.#',
    '#..T.##sssT....#...#...T...~~.###B####.#',
    '#..s..sssss..T#C...........~~....,,....#',
    '#.sssssssTTs....#.....#....~~....,,....#',
    '##sssss#sss#....#......T...~~#C..,,...##',
    '#.ssssHHssss.T.....#..#...T~~#...,,....#',
    '#T.T..,,sssss..............~~....,,....#',
    '#.....,,ssssss..C..........~~..#.,,.#C.#',
    '#.....,,ssTssss.#s.........~~....,,..#.#',
    '#.....,,..#s#T#sss#........~~....,,....#',
    '#.....,,...ssssss#ss.......~~....,,T...#',
    'g..@,,,,,,,,,,,,,,,,,,,,,,,==,,,,,,,,,,,',
    'g..,,,,,,,,,,,,,,,,,,,,,,,,==,,,,,,,,,,#',
    '#......s...s.ss#Ts.........~~...T.C....#',
    '#.....sss.sss.sss..........~~......#...#',
    '##T#ss#sssssss.s...........~~.C.#.....##',
    '#..sCssss.sss..........#...~~........C.#',
    '#TTsssss#.sss.~~~~..#...#..~~........#.#',
    '#..#sTss.#ssss~bb~..#...T.T~~..........#',
    '#...s.s...sss.~~~~..#.T.#..~~.......#..#',
    '#..#ss#s.#.sT.~~~~..D.T....~~#....C#.#.#',
    '##ssss#ss...........#.C...#~~........#.#',
    '#..sssCsTs.....T...##..T...~~...#.....##',
    '#...s.sss...........#......~~..#.......#',
    '#......s...................~~..#T....T.#',
    '#...T.T.................#..~~.........##',
    '########################################',
  ],

};

function make(id: RegionId): TileMap {
  const rows = ROWS[id];
  return { id, w: rows[0]!.length, h: rows.length, rows };
}

export const MAPS: Record<RegionId, TileMap> = { meadow: make('meadow'), forest: make('forest'), castle: make('castle') };

/** The tile at a position. Past the edge reads as rock, so nothing walks off the map. */
export function tileAt(map: TileMap, x: number, y: number): Tile {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= map.w || y >= map.h) return 'rock';
  return LEGEND[map.rows[y]![x]!] ?? 'rock';
}

export function findTiles(map: TileMap, tile: Tile): Point[] {
  const out: Point[] = [];
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (tileAt(map, x, y) === tile) out.push({ x, y });
  return out;
}

export function heroStart(map: TileMap): Point {
  return findTiles(map, 'start')[0] ?? { x: 2, y: 2 };
}

/** True when the hero can stand on the tile. The boss lair and a closed gate never can; the hero walks up to them. */
export function isWalkable(map: TileMap, x: number, y: number, ctx: WalkCtx): boolean {
  switch (tileAt(map, x, y)) {
    case 'grass': case 'path': case 'bridge': case 'chest': case 'spawn': case 'camp': case 'start': case 'back':
      return true;
    case 'gate':
      return ctx.gateOpen;
    case 'door':
      return ctx.hasKey;
    case 'span':
      return ctx.hasBridgeKit;
    default:
      return false;
  }
}
