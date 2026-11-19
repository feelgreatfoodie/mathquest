// Pause: a grown-up stops play for one kid or for everyone. Pure rules, no I/O.
//
// Stored at kids/{id}.settings.pause = { on: true, until?: ms, setAt: serverTimestamp }. `until` is an absolute time on the
// SERVER clock (a parent device's estimate of it). `setAt` is stamped by the server, so a device can learn how far its own
// clock is from the server without trusting the device clock. A kid token cannot write `settings`, so only a parent changes it.

/** A pause as the app reads it. `setAt` is server milliseconds, or null while the write is still pending on the writer's device. */
export interface KidPause {
  on: boolean;
  until?: number;
  setAt?: number | null;
}

export type PauseChoice = 'resume' | 'open' | 15 | 30 | 60 | 'morning';

/** The pause a kid device reads from a stored kid doc: `setAt` may be a Firestore Timestamp, a number or missing. */
export function pauseOf(settings: { pause?: unknown } | undefined | null): KidPause | null {
  const raw = settings?.pause;
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as { on?: unknown; until?: unknown; setAt?: unknown };
  if (p.on !== true) return null;
  const setAtRaw = p.setAt as { toMillis?: () => number } | number | null | undefined;
  const setAt = typeof setAtRaw === 'number' ? setAtRaw : setAtRaw && typeof setAtRaw.toMillis === 'function' ? setAtRaw.toMillis() : null;
  const until = typeof p.until === 'number' && Number.isFinite(p.until) ? p.until : undefined;
  return { on: true, ...(until !== undefined ? { until } : {}), setAt };
}

/**
 * True while play is blocked. `serverNow` is the best estimate of the server clock, or null when the device has none.
 * An open-ended pause needs no clock. A timed pause with no estimate stays on (fail closed): it ends when the device
 * gets an estimate that is past `until`, or when a parent resumes.
 */
export function isPaused(pause: KidPause | null | undefined, serverNow: number | null): boolean {
  if (!pause || !pause.on) return false;
  if (pause.until === undefined) return true;
  if (serverNow === null) return true;
  return serverNow < pause.until;
}

/** Milliseconds left on a timed pause, or null when it is open-ended or no clock estimate exists. */
export function msLeft(pause: KidPause | null | undefined, serverNow: number | null): number | null {
  if (!pause || !pause.on || pause.until === undefined || serverNow === null) return null;
  return Math.max(0, pause.until - serverNow);
}

/** The next 7:00 AM in the device's local time, strictly after `now` (device ms). */
export function nextMorning(now: number): number {
  const d = new Date(now);
  d.setHours(7, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * The absolute `until` (server ms) for a parent's choice. `deviceNow` is the parent device's clock and `serverNow` its
 * best estimate of the server clock (null: no estimate, the device clock stands in). 'resume' has no `until`.
 */
export function untilFor(choice: Exclude<PauseChoice, 'resume'>, deviceNow: number, serverNow: number | null): number | undefined {
  const skew = serverNow === null ? 0 : serverNow - deviceNow;
  if (choice === 'open') return undefined;
  if (choice === 'morning') return nextMorning(deviceNow) + skew;
  return deviceNow + skew + choice * 60_000;
}

/**
 * A server-clock estimate that a device clock change cannot move. It anchors a server time to the monotonic timer
 * (`performance.now`), which a clock edit does not touch. Sources, newest wins:
 *  - `live`: a pause set while this device was listening. The server stamped `setAt` a moment ago, so it is the server's now.
 *  - `header`: the `Date` header of a response from the app's own host.
 * With neither, `now()` is null and a timed pause stays on.
 */
export class ServerClock {
  private anchor: { server: number; mono: number } | null = null;
  constructor(private readonly mono: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {}

  /** Anchors the clock to a server time seen right now. */
  sync(serverMs: number): void {
    this.anchor = { server: serverMs, mono: this.mono() };
  }

  /** Moves the clock forward to `serverMs` when it is ahead of the estimate. A stamp the server wrote is never later than the server's now, so this only ever corrects a late estimate. */
  atLeast(serverMs: number): void {
    const cur = this.now();
    if (cur === null || serverMs > cur) this.sync(serverMs);
  }

  /** The server's now, or null before any sync. */
  now(): number | null {
    return this.anchor ? this.anchor.server + (this.mono() - this.anchor.mono) : null;
  }

  reset(): void {
    this.anchor = null;
  }
}

/** The server time from a response `Date` header (whole seconds), or null. */
export function serverMsFromDate(header: string | null | undefined): number | null {
  if (!header) return null;
  const t = Date.parse(header);
  return Number.isFinite(t) ? t : null;
}
