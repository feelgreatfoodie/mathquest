// The build number of this bundle, and the error a stale bundle raises instead of writing.
// vite.config.ts defines __APP_BUILD__ (seconds since the epoch when the bundle was built) and emits the
// same number in dist/version.json. The release script copies it to config/app.minVersion.
// Tests and any build without the define count as current: they are never behind.

declare const __APP_BUILD__: number | undefined;

export const BUILD: number = typeof __APP_BUILD__ === 'number' ? __APP_BUILD__ : Number.MAX_SAFE_INTEGER;

/** What the player sees for a save that was refused or blocked. One message, so repeats do not stack. */
export const SAVE_DENIED_MESSAGE = "Couldn't save. Tap to update or try again.";

export class StaleBuildError extends Error {
  constructor() {
    super(SAVE_DENIED_MESSAGE);
    this.name = 'StaleBuildError';
  }
}

/** A minVersion is a finite number of 0 or more. Anything else (a string, null, NaN) is ignored. */
export function parseMinVersion(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export function isBehind(build: number, min: number | null): boolean {
  return min !== null && build < min;
}

/** True for a write the server refused (rules) or this bundle blocked (too old). */
export function isSaveDenied(err: unknown): boolean {
  if (err instanceof StaleBuildError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'permission-denied' || code === 'firestore/permission-denied';
}
