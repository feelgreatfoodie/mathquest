import { ITEM_SPRITES } from '../../ui/itemSprites';
import { SPRITES } from '../../ui/sprites';
import type { Placed } from './camp';
import type { Entity } from './encounters';
import { doorNeed, tileAt, type Point, type RegionId, type Tile, type TileMap } from './maps';
import type { Facing } from './worldState';

// Canvas 2D drawing for the Overworld. Every tile and sprite is original and made in code: 12 by 12 pixel tiles painted
// once into an atlas, sprites read from the same pixel tables the rest of the app uses. Scaling is nearest-neighbour.

export const TILE = 12;
const VARIANTS = 3;
const ORDER: Tile[] = ['grass', 'path', 'tree', 'water', 'rock', 'bridge', 'gate', 'back', 'chest', 'spawn', 'boss', 'camp', 'start', 'door', 'span', 'wall', 'torch', 'exit', 'rdoor', 'vault'];

type G = CanvasRenderingContext2D;
const px = (g: G, c: string, x: number, y: number, w = 1, h = 1) => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};
const noise = (v: number, i: number) => ((v * 31 + i * 17 + (v + 3) * (i + 5)) % 12);

function grass(g: G, v: number, base = '#4a9a45') {
  px(g, base, 0, 0, 12, 12);
  for (let i = 0; i < 5; i++) px(g, i % 2 ? '#5dbb55' : '#3d8239', noise(v, i), noise(v, i + 7), 1, 1);
}

/** Forest ground: dark moss with leaf litter. */
function moss(g: G, v: number, base = '#2c5a35') {
  px(g, base, 0, 0, 12, 12);
  for (let i = 0; i < 6; i++) px(g, i % 3 === 0 ? '#3f7a45' : i % 3 === 1 ? '#1f4326' : '#6b5a2e', noise(v, i), noise(v, i + 7), 1, 1);
}

/** Castle ground: grey flagstones with dark joints, each variant cut a little differently. */
function flagstone(g: G, v: number, base = '#8a90a2', tint = '#7b8194') {
  px(g, base, 0, 0, 12, 12);
  px(g, tint, 0, 0, 6, 6);
  px(g, tint, 6, 6, 6, 6);
  px(g, '#5d6376', 0, 6, 12, 1);
  px(g, '#5d6376', 6, 0, 1, 6);
  px(g, '#5d6376', 0 + (v % 3) * 2, 6, 1, 6);
  px(g, '#a6acbd', noise(v, 1), noise(v, 2), 2, 1);
}

function paintForest(g: G, tile: Tile, v: number): boolean {
  switch (tile) {
    case 'grass':
    case 'chest':
    case 'vault':
      moss(g, v);
      return true;
    case 'spawn':
      moss(g, v, '#26502f');
      px(g, '#4f9a58', noise(v, 1), noise(v, 2), 1, 2);
      px(g, '#c084fc', noise(v, 3), noise(v, 4), 1, 1);
      return true;
    case 'path':
    case 'start':
      px(g, '#7a5a34', 0, 0, 12, 12);
      for (let i = 0; i < 4; i++) px(g, '#5e4426', noise(v, i), noise(v, i + 5), 2, 1);
      px(g, '#9a7a4a', noise(v, 9), noise(v, 8), 1, 1);
      px(g, '#3f7a45', noise(v, 4), noise(v, 6), 1, 1);
      return true;
    case 'tree':
      moss(g, v);
      px(g, '#4a2f17', 5, 8, 2, 4);
      px(g, '#0f3d22', 1, 1, 10, 9);
      px(g, '#165a30', 2, 0, 8, 3);
      px(g, '#0a2c18', 1, 7, 10, 3);
      px(g, '#2a7a44', 3, 2, 3, 2);
      px(g, '#2a7a44', 7 - (v % 2), 5, 2, 2);
      return true;
    case 'water':
      px(g, '#2a7f9e', 0, 0, 12, 12);
      px(g, '#1e6482', 0, 0, 12, 2);
      for (let i = 0; i < 3; i++) px(g, '#8fd3e8', (noise(v, i) + i * 4) % 10, 2 + i * 4, 2, 1);
      return true;
    case 'bridge':
      px(g, '#2a7f9e', 0, 0, 12, 12);
      px(g, '#7a5a34', 0, 1, 12, 10);
      for (let x = 1; x < 12; x += 3) px(g, '#4a2f17', x, 1, 1, 10);
      px(g, '#3f7a45', 0, 1, 12, 1);
      return true;
    case 'rock':
      px(g, '#4b5563', 0, 0, 12, 12);
      px(g, '#69737f', 1, 1, 10, 9);
      px(g, '#3f7a45', 2, 2, 5, 2);
      px(g, '#2f3641', 1, 10, 10, 1);
      return true;
    default:
      return false;
  }
}

