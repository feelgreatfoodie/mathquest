// The first-screen switch (config/app.signin2), as the client reads it. A signed-out device cannot read config/app, so the
// signinMode callable answers { signin2, pilot }. signin2: true is on for every device. pilot: this device is on only when it
// opted in: open the app once with ?signin2=on (and ?signin2=off to leave). That is how one family's devices go first.
// Anything unclear is off, and off is the screen players know today.

const PILOT_KEY = 'mathquest:v1:signin2-pilot';

export interface SigninMode {
  signin2: boolean;
  pilot: boolean;
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

/** Reads ?signin2=on|off from a query string and saves the choice on this device. Returns what it set, or null. */
export function applyPilotParam(search: string, store: Store | null = defaultStore()): 'on' | 'off' | null {
  const v = new URLSearchParams(search).get('signin2');
  try {
    if (v === 'on') {
      store?.setItem(PILOT_KEY, '1');
      return 'on';
    }
    if (v === 'off') {
      store?.removeItem(PILOT_KEY);
      return 'off';
    }
  } catch {
    // blocked storage: the device stays off
  }
  return null;
}

export function pilotOptedIn(store: Store | null = defaultStore()): boolean {
  try {
    return store?.getItem(PILOT_KEY) === '1';
  } catch {
    return false;
  }
}

/** True when this device shows the two-door first screen. */
export function signin2Active(mode: SigninMode | null, store: Store | null = defaultStore()): boolean {
  if (!mode) return false;
  return mode.signin2 === true || (mode.pilot === true && pilotOptedIn(store));
}

/** Reads the callable's answer defensively: only the two booleans, and anything else is off. */
export function parseMode(raw: unknown): SigninMode {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { signin2: r.signin2 === true, pilot: r.pilot === true };
}
