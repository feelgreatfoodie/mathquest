import { beforeEach, describe, expect, it } from 'vitest';
import { deviceId, randomDeviceId, resetDeviceIdMemo } from './deviceId';
import { forgetTile, forgetTiles, readTiles, rememberTile } from './deviceTiles';
import { applyPilotParam, parseMode, pilotOptedIn, signin2Active } from './signin2';

function memoryStore(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}
const blocked = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

beforeEach(() => resetDeviceIdMemo());

describe('deviceId', () => {
  it('makes a 128-bit hex id the server accepts, and keeps it', () => {
    const s = memoryStore();
    const a = deviceId(s);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(deviceId(s)).toBe(a);
    expect(s.raw.get('mathquest:v1:device-id')).toBe(a);
  });

  it('two devices get two ids', () => {
    expect(randomDeviceId()).not.toBe(randomDeviceId());
  });

  it('replaces a stored value the server would refuse', () => {
    const s = memoryStore({ 'mathquest:v1:device-id': 'short' });
    expect(deviceId(s)).toMatch(/^[0-9a-f]{32}$/);
    const s2 = memoryStore({ 'mathquest:v1:device-id': 'has spaces and is long enough!' });
    expect(deviceId(s2)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('blocked storage still gives a valid id and never throws', () => {
    expect(deviceId(blocked, () => 'a'.repeat(32))).toBe('a'.repeat(32));
    expect(deviceId(null)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('device tiles', () => {
  const pip = { username: 'pip_runner', hero: 'knight', color: 'blue', kind: 'digits' as const };

  it('holds the username, hero, color and kind, and nothing else', () => {
    const s = memoryStore();
    rememberTile({ ...pip, name: 'Pip', kidId: 'k1', familyUid: 'f1' } as never, s);
    expect(readTiles(s)).toEqual([pip]);
    expect(s.raw.get('mathquest:v1:device-tiles')).not.toMatch(/"name"|"kidId"|"familyUid"|"Pip"/);
  });

  it('drops a name a stored tile carries, and a username that is not a username', () => {
    const s = memoryStore({
      'mathquest:v1:device-tiles': JSON.stringify([{ ...pip, name: 'Pip Smith' }, { username: 'Pip Smith', hero: 'knight', color: 'blue' }, { username: 'ab', hero: 'x', color: 'y' }]),
    });
    expect(readTiles(s)).toEqual([pip]);
    expect(JSON.stringify(readTiles(s))).not.toMatch(/Smith/);
  });

  it('lowercases, dedupes, keeps a place, and holds 6', () => {
    const s = memoryStore();
    for (let i = 0; i < 8; i++) rememberTile({ ...pip, username: `kid_${i}` }, s);
    expect(readTiles(s).map((t) => t.username)).toEqual(['kid_2', 'kid_3', 'kid_4', 'kid_5', 'kid_6', 'kid_7']);
    rememberTile({ ...pip, username: 'KID_3', kind: 'pictures' }, s);
    expect(readTiles(s).map((t) => `${t.username}:${t.kind}`)).toContain('kid_3:pictures');
    expect(readTiles(s)).toHaveLength(6);
  });

  it('forgets one tile or all, and survives bad json and blocked storage', () => {
    const s = memoryStore();
    rememberTile(pip, s);
    rememberTile({ ...pip, username: 'maya_stars' }, s);
    forgetTile('PIP_RUNNER', s);
    expect(readTiles(s).map((t) => t.username)).toEqual(['maya_stars']);
    forgetTiles(s);
    expect(readTiles(s)).toEqual([]);
    expect(readTiles(memoryStore({ 'mathquest:v1:device-tiles': '{nope' }))).toEqual([]);
    expect(() => rememberTile(pip, blocked)).not.toThrow();
    expect(readTiles(blocked)).toEqual([]);
  });
});

describe('signin2 switch', () => {
  it('is off unless the server says true, or says pilot and this device opted in', () => {
    const s = memoryStore();
    expect(signin2Active(null, s)).toBe(false);
    expect(signin2Active({ signin2: false, pilot: false }, s)).toBe(false);
    expect(signin2Active({ signin2: false, pilot: true }, s)).toBe(false);
    expect(signin2Active({ signin2: true, pilot: false }, s)).toBe(true);
    applyPilotParam('?signin2=on', s);
    expect(signin2Active({ signin2: false, pilot: true }, s)).toBe(true);
    expect(signin2Active({ signin2: false, pilot: false }, s)).toBe(false);
  });

  it('?signin2=on and =off set and clear the opt-in; other values change nothing', () => {
    const s = memoryStore();
    expect(applyPilotParam('?signin2=on', s)).toBe('on');
    expect(pilotOptedIn(s)).toBe(true);
    expect(applyPilotParam('?signin2=maybe', s)).toBeNull();
    expect(pilotOptedIn(s)).toBe(true);
    expect(applyPilotParam('?signin2=off', s)).toBe('off');
    expect(pilotOptedIn(s)).toBe(false);
    expect(applyPilotParam('', s)).toBeNull();
    expect(() => applyPilotParam('?signin2=on', blocked)).not.toThrow();
    expect(pilotOptedIn(blocked)).toBe(false);
  });

  it('parses only two booleans from an answer', () => {
    expect(parseMode({ signin2: true, pilot: false, extra: 1 })).toEqual({ signin2: true, pilot: false });
    expect(parseMode('yes')).toEqual({ signin2: false, pilot: false });
    expect(parseMode(null)).toEqual({ signin2: false, pilot: false });
    expect(parseMode({ signin2: 'true' })).toEqual({ signin2: false, pilot: false });
  });
});
