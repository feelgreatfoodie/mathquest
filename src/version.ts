// The build number of this bundle and the message for a refused save.
// vite.config.ts defines __APP_BUILD__ (seconds since the epoch when the bundle was built) and emits the
// same number in dist/version.json. scripts/set-min-version.mjs copies it to config/app.minVersion, by hand, only when a release breaks older clients.
// Tests and any build without the define count as current: they are never behind.

declare const __APP_BUILD__: number | undefined;

export const BUILD: number = typeof __APP_BUILD__ === 'number' ? __APP_BUILD__ : Number.MAX_SAFE_INTEGER;

/** What the player sees for a save that was refused or blocked. One message, so repeats do not stack. */
export const SAVE_DENIED_MESSAGE = "Couldn't save. Tap to update or try again.";

/** A minVersion is a finite number of 0 or more. Anything else (a string, null, NaN) is ignored. */
export function parseMinVersion(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export function isBehind(build: number, min: number | null): boolean {
  return min !== null && build < min;
}

/** True for a write the server refused (rules). */
export function isSaveDenied(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'permission-denied' || code === 'firestore/permission-denied';
}
