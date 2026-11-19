import { describe, expect, it } from 'vitest';
import { normalizeKid, type Kid } from './models';
import { isPaused, msLeft, nextMorning, pauseOf, ServerClock, serverMsFromDate, untilFor } from './pause';

// Every name, id and number here is made up.
const T0 = 1_800_000_000_000;

describe('pauseOf', () => {
  it('reads a stored pause, with a Firestore-like Timestamp for setAt', () => {
    expect(pauseOf({ pause: { on: true, until: T0 + 5, setAt: { toMillis: () => T0 } } })).toEqual({ on: true, until: T0 + 5, setAt: T0 });
    expect(pauseOf({ pause: { on: true, setAt: T0 } })).toEqual({ on: true, setAt: T0 });
  });
  it('reads a pending write (no setAt yet) as setAt null', () => {
    expect(pauseOf({ pause: { on: true, setAt: null } })).toEqual({ on: true, setAt: null });
  });
  it('reads no pause, an off pause and junk as null', () => {
    expect(pauseOf(undefined)).toBeNull();
    expect(pauseOf({})).toBeNull();
    expect(pauseOf({ pause: { on: false } })).toBeNull();
    expect(pauseOf({ pause: 'yes' })).toBeNull();
    expect(pauseOf({ pause: { on: 'true' } })).toBeNull();
  });
  it('drops a non-numeric until, so a bad value reads as open-ended (blocked), never as free', () => {
    expect(pauseOf({ pause: { on: true, until: 'soon', setAt: T0 } })).toEqual({ on: true, setAt: T0 });
  });
});

describe('isPaused', () => {
  it('no pause is not paused', () => {
    expect(isPaused(null, T0)).toBe(false);
    expect(isPaused({ on: false }, T0)).toBe(false);
  });
  it('an open-ended pause holds with or without a clock', () => {
    expect(isPaused({ on: true, setAt: T0 }, null)).toBe(true);
    expect(isPaused({ on: true, setAt: T0 }, T0 + 10 ** 9)).toBe(true);
  });
  it('a timed pause holds until the server time passes until', () => {
    const p = { on: true, until: T0 + 60_000, setAt: T0 };
    expect(isPaused(p, T0 + 59_999)).toBe(true);
    expect(isPaused(p, T0 + 60_000)).toBe(false);
  });
  it('fail closed: a timed pause with no clock estimate stays on', () => {
    expect(isPaused({ on: true, until: T0 - 10 ** 9, setAt: T0 - 10 ** 9 - 1 }, null)).toBe(true);
  });
  it('msLeft is null for open-ended or no clock, and never negative', () => {
    expect(msLeft({ on: true, setAt: T0 }, T0)).toBeNull();
    expect(msLeft({ on: true, until: T0 + 5, setAt: T0 }, null)).toBeNull();
    expect(msLeft({ on: true, until: T0 + 5, setAt: T0 }, T0 + 9)).toBe(0);
    expect(msLeft({ on: true, until: T0 + 5000, setAt: T0 }, T0)).toBe(5000);
  });
});

describe('ServerClock: a device clock change cannot move it', () => {
  it('is null before any sync', () => {
    expect(new ServerClock(() => 0).now()).toBeNull();
  });
  it('counts on the monotonic timer, so the wall clock is never read', () => {
    let mono = 1000;
    const c = new ServerClock(() => mono);
    c.sync(T0);
    mono += 30_000;
    // Date.now() could jump a day here; the clock does not look at it.
    expect(c.now()).toBe(T0 + 30_000);
    const wall = Date.now;
    Date.now = () => wall() + 86_400_000;
    try {
      expect(c.now()).toBe(T0 + 30_000);
      expect(isPaused({ on: true, until: T0 + 60_000, setAt: T0 }, c.now())).toBe(true);
    } finally {
      Date.now = wall;
    }
  });
  it('atLeast only moves forward', () => {
    let mono = 0;
    const c = new ServerClock(() => mono);
    c.sync(T0);
    c.atLeast(T0 - 5000);
    expect(c.now()).toBe(T0);
    c.atLeast(T0 + 5000);
    expect(c.now()).toBe(T0 + 5000);
  });
  it('atLeast with no estimate sets one', () => {
    const c = new ServerClock(() => 0);
    c.atLeast(T0);
    expect(c.now()).toBe(T0);
  });
  it('reads a Date header', () => {
    expect(serverMsFromDate('Wed, 18 Nov 2026 20:00:00 GMT')).toBe(Date.UTC(2026, 10, 18, 20, 0, 0));
    expect(serverMsFromDate(null)).toBeNull();
    expect(serverMsFromDate('nope')).toBeNull();
  });
});

describe('untilFor', () => {
  it('minutes add to the server clock, not the device clock', () => {
    // The device is 10 minutes ahead of the server.
    expect(untilFor(30, T0 + 600_000, T0)).toBe(T0 + 30 * 60_000);
  });
  it('with no estimate the device clock stands in', () => {
    expect(untilFor(15, T0, null)).toBe(T0 + 15 * 60_000);
  });
  it('open has no until', () => {
    expect(untilFor('open', T0, T0)).toBeUndefined();
  });
  it('morning is the next 7 AM local, always in the future', () => {
    const n = nextMorning(T0);
    expect(n).toBeGreaterThan(T0);
    expect(new Date(n).getHours()).toBe(7);
    expect(new Date(n).getMinutes()).toBe(0);
    expect(n - T0).toBeLessThanOrEqual(25 * 3_600_000);
    const at7 = new Date(T0);
    at7.setHours(7, 0, 0, 0);
    expect(nextMorning(at7.getTime())).toBeGreaterThan(at7.getTime());
  });
});

describe('normalizeKid keeps the pause readable', () => {
  const kid = (settings: object): Kid => ({ id: 'k1', name: 'Pip', createdAt: 1, settings, game: {} } as unknown as Kid);
  it('turns a stored Timestamp into milliseconds', () => {
    const k = normalizeKid(kid({ sessionSize: 10, pause: { on: true, until: T0, setAt: { toMillis: () => T0 - 1 } } }));
    expect(k.settings.pause).toEqual({ on: true, until: T0, setAt: T0 - 1 });
  });
  it('a kid with no pause gets no pause key', () => {
    expect('pause' in normalizeKid(kid({ sessionSize: 10 })).settings).toBe(false);
  });
});