function paintCastle(g: G, tile: Tile, v: number): boolean {
  switch (tile) {
    case 'grass':
    case 'chest':
    case 'vault':
      flagstone(g, v);
      return true;
    case 'spawn':
      flagstone(g, v, '#7f8699', '#70778b');
      px(g, '#6d7bff', noise(v, 1), noise(v, 2), 1, 1);
      px(g, '#a9b3ff', noise(v, 3), noise(v, 4), 1, 1);
      return true;
    case 'path':
    case 'start':
      px(g, '#7f1d2d', 0, 0, 12, 12);
      px(g, '#9b2c3f', 0, 0, 12, 2);
      px(g, '#9b2c3f', 0, 10, 12, 2);
      px(g, '#fbbf24', 0, 2, 12, 1);
      px(g, '#fbbf24', 0, 9, 12, 1);
      px(g, '#6a1625', noise(v, 3), 5, 2, 1);
      return true;
    case 'water':
      px(g, '#1b3358', 0, 0, 12, 12);
      px(g, '#142849', 0, 0, 12, 3);
      for (let i = 0; i < 3; i++) px(g, '#3f66a3', (noise(v, i) + i * 4) % 10, 3 + i * 3, 3, 1);
      return true;
    case 'bridge':
      px(g, '#1b3358', 0, 0, 12, 12);
      px(g, '#6e4a22', 0, 1, 12, 10);
      for (let x = 0; x < 12; x += 4) px(g, '#3d2711', x, 1, 1, 10);
      px(g, '#9ca3af', 0, 1, 12, 1);
      px(g, '#9ca3af', 0, 10, 12, 1);
      px(g, '#e5e7eb', 1, 1, 1, 1);
      px(g, '#e5e7eb', 10, 10, 1, 1);
      return true;
    case 'rock':
      px(g, '#2f3446', 0, 0, 12, 12);
      px(g, '#454c63', 1, 1, 10, 9);
      px(g, '#5c6480', 2, 2, 4, 2);
      px(g, '#1c2030', 1, 10, 10, 1);
      return true;
    case 'wall':
      px(g, '#4b5266', 0, 0, 12, 12);
      px(g, '#5f6780', 0, 0, 12, 4);
      px(g, '#2c3142', 0, 4, 12, 1);
      px(g, '#2c3142', 0, 8, 12, 1);
      px(g, '#2c3142', 3 + (v % 2) * 3, 0, 1, 4);
      px(g, '#2c3142', 8 - (v % 2) * 3, 5, 1, 3);
      px(g, '#2c3142', 4, 9, 1, 3);
      px(g, '#79829c', 1, 1, 3, 1);
      px(g, '#1c2030', 0, 11, 12, 1);
      return true;
    case 'torch':
      paintCastle(g, 'wall', v);
      px(g, '#3d2711', 5, 5, 2, 5);
      px(g, '#9ca3af', 4, 4, 4, 1);
      return true;
    default:
      return false;
  }
}

