// The device-local kid cache: the faces on the Kid sign-in tab. It holds a first name, a hero and a color per kid, in this
// browser's localStorage, and nothing else: no PIN, hash, game, email or family id. Only code that runs after a parent or a
// kid signed in on this device writes it (App.tsx). It reads with no network. Nothing here can ask the server who a family's
// kids are, and a device that never signed in has an empty cache, so it shows the typed name form.

const KEY = 'mathquest:v1:device-kids';
const MAX_KIDS = 8;
const MAX_NAME = 20;

export interface DeviceKid {
  kidId: string;
  name: string;
  hero: string;
  color: string;
  /** The parent set a picture PIN for this kid, so the face opens the picture pad. */
  picture?: boolean;
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

function clean(raw: unknown): DeviceKid | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kidId = str(r.kidId, 64);
  const name = str(r.name, MAX_NAME);
  const hero = str(r.hero, 20);
  const color = str(r.color, 20);
  if (!kidId || !name || !hero || !color) return null;
  return { kidId, name, hero, color, ...(r.picture === true ? { picture: true } : {}) };
}

export function readDeviceKids(store: Store | null = defaultStore()): DeviceKid[] {
  try {
    const raw = store?.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(clean).filter((k): k is DeviceKid => k !== null).slice(0, MAX_KIDS) : [];
  } catch {
    return [];
  }
}

/** Replaces the list, or with `merge` updates the entries named and keeps the rest (a kid session knows only itself). */
export function rememberKids(kids: readonly DeviceKid[], store: Store | null = defaultStore(), opts: { merge?: boolean } = {}): void {
  try {
    const next = kids.map(clean).filter((k): k is DeviceKid => k !== null);
    let out = next;
    if (opts.merge) {
      const old = readDeviceKids(store);
      // Kids already there keep their place; new ones go last.
      out = [...old.map((o) => next.find((n) => n.kidId === o.kidId) ?? o), ...next.filter((n) => !old.some((o) => o.kidId === n.kidId))];
    }
    store?.setItem(KEY, JSON.stringify(out.slice(0, MAX_KIDS)));
  } catch {
    // A full or blocked store only means the faces are not remembered.
  }
}

export function forgetDeviceKids(store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // nothing to do
  }
}

/** The picture PIN: 9 icons, 4 in a row, repeats allowed. The server hashes the string of letters a to i. */
export const PICTURE_ICONS = 9;
export const PICTURE_LENGTH = 4;

export function pictureCode(icons: readonly number[]): string {
  if (icons.length !== PICTURE_LENGTH || icons.some((n) => !Number.isInteger(n) || n < 0 || n >= PICTURE_ICONS)) {
    throw new Error('A picture PIN is 4 icons from 0 to 8.');
  }
  return icons.map((n) => String.fromCharCode(97 + n)).join('');
}
