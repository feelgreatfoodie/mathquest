// The three tile maps and how a tile behaves. Every map is a 40 by 30 text grid. Original layouts: drawn by a script, then
// checked by tests (every chest, the camp and the boss lair can be reached from the start with every gate open).
//
// Legend: . grass   , path   T tree   ~ water   # rock   = bridge   G gate to the next region   g gate back
//         C chest spot   s spawn zone (grass where monsters appear)   B boss lair door   H camp   @ hero start
//         D door (needs the key item)   b span (needs the bridge kit item)   W castle wall   i wall torch
//         The same characters look different per region (see draw.ts): the Forest paints grass as moss and ~ as a stream,
//         the Castle paints . as stone floor, ~ as a moat and = as a drawbridge.

export type RegionId = 'meadow' | 'forest' | 'castle';
export const REGION_IDS: readonly RegionId[] = ['meadow', 'forest', 'castle'];

export type Tile = 'grass' | 'path' | 'tree' | 'water' | 'rock' | 'bridge' | 'gate' | 'back' | 'chest' | 'spawn' | 'boss' | 'camp' | 'start' | 'door' | 'span' | 'wall' | 'torch';

const LEGEND: Record<string, Tile> = {
  '.': 'grass', ',': 'path', T: 'tree', '~': 'water', '#': 'rock', '=': 'bridge', G: 'gate', g: 'back',
  C: 'chest', s: 'spawn', B: 'boss', H: 'camp', '@': 'start', D: 'door', b: 'span', W: 'wall', i: 'torch',
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
    'TTTTTTTTTTTTT.TTTTTT~TTT..TTTT#########T',
    'TTTTTTT..TCT.....TTT~~T......T#########T',
    'TTTTTTTTsssT.........~.sss....#########T',
    'TTTTTTTsssss.........~~ssss...####B####T',
    'TTTTTTTssCss.....TTT..~sCss....T..,..TTT',
    'TTT....sssss.sss.TTT..~ssss...TT.....TTT',
    'TTTTTTT.sss.sssssTT...~sssTsss.TTTT.TTTT',
    'TT..TTT.....ssCss.....~..Tsssss.TTTsssTT',
    'TTTTTTT.....sssss.,,,=~..TssCss..CsssssT',
    'TTTTT.......Tsss.,,,,=,,.Tsssss...ssCssT',
    'TTTTT.HH...TTTT.,,..~~,,,.TsssT.T.sssssT',
    'TTTTT......TTTT,,..~~T..,,...TTTT..sssTT',
    'TTTTTTTTT..TTT,,...~.TTTT,...TTTT...TTTT',
    'g,,@TTTTT...C,,...~~.TTTT.,.TTTTT...,,,G',
    'g,,,,,TTT...,,...~~.......,,TTTTT.,,,,,G',
    'TTTT,,,TTT.,,s...~T........,,TTTT,,,...T',
    'TTTsss,,,T,,sss.~~TTT......s,,,,,,C...TT',
    'TTsssss,,,,sCss.~TTTTCT...sss,,,,TTT.TTT',
    'TTssCssTT,sssss.~....TTT..ssCss.TTTTTTTT',
    'TTsssssT.T.sssT.~.....T...sssss..TT..TTT',
    'TTTsss.~~~~~~.T.~..........sss........TT',
    'TT...T.~~bb~~...~~.....sss......sss....T',
    'TT...T.~~~~~~....~TT..sssss....sssss...T',
    'TT..sss~~~~~~.sss~~T..ssCss....ssCss..TT',
    'TT.sssssTT...sssss~...sssssTTTTsssss.TTT',
    'T..ssCssTTT..ssCss~~...sssTTTTTTsss.TTTT',
    'T..sssssTTTTTsssss.~~....TTTTTTTTTTTTTTT',
    'TT.TsssTTTTTTTsssTTT~.TTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  castle: [
    'WiWWWiWWWiWWWiWWWiWWWiWWWiWWWWWWWWWWWWWW',
    'W.....~~....................##########.W',
    'Wsssss~~..sssssssssssssss...##########.W',
    'WssssC~~..ssWsssWsssWssss...##########.W',
    'Wsssss~~..sCsssssssssssCs...####B#####.W',
    'Wsssss~~..sssssssssssssss.W.ssss,,sssssW',
    'Wsssss~~..ssWsssssssWssss.W.ssss,,sssssW',
    'W.....~~..ssssssssCssssss.W.ssss,,ssCssW',
    'W.....~~..................W.sCss,,sssssW',
    'W.HH..~~.iWWWiWW..WWWiWWW.W.ssss,,sssssW',
    'W.....~~..................W.ssss,,sssssW',
    'W.....~~..sssssssssssssss.W.ssss,,sssssW',
    'WC....~~..CssssssssssssCs...ssss,,CssssW',
    'W.....~~......W.......W.....ssss,,sssssW',
    'g,,@,,==,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,G',
    'g,,,,,==,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,G',
    'W.....~~..ssssWsssssssWss...sssssssssssW',
    'W.....~~..Cssssssssssssss.W.ssWsssssWCsW',
    'Wsssss~~..sssssssssssssss.W.sssssssssssW',
    'Wsssss~~.iWW..WWWiWWWiWWW.W..WWWDiWWW..W',
    'WssCss~~..................W..W......W..W',
    'Wsssss~~..sCsssssssssssss.W..W......W..W',
    'Wsssss~~..ssWsssWsssWssss.W..W......W..W',
    'Wsssss~~..ssssssssssssCss.W..W......W..W',
    'Wsssss~~..sssssssssssssss.W..iWWWiWWW..W',
    'WCssss~~..sssssssssssssss..............W',
    'Wsssss~~..ssWsssssssWsssC...sssssssssssW',
    'W.....~~..ssssssCssssssss...ssCssssssssW',
    'W.....~~...............................W',
    'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
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