function paint(g: G, tile: Tile, v: number, region: RegionId = 'meadow') {
  if (region === 'forest' && paintForest(g, tile, v)) return;
  if (region === 'castle' && paintCastle(g, tile, v)) return;
  switch (tile) {
    case 'grass':
    case 'chest':
    case 'vault':
      grass(g, v);
      break;
    case 'spawn':
      grass(g, v, '#44913f');
      px(g, '#6ccb63', noise(v, 1), noise(v, 2), 1, 2);
      px(g, '#f9a8d4', noise(v, 3), noise(v, 4), 1, 1);
      break;
    case 'path':
    case 'start':
      px(g, '#c8a165', 0, 0, 12, 12);
      for (let i = 0; i < 4; i++) px(g, '#a9854d', noise(v, i), noise(v, i + 5), 2, 1);
      px(g, '#dcbb85', noise(v, 9), noise(v, 8), 1, 1);
      break;
    case 'tree':
      grass(g, v);
      px(g, '#6b4423', 5, 8, 2, 4);
      px(g, '#1f6b36', 2, 2, 8, 7);
      px(g, '#2f8f4a', 3, 1, 6, 2);
      px(g, '#164e2a', 2, 7, 8, 2);
      px(g, '#4fb46a', 4, 3, 2, 2);
      break;
    case 'water':
      px(g, '#2f6fcf', 0, 0, 12, 12);
      for (let i = 0; i < 3; i++) px(g, '#5b95e6', (noise(v, i) + i * 4) % 10, 2 + i * 4, 3, 1);
      break;
    case 'rock':
      px(g, '#555b69', 0, 0, 12, 12);
      px(g, '#7b8190', 1, 1, 10, 9);
      px(g, '#a0a6b5', 2, 2, 4, 2);
      px(g, '#3f4452', 1, 10, 10, 1);
      break;
    case 'bridge':
      px(g, '#2f6fcf', 0, 0, 12, 12);
      px(g, '#9a6b36', 0, 1, 12, 10);
      for (let x = 1; x < 12; x += 3) px(g, '#6e4a22', x, 1, 1, 10);
      break;
    case 'span':
      px(g, '#2f6fcf', 0, 0, 12, 12);
      px(g, '#5b95e6', 1, 5, 10, 1);
      px(g, '#8a8f9e', 2, 3, 1, 6);
      px(g, '#8a8f9e', 9, 3, 1, 6);
      break;
    case 'gate':
      px(g, '#c8a165', 0, 0, 12, 12);
      px(g, '#6b7280', 0, 0, 2, 12);
      px(g, '#6b7280', 10, 0, 2, 12);
      px(g, '#4b5563', 2, 0, 8, 2);
      break;
    case 'back':
      px(g, '#c8a165', 0, 0, 12, 12);
      px(g, '#6b7280', 0, 0, 12, 2);
      px(g, '#6b7280', 0, 10, 12, 2);
      break;
    case 'boss':
      px(g, '#3f4452', 0, 0, 12, 12);
      px(g, '#111827', 2, 2, 8, 10);
      px(g, '#991b1b', 3, 3, 6, 9);
      px(g, '#ef4444', 5, 5, 2, 2);
      break;
    case 'camp':
      px(g, '#7a6a4f', 0, 0, 12, 12);
      px(g, '#9a8a6f', noise(v, 1), noise(v, 2), 2, 1);
      px(g, '#5a4c36', noise(v, 3), noise(v, 4), 1, 1);
      break;
    case 'door':
      px(g, '#7b8190', 0, 0, 12, 12);
      px(g, '#8a5a2b', 2, 1, 8, 11);
      px(g, '#5b3a1a', 2, 1, 8, 1);
      px(g, '#facc15', 8, 6, 1, 1);
      break;
    case 'exit':
      // The way out of a lair: the same sill as the gate back, in every region.
      px(g, '#c8a165', 0, 0, 12, 12);
      px(g, '#6b7280', 0, 0, 12, 2);
      px(g, '#6b7280', 0, 10, 12, 2);
      px(g, '#fbbf24', 4, 5, 4, 2);
      break;
    case 'rdoor':
      // A closed room door: a plank door in a stone frame. The open door is drawn as a path tile.
      px(g, '#4b5563', 0, 0, 12, 12);
      px(g, '#8a5a2b', 1, 1, 10, 11);
      px(g, '#5b3a1a', 1, 1, 10, 1);
      px(g, '#5b3a1a', 5, 1, 2, 11);
      px(g, '#facc15', 3, 6, 1, 1);
      px(g, '#facc15', 8, 6, 1, 1);
      break;
  }
}

const atlases = new Map<RegionId, HTMLCanvasElement>();

/** All tiles of a region painted once: one column per tile type, one row per variant. The Meadow keeps its original look. */
export function tileAtlas(region: RegionId = 'meadow'): HTMLCanvasElement {
  const hit = atlases.get(region);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = ORDER.length * TILE;
  c.height = VARIANTS * TILE;
  const g = c.getContext('2d')!;
  ORDER.forEach((t, col) => {
    for (let v = 0; v < VARIANTS; v++) {
      g.save();
      g.translate(col * TILE, v * TILE);
      g.beginPath();
      g.rect(0, 0, TILE, TILE);
      g.clip();
      paint(g, t, v, region);
      g.restore();
    }
  });
  atlases.set(region, c);
  return c;
}

