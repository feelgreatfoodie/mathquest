import type { Rng } from '../../engine/problems';
import type { Entry } from '../../engine/session';
import type { Entity } from './encounters';
import { isWalkable, roomOf, tileAt, type LairDef, type Point } from './maps';
import type { LairStats } from './lair';

// The pure parts of the lair screen: the countdown bar, the door label, the mini room map and where a missed monster comes back.
// Overworld.tsx and LairHud.tsx only draw what these return.

export type BarTone = 'go' | 'gold';

export interface BarFill {
  /** 0 to 100, how full the bar is. */
  pct: number;
  /** Whole seconds left, rounded up, so the bar never reads 0 s while time remains. */
  secs: number;
  tone: BarTone;
  /** Under 10 seconds: the bar blinks. */
  urgent: boolean;
}

/** The boss countdown bar: full at the start, gold under half, urgent under 10 s. */
export function barFill(remainingMs: number, budgetMs: number): BarFill {
  const left = Math.max(0, Math.min(remainingMs, budgetMs));
  const pct = budgetMs > 0 ? Math.round((left / budgetMs) * 100) : 0;
  return { pct, secs: Math.ceil(left / 1000), tone: pct > 50 ? 'go' : 'gold', urgent: left > 0 && left < 10_000 };
}

/** The door label: "Beaten 3 times" and, when a win has a time, "Best 42 s". A door with no win has no label. */
export function doorLabel(stats: Pick<LairStats, 'beaten' | 'bestMs' | 'bestCorrect'>, defeated: boolean): string[] {
  const beaten = Math.max(stats.beaten, defeated ? 1 : 0);
  if (beaten <= 0) return [];
  const lines = [`Beaten ${beaten} ${beaten === 1 ? 'time' : 'times'}`];
  if (stats.bestMs !== null) lines.push(`Best ${Math.round(stats.bestMs / 1000)} s`);
  if (stats.bestCorrect > 0) lines.push(`Most right ${stats.bestCorrect} of 6`);
  return lines;
}

export type RoomState = 'cleared' | 'here' | 'open' | 'locked';

export interface MiniRoom {
  x: number;
  y: number;
  w: number;
  h: number;
  state: RoomState;
  boss: boolean;
}

/**
 * The mini map: each room of the lair as a box in map units. A room is cleared when its number is below `cleared`, `here` where the
 * hero stands, open when its door is open but it is not cleared, locked behind a closed door. The boss room is the last box.
 */
export function miniMap(def: LairDef, cleared: number, hero: Point): { w: number; h: number; rooms: MiniRoom[] } {
  const here = roomOf(def, hero.x, hero.y);
  const rooms = def.rooms.map((r, i): MiniRoom => ({
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    boss: i === def.rooms.length - 1,
    state: i === here ? 'here' : i < cleared ? 'cleared' : i <= cleared ? 'open' : 'locked',
  }));
  return { w: def.map.w, h: def.map.h, rooms };
}

/** The tiles of this lair's opened chests: spot ids look like `lair-<region>#<seq>:x,y`. Chests of another visit or region are left out. */
export function openedLairSpots(opened: readonly string[], region: string, seq: number): Point[] {
  const head = `lair-${region}#${seq}:`;
  return opened
    .filter((id) => id.startsWith(head))
    .map((id) => {
      const [x, y] = id.slice(head.length).split(',').map(Number);
      return { x: x!, y: y! };
    })
    .filter((p) => Number.isInteger(p.x) && Number.isInteger(p.y));
}

const RETRY_RADIUS = 3;

/** A missed lair monster comes back inside the same room, within 3 tiles, on free floor. A room too full puts it back where it stood. */
export function lairRetryEntity({ prev, entry, def, taken, rng, cleared }: { prev: Entity; entry: Entry; def: LairDef; taken: Point[]; rng: Rng; cleared: number }): Entity {
  const room = roomOf(def, prev.x, prev.y);
  const used = new Set(taken.map((p) => `${p.x},${p.y}`));
  const options: Point[] = [];
  for (let dy = -RETRY_RADIUS; dy <= RETRY_RADIUS; dy++)
    for (let dx = -RETRY_RADIUS; dx <= RETRY_RADIUS; dx++) {
      const p = { x: prev.x + dx, y: prev.y + dy };
      const t = tileAt(def.map, p.x, p.y);
      if (roomOf(def, p.x, p.y) !== room || (t !== 'path' && t !== 'spawn' && t !== 'grass')) continue;
      if (isWalkable(def.map, p.x, p.y, { gateOpen: false, hasKey: false, hasBridgeKit: false, roomsCleared: cleared }) && !used.has(`${p.x},${p.y}`)) options.push(p);
    }
  const pick = options.length ? options[Math.floor(rng() * options.length)]! : { x: prev.x, y: prev.y };
  return { id: entry.id, kind: 'monster', x: pick.x, y: pick.y, look: prev.look, cardId: entry.cardId, shown: true, ...(prev.room !== undefined ? { room: prev.room } : {}) };
}
