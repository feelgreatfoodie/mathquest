// The deviceId: a random 128-bit id this browser keeps in localStorage and sends on every kidSignIn and passcodeKind call.
// The server counts wrong tries per device and lists a family's devices with it. It is random, so it names no person and
// no hardware. Blocked storage gives an id that lasts until the page closes (the server then sees a new device per load).

const KEY = 'mathquest:v1:device-id';
/** The server's own shape check (functions/src/core.ts DEVICE_RE). */
const VALID = /^[A-Za-z0-9_-]{16,64}$/;

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const defaultStore = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** 16 random bytes as 32 hex characters. */
export function randomDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let memo: string | null = null;

/** The stored id, or a new one saved now. Same value for the life of the page even when storage is blocked. */
export function deviceId(store: Store | null = defaultStore(), make: () => string = randomDeviceId): string {
  try {
    const stored = store?.getItem(KEY);
    if (stored && VALID.test(stored)) return stored;
  } catch {
    // fall through to a new id
  }
  const id = store === defaultStore() && memo && VALID.test(memo) ? memo : make();
  try {
    store?.setItem(KEY, id);
  } catch {
    // blocked or full: the id lives in memory for this page load
  }
  if (store === defaultStore()) memo = id;
  return id;
}

/** Tests only: forget the in-memory id. */
export const resetDeviceIdMemo = () => {
  memo = null;
};