const spriteCache = new Map<string, HTMLCanvasElement>();

/** A 12 by 12 sprite from the app's pixel tables, painted to a canvas once. */
export function spriteCanvas(name: string): HTMLCanvasElement {
  const hit = spriteCache.get(name);
  if (hit) return hit;
  const def = SPRITES[name] ?? ITEM_SPRITES[name] ?? SPRITES.knight!;
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const g = c.getContext('2d')!;
  def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = def.palette[row[x]!];
      if (col) px(g, col, x, y);
    }
  });
  spriteCache.set(name, c);
  return c;
}

export interface Scene {
  map: TileMap;
  /** Hero position in tiles (fractional while walking). */
  hero: { x: number; y: number; facing: Facing; frame: number };
  heroSprite: string;
  petSprite?: string;
  entities: Entity[];
  gateOpen: boolean;
  campLit: boolean;
  bossDefeated: boolean;
  hasKey: boolean;
  hasBridgeKit: boolean;
  /** Chests opened on this trip in this land: they stay on the map with the lid up. */
  openedChests: Point[];
  lantern: boolean;
  /** Seconds, for animation. */
  time: number;
  /** The tile the last tap pointed at. */
  marker: Point | null;
  /** True under prefers-reduced-motion: the water and grass hold their first frame. */
  still?: boolean;
  /** Lair only: rooms cleared so far. A room door whose number is at most this draws open. */
  roomsCleared?: number;
  /** A beaten lair leaves a gold cup at the camp. Cosmetic only: it is not an item. */
  trophy?: boolean;
  /** The tent and flags the kid placed in this land (see camp.ts). Decor only: the hero walks over them. */
  camp?: Placed[];
}

const variantOf = (x: number, y: number) => (x * 7 + y * 13) % VARIANTS;

/** The tile column and pixel size the canvas uses at a given zoom. */
export function viewFor(width: number, height: number, scale: number, hero: { x: number; y: number }, map: TileMap) {
  const t = TILE * scale;
  const maxX = Math.max(0, map.w * t - width);
  const maxY = Math.max(0, map.h * t - height);
  const left = Math.min(maxX, Math.max(0, hero.x * t + t / 2 - width / 2));
  const top = Math.min(maxY, Math.max(0, hero.y * t + t / 2 - height / 2));
  return { t, left, top };
}

