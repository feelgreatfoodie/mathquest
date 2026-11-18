import { ITEM_SPRITES } from '../../ui/itemSprites';
import { SPRITES } from '../../ui/sprites';
import type { Entity } from './encounters';
import { tileAt, type Point, type Tile, type TileMap } from './maps';
import type { Facing } from './worldState';

// Canvas 2D drawing for the Overworld. Every tile and sprite is original and made in code: 12 by 12 pixel tiles painted
// once into an atlas, sprites read from the same pixel tables the rest of the app uses. Scaling is nearest-neighbour.

export const TILE = 12;
const VARIANTS = 3;
const ORDER: Tile[] = ['grass', 'path', 'tree', 'water', 'rock', 'bridge', 'gate', 'back', 'chest', 'spawn', 'boss', 'camp', 'start', 'door', 'span'];

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

function paint(g: G, tile: Tile, v: number) {
  switch (tile) {
    case 'grass':
    case 'chest':
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
  }
}

let atlas: HTMLCanvasElement | null = null;

/** All tiles painted once: one column per tile type, one row per variant. */
export function tileAtlas(): HTMLCanvasElement {
  if (atlas) return atlas;
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
      paint(g, t, v);
      g.restore();
    }
  });
  atlas = c;
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
  lantern: boolean;
  /** Seconds, for animation. */
  time: number;
  /** The tile the last tap pointed at. */
  marker: Point | null;
  /** The walk from the hero to the campfire, drawn as a pulse while the camp is lit. */
  campGuide?: Point[] | null;
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
  const at = tileAtlas();
  const x0 = Math.max(0, Math.floor(left / t));
  const y0 = Math.max(0, Math.floor(top / t));
  const x1 = Math.min(s.map.w - 1, Math.ceil((left + width) / t));
  const y1 = Math.min(s.map.h - 1, Math.ceil((top + height) / t));
  const tile = (name: Tile, x: number, y: number) =>
    g.drawImage(at, ORDER.indexOf(name) * TILE, variantOf(x, y) * TILE, TILE, TILE, Math.round(x * t - left), Math.round(y * t - top), t, t);
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
      if (k === 'gate' && s.gateOpen) tile('back', x, y);
      else if (k === 'span' && s.hasBridgeKit) tile('bridge', x, y);
      else if (k === 'door' && s.hasKey) tile('path', x, y);
      else tile(k, x, y);
      if (k === 'boss' && !s.bossDefeated) sprite('boss', x, y, Math.sin(s.time * 2) * 0.6);
      if (k === 'camp' && x === firstCamp(s.map)?.x && y === firstCamp(s.map)?.y) campfire(g, x * t - left, y * t - top, t, s.campLit, s.time);
      if (k === 'gate' && !s.gateOpen) lock(g, x * t - left, y * t - top, t);
    }

  // Chests, then monsters, then the hero (sorted by row so lower things draw over higher ones).
  const items: Array<{ y: number; draw: () => void }> = [];
  for (const e of s.entities) {
    if (!e.shown || e.x < x0 - 1 || e.x > x1 + 1 || e.y < y0 - 1 || e.y > y1 + 1) continue;
    if (e.kind === 'chest') items.push({ y: e.y, draw: () => chestAt(g, e.x * t - left, e.y * t - top, t, false, s.lantern, s.time) });
    else items.push({ y: e.y, draw: () => sprite(e.look, e.x, e.y, Math.sin(s.time * 3 + e.x) * 0.8) });
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

  if (s.campGuide?.length) {
    // A wave of gold runs along the path toward the camp; the first step also gets an arrow.
    s.campGuide.forEach((p, i) => {
      if (p.x < x0 - 1 || p.x > x1 + 1 || p.y < y0 - 1 || p.y > y1 + 1) return;
      const pulse = 0.5 + 0.5 * Math.sin(s.time * 5 - i * 0.7);
      g.fillStyle = `rgba(251,191,36,${(0.18 + 0.45 * pulse).toFixed(3)})`;
      const inset = t * 0.18;
      g.fillRect(Math.round(p.x * t - left + inset), Math.round(p.y * t - top + inset), Math.round(t - 2 * inset), Math.round(t - 2 * inset));
    });
    const from = { x: Math.round(s.hero.x), y: Math.round(s.hero.y) };
    const next = s.campGuide[0]!;
    const dx = next.x - from.x;
    const dy = next.y - from.y;
    const cx = next.x * t - left + t / 2;
    const cy = next.y * t - top + t / 2;
    const r = t * 0.32 * (1 + 0.15 * Math.sin(s.time * 6));
    g.fillStyle = '#fbbf24';
    g.beginPath();
    g.moveTo(cx + dx * r, cy + dy * r);
    g.lineTo(cx - dx * r * 0.2 + dy * r, cy - dy * r * 0.2 + dx * r);
    g.lineTo(cx - dx * r * 0.2 - dy * r, cy - dy * r * 0.2 - dx * r);
    g.closePath();
    g.fill();
  }
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

function firstCamp(map: TileMap): Point | undefined {
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (tileAt(map, x, y) === 'camp') return { x, y };
  return undefined;
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
