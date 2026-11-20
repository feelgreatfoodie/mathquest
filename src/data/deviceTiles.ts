// The device-local player tiles on the first screen (signin2). A tile holds the USERNAME, a hero, a color and which pad the
// player types on. It never holds a display name, a kid id, a family id, a PIN or a hash. The screen shows the hero picture
// only, so a signed-out device shows no name. A tile skips typing the username, never the passcode. Only code that runs after
// a successful username sign-in writes it (App.tsx). The older cache (deviceKids.ts) holds names and is cleared when signin2 is on.

const KEY = 'mathquest:v1:device-tiles';
const MAX_TILES = 6;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export type PasscodeKind = 'digits' | 'pictures';

export interface DeviceTile {
  username: string;
  hero: string;
  color: string;
  kind: PasscodeKind;
}

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const defaultStore = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Keeps the four known fields and drops everything else, so a stray `name` in storage never reaches the screen. */
function clean(raw: unknown): DeviceTile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const username = str(r.username, 20).toLowerCase();
  const hero = str(r.hero, 20);
  const color = str(r.color, 20);
  if (!USERNAME_RE.test(username) || !hero || !color) return null;
  return { username, hero, color, kind: r.kind === 'pictures' ? 'pictures' : 'digits' };
}

export function readTiles(store: Store | null = defaultStore()): DeviceTile[] {
  try {
    const raw = store?.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    const seen = new Set<string>();
    return (Array.isArray(list) ? list : [])
      .map(clean)
      .filter((t): t is DeviceTile => t !== null && !seen.has(t.username) && !!seen.add(t.username))
      .slice(0, MAX_TILES);
  } catch {
    return [];
  }
}

/** Adds or updates one tile. A tile already there keeps its place; a new one goes last. The oldest falls off at 6. */
export function rememberTile(tile: DeviceTile, store: Store | null = defaultStore()): void {
  try {
    const next = clean(tile);
    if (!next) return;
    const old = readTiles(store);
    const out = old.some((o) => o.username === next.username) ? old.map((o) => (o.username === next.username ? next : o)) : [...old, next];
    store?.setItem(KEY, JSON.stringify(out.slice(-MAX_TILES)));
  } catch {
    // A full or blocked store only means the tile is not remembered.
  }
}

export function forgetTile(username: string, store: Store | null = defaultStore()): void {
  try {
    const out = readTiles(store).filter((t) => t.username !== username.trim().toLowerCase());
    store?.setItem(KEY, JSON.stringify(out));
  } catch {
    // nothing to do
  }
}

export function forgetTiles(store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