export function drawScene(g: G, width: number, height: number, scale: number, s: Scene): void {
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#10131f';
  g.fillRect(0, 0, width, height);
  const { t, left, top } = viewFor(width, height, scale, s.hero, s.map);
  const at = tileAtlas(s.map.id);
  const x0 = Math.max(0, Math.floor(left / t));
  const y0 = Math.max(0, Math.floor(top / t));
  const x1 = Math.min(s.map.w - 1, Math.ceil((left + width) / t));
  const y1 = Math.min(s.map.h - 1, Math.ceil((top + height) / t));
  // Two frames for water and grass: the tile swaps to its next variant twice a second (water) and once every 1.5 seconds on a
  // scatter of grass tiles. Nothing moves when the player asks for reduced motion.
  const frame = s.still ? 0 : Math.floor(s.time * 2) % 2;
  const sway = s.still ? 0 : Math.floor(s.time / 1.5) % 2;
  const tile = (name: Tile, x: number, y: number) => {
    let v = variantOf(x, y);
    if (name === 'water' || name === 'bridge') v = (v + frame) % VARIANTS;
    else if (name === 'grass' && (x * 3 + y * 5) % 4 === 0) v = (v + sway) % VARIANTS;
    g.drawImage(at, ORDER.indexOf(name) * TILE, v * TILE, TILE, TILE, Math.round(x * t - left), Math.round(y * t - top), t, t);
  };
  const sprite = (name: string, x: number, y: number, dy = 0, flip = false, size = 1) => {
    const dx = Math.round(x * t - left + (t * (1 - size)) / 2);
    const dyy = Math.round(y * t - top + dy * scale + t * (1 - size));
    const w = Math.round(t * size);
    if (flip) {
      g.save();
      g.translate(dx + w, dyy);
      g.scale(-1, 1);
      g.drawImage(spriteCanvas(name), 0, 0, TILE, TILE, 0, 0, w, w);
      g.restore();
    } else g.drawImage(spriteCanvas(name), 0, 0, TILE, TILE, dx, dyy, w, w);
  };

  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const k = tileAt(s.map, x, y);
      // A lair has no grass to stand on: spawn tiles and doors that are open show the floor of the region.
      if (s.map.lair && k === 'spawn') tile(s.map.id === 'meadow' ? 'path' : 'grass', x, y);
      else if (k === 'rdoor' && (s.roomsCleared ?? 0) >= doorNeed(s.map, x, y)) tile('path', x, y);
      else if (k === 'gate' && s.gateOpen) tile('back', x, y);
      else if (k === 'span' && s.hasBridgeKit) tile('bridge', x, y);
      else if (k === 'door' && s.hasKey) tile('path', x, y);
      else tile(k, x, y);
      if (k === 'boss' && !s.bossDefeated) sprite('boss', x, y, Math.sin(s.time * 2) * 0.6);
      if (k === 'camp' && x === firstCamp(s.map)?.x && y === firstCamp(s.map)?.y) campfire(g, x * t - left, y * t - top, t, s.campLit, s.time);
      if (k === 'camp' && s.trophy && x === trophySpot(s.map)?.x && y === trophySpot(s.map)?.y) trophyCup(g, x * t - left, y * t - top, t);
      if (k === 'gate' && !s.gateOpen) lock(g, x * t - left, y * t - top, t);
      if (k === 'torch') flame(g, x * t - left, y * t - top, t, s.time + x * 0.7);
    }

  // Soft shadows: trees and rocks cast a 2 pixel band on the ground tile below, drawn before the chests, monsters and hero.
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const k = tileAt(s.map, x, y);
      if (k !== 'tree' && k !== 'rock') continue;
      const below = tileAt(s.map, x, y + 1);
      if (below === 'tree' || below === 'rock' || below === 'wall' || below === 'water') continue;
      shadow(g, x * t - left, (y + 1) * t - top, t);
    }

  // Chests, then monsters, then the hero (sorted by row so lower things draw over higher ones).
  const items: Array<{ y: number; draw: () => void }> = [];
  for (const e of s.entities) {
    if (!e.shown || e.x < x0 - 1 || e.x > x1 + 1 || e.y < y0 - 1 || e.y > y1 + 1) continue;
    if (e.kind === 'chest') items.push({ y: e.y, draw: () => chestAt(g, e.x * t - left, e.y * t - top, t, false, true, s.time) });
    else items.push({ y: e.y, draw: () => sprite(e.look, e.x, e.y, Math.sin(s.time * 3 + e.x) * 0.8) });
  }
  for (const c of s.openedChests) {
    if (c.x < x0 - 1 || c.x > x1 + 1 || c.y < y0 - 1 || c.y > y1 + 1) continue;
    items.push({ y: c.y, draw: () => chestAt(g, c.x * t - left, c.y * t - top, t, true, false, s.time) });
  }
  for (const c of s.camp ?? []) {
    if (c.x < x0 - 1 || c.x > x1 + 1 || c.y < y0 - 1 || c.y > y1 + 1) continue;
    // Drawn before the hero of the same row, so the hero walks in front of a tent or a flag.
    items.push({ y: c.y - 0.5, draw: () => (c.kind === 'tent' ? tentAt(g, c.x * t - left, c.y * t - top, t, s.time, !!s.still) : flagAt(g, c.x * t - left, c.y * t - top, t, s.time, !!s.still)) });
  }
  const h = s.hero;
  const bob = h.frame % 2 === 1 ? -1 : 0;
  items.push({
    y: h.y + 0.5,
    draw: () => {
      if (s.petSprite) sprite(s.petSprite, h.x + (h.facing === 'left' ? 0.55 : -0.5), h.y + 0.15, bob * 0.5, h.facing !== 'left', 0.7);
      sprite(s.heroSprite, h.x, h.y, bob, h.facing === 'left');
      if (h.facing === 'up') {
        // From behind: the face is covered.
        g.fillStyle = 'rgba(17,24,39,0.55)';
        g.fillRect(Math.round(h.x * t - left + t * 0.25), Math.round(h.y * t - top + t * 0.2 + bob * scale), Math.round(t * 0.5), Math.round(t * 0.3));
      }
    },
  });
  items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());

  if (s.marker) {
    g.strokeStyle = '#fbbf24';
    g.lineWidth = Math.max(2, scale);
    const mx = s.marker.x * t - left + g.lineWidth / 2;
    const my = s.marker.y * t - top + g.lineWidth / 2;
    g.strokeRect(mx, my, t - g.lineWidth, t - g.lineWidth);
  }
  if (s.lantern) {
    // A lantern lights a soft circle around the hero and dims the rest.
    const cx = h.x * t - left + t / 2;
    const cy = h.y * t - top + t / 2;
    const grad = g.createRadialGradient(cx, cy, t * 3, cx, cy, t * 7);
    grad.addColorStop(0, 'rgba(10,12,24,0)');
    grad.addColorStop(1, 'rgba(10,12,24,0.35)');
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
  }
}

