import { describe, expect, it } from 'vitest';
import type { Entry } from '../../engine/session';
import type { Entity } from './encounters';
import { barFill, doorLabel, lairRetryEntity, miniMap, openedLairSpots } from './lairView';
import { LAIRS, REGION_IDS, roomOf, tileAt } from './maps';

describe('barFill', () => {
  it('is full at the start and reads whole seconds rounded up', () => {
    expect(barFill(81_000, 81_000)).toEqual({ pct: 100, secs: 81, tone: 'go', urgent: false });
    expect(barFill(80_001, 81_000).secs).toBe(81);
  });
  it('turns gold under half and urgent under 10 seconds, and never reads past the ends', () => {
    expect(barFill(40_000, 81_000).tone).toBe('gold');
    expect(barFill(9_999, 81_000).urgent).toBe(true);
    expect(barFill(10_000, 81_000).urgent).toBe(false);
    expect(barFill(0, 81_000)).toEqual({ pct: 0, secs: 0, tone: 'gold', urgent: false });
    expect(barFill(-5, 81_000).pct).toBe(0);
    expect(barFill(90_000, 81_000).pct).toBe(100);
  });
});

describe('doorLabel', () => {
  it('has no label before a win', () => {
    expect(doorLabel({ beaten: 0, bestMs: null, bestCorrect: 0 }, false)).toEqual([]);
  });
  it('counts a lair on the defeated list as beaten once, even with no log yet', () => {
    expect(doorLabel({ beaten: 0, bestMs: null, bestCorrect: 0 }, true)).toEqual(['Beaten 1 time']);
  });
  it('says Beaten N times with the best time and the most right answers', () => {
    expect(doorLabel({ beaten: 3, bestMs: 41_600, bestCorrect: 6 }, true)).toEqual(['Beaten 3 times', 'Best 42 s', 'Most right 6 of 6']);
  });
});

describe('miniMap', () => {
  it('marks cleared, here, open and locked rooms for every lair', () => {
    for (const id of REGION_IDS) {
      const def = LAIRS[id];
      const start = { x: def.rooms[0]!.x + 1, y: def.rooms[0]!.y + 1 };
      const m = miniMap(def, 0, start);
      expect(m.rooms).toHaveLength(def.rooms.length);
      expect(m.rooms.map((r) => r.state)).toEqual(['here', ...def.rooms.slice(1).map(() => 'locked')]);
      expect(miniMap(def, 1, start).rooms.map((r) => r.state).slice(0, 2)).toEqual(['here', 'open']);
      expect(m.rooms.filter((r) => r.boss)).toHaveLength(1);
      const done = miniMap(def, def.rooms.length - 1, { x: def.rooms.at(-1)!.x + 1, y: def.rooms.at(-1)!.y + 1 });
      expect(done.rooms.at(-1)!.state).toBe('here');
      expect(done.rooms.slice(0, -1).every((r) => r.state === 'cleared')).toBe(true);
    }
  });
});

describe('openedLairSpots', () => {
  it('keeps only the chests of this region and this visit', () => {
    const opened = ['lair-forest#2:5,4', 'lair-forest#1:9,9', 'lair-castle#2:1,1', 'meadow:3,3'];
    expect(openedLairSpots(opened, 'forest', 2)).toEqual([{ x: 5, y: 4 }]);
  });
});

describe('lairRetryEntity', () => {
  it('puts a missed monster back in its own room, on free floor, within 3 tiles', () => {
    const def = LAIRS.forest;
    const room = def.rooms[1]!;
    const prev: Entity = { id: 'a', kind: 'monster', x: room.x + 2, y: room.y + 2, look: 'slime', cardId: 'mul:6x7', shown: true, room: 1 };
    const entry = { id: 'b', cardId: 'mul:6x7' } as Entry;
    for (let seed = 0; seed < 30; seed++) {
      const r = lairRetryEntity({ prev, entry, def, taken: [{ x: prev.x, y: prev.y }], rng: () => (seed % 10) / 10, cleared: 0 });
      expect(roomOf(def, r.x, r.y)).toBe(1);
      expect(Math.abs(r.x - prev.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(r.y - prev.y)).toBeLessThanOrEqual(3);
      expect(r.x === prev.x && r.y === prev.y).toBe(false);
      expect(tileAt(def.map, r.x, r.y)).not.toBe('rock');
      expect(r.room).toBe(1);
      expect(r.shown).toBe(true);
    }
  });
  it('never crosses a wall into a neighbouring room', () => {
    const def = LAIRS.castle;
    const room = def.rooms[0]!;
    const prev: Entity = { id: 'a', kind: 'monster', x: room.x + room.w - 1, y: room.y + 1, look: 'bat', cardId: 'mul:6x7', shown: true, room: 0 };
    for (let seed = 0; seed < 40; seed++) {
      const r = lairRetryEntity({ prev, entry: { id: 'b', cardId: 'mul:6x7' } as Entry, def, taken: [], rng: () => seed / 40, cleared: 0 });
      expect(roomOf(def, r.x, r.y)).toBe(0);
    }
  });
});