/** A soft shadow on the ground under a tree or a rock: two stepped bands, the second one narrower and lighter. */
function shadow(g: G, x: number, y: number, t: number) {
  const u = t / TILE;
  g.fillStyle = 'rgba(8, 12, 24, 0.26)';
  g.fillRect(Math.round(x + 1 * u), Math.round(y), Math.round(11 * u), Math.round(1 * u));
  g.fillStyle = 'rgba(8, 12, 24, 0.14)';
  g.fillRect(Math.round(x + 2 * u), Math.round(y + 1 * u), Math.round(9 * u), Math.round(1 * u));
}

function firstCamp(map: TileMap): Point | undefined {
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (tileAt(map, x, y) === 'camp') return { x, y };
  return undefined;
}

/** The tile that holds the cup: the second camp tile when the camp has two (the Meadow's), else the first. */
function trophySpot(map: TileMap): Point | undefined {
  const first = firstCamp(map);
  if (!first) return undefined;
  return tileAt(map, first.x + 1, first.y) === 'camp' ? { x: first.x + 1, y: first.y } : first;
}

/** A small gold cup on two handles, on a dark plinth. */
function trophyCup(g: G, x: number, y: number, t: number) {
  const u = t / TILE;
  g.fillStyle = '#92400e';
  g.fillRect(x + 3 * u, y + 9 * u, 6 * u, 2 * u);
  g.fillRect(x + 5 * u, y + 7 * u, 2 * u, 2 * u);
  g.fillStyle = '#fbbf24';
  g.fillRect(x + 3 * u, y + 2 * u, 6 * u, 5 * u);
  g.fillRect(x + 1.5 * u, y + 3 * u, 1.5 * u, 2 * u);
  g.fillRect(x + 9 * u, y + 3 * u, 1.5 * u, 2 * u);
  g.fillStyle = '#fef3c7';
  g.fillRect(x + 4 * u, y + 3 * u, 1 * u, 3 * u);
}

function chestAt(g: G, x: number, y: number, t: number, open: boolean, sparkle: boolean, time: number) {
  const u = t / TILE;
  g.fillStyle = '#451a03';
  g.fillRect(x + 1 * u, y + 5 * u, 10 * u, 6 * u);
  g.fillStyle = '#d97706';
  g.fillRect(x + 2 * u, y + 6 * u, 8 * u, 4 * u);
  g.fillStyle = open ? '#fde68a' : '#b45309';
  g.fillRect(x + 2 * u, open ? y + 3 * u : y + 4 * u, 8 * u, open ? 2 * u : 3 * u);
  g.fillStyle = '#facc15';
  g.fillRect(x + 5 * u, y + 6 * u, 2 * u, 2 * u);
  if (sparkle && !open && Math.floor(time * 3) % 2 === 0) {
    g.fillStyle = '#fef08a';
    g.fillRect(x + 9 * u, y + 2 * u, u, u);
    g.fillRect(x + 2 * u, y + 3 * u, u, u);
  }
}

/** The camp tent: cloth, a dark door, a red banner on a pole at the peak and a small campfire beside it. */
function tentAt(g: G, x: number, y: number, t: number, time: number, still: boolean) {
  const u = t / TILE;
  const half = [0, 1, 1, 2, 3, 3, 4];
  half.forEach((h, i) => {
    const row = 3 + i;
    g.fillStyle = '#f1e4c3';
    g.fillRect(x + (4 - h) * u, y + row * u, (2 * h + 1) * u, u);
    g.fillStyle = '#111827';
    g.fillRect(x + (4 - h) * u, y + row * u, u, u);
    g.fillRect(x + (4 + h) * u, y + row * u, u, u);
  });
  g.fillStyle = '#92400e';
  g.fillRect(x + 3 * u, y + 7 * u, 3 * u, 3 * u);
  g.fillStyle = '#451a03';
  g.fillRect(x + 4 * u, y + 8 * u, u, 2 * u);
  g.fillStyle = '#111827';
  g.fillRect(x + 4 * u, y + 0 * u, u, 3 * u);
  g.fillStyle = '#ef4444';
  g.fillRect(x + 5 * u, y + 0 * u, 3 * u, 2 * u);
  g.fillRect(x + 5 * u, y + 2 * u, 2 * u, u);
  g.fillStyle = '#b91c1c';
  g.fillRect(x + 5 * u, y + 1.5 * u, 3 * u, 0.5 * u);
  // The fire: three stones and a two-colour flame that flickers.
  g.fillStyle = '#6b7280';
  g.fillRect(x + 8.5 * u, y + 9.5 * u, 3 * u, 1.5 * u);
  const f = still ? 0 : Math.sin(time * 9) > 0 ? 1 : 0;
  g.fillStyle = '#f97316';
  g.fillRect(x + 9 * u, y + (7 + f * 0.5) * u, 2 * u, (2.5 - f * 0.5) * u);
  g.fillStyle = '#fde047';
  g.fillRect(x + 9.5 * u, y + (8 + f * 0.5) * u, u, (1.5 - f * 0.5) * u);
}

/** A flag on a pole with a small stone base. The pennant lifts a pixel twice a second. */
function flagAt(g: G, x: number, y: number, t: number, time: number, still: boolean) {
  const u = t / TILE;
  const wave = still ? 0 : Math.floor(time * 2) % 2;
  g.fillStyle = '#6b7280';
  g.fillRect(x + 3 * u, y + 10 * u, 5 * u, 2 * u);
  g.fillStyle = '#92400e';
  g.fillRect(x + 5 * u, y + 2 * u, u, 8 * u);
  g.fillStyle = '#ef4444';
  g.fillRect(x + 6 * u, y + (2 + wave * 0.5) * u, 4 * u, 3 * u);
  g.fillRect(x + 6 * u, y + (5 + wave * 0.5) * u, 2 * u, u);
  g.fillStyle = '#fde047';
  g.fillRect(x + 6 * u, y + (2 + wave * 0.5) * u, 4 * u, 0.5 * u);
}

function lock(g: G, x: number, y: number, t: number) {
  const u = t / TILE;
  g.fillStyle = '#94a3b8';
  g.fillRect(x + 3 * u, y + 5 * u, 6 * u, 5 * u);
  g.strokeStyle = '#334155';
  g.lineWidth = u;
  g.strokeRect(x + 4 * u, y + 2 * u, 4 * u, 4 * u);
  g.fillStyle = '#334155';
  g.fillRect(x + 5.5 * u, y + 6.5 * u, u, 2 * u);
}

function campfire(g: G, x: number, y: number, t: number, lit: boolean, time: number) {
  const u = t / TILE;
  g.fillStyle = '#5b3a1a';
  g.fillRect(x + 2 * u, y + 8 * u, 8 * u, 2 * u);
  g.fillStyle = '#7a4a22';
  g.fillRect(x + 3 * u, y + 7 * u, 6 * u, u);
  if (!lit) return;
  const f = Math.sin(time * 9) > 0 ? 1 : 0;
  g.fillStyle = '#f97316';
  g.fillRect(x + 4 * u, y + (3 + f) * u, 4 * u, (5 - f) * u);
  g.fillStyle = '#fde047';
  g.fillRect(x + 5 * u, y + (5 + f) * u, 2 * u, (3 - f) * u);
}

/** A wall torch: a two-colour flame that flickers. */
function flame(g: G, x: number, y: number, t: number, time: number) {
  const u = t / TILE;
  const f = Math.sin(time * 8) > 0 ? 1 : 0;
  g.fillStyle = '#f97316';
  g.fillRect(x + 4.5 * u, y + (1.5 + f * 0.5) * u, 3 * u, (3 - f * 0.5) * u);
  g.fillStyle = '#fde047';
  g.fillRect(x + 5.5 * u, y + (2.5 + f * 0.5) * u, 1 * u, 1.5 * u);
}
