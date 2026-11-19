// The CRT scanline overlay. One switch for each kid, off by default, kept on this device only (localStorage).
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const crtKey = (kidId: string) => `mq-crt:${kidId}`;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readCrt(kidId: string, store: Store | null = defaultStore()): boolean {
  try {
    return store?.getItem(crtKey(kidId)) === '1';
  } catch {
    return false;
  }
}

export function writeCrt(kidId: string, on: boolean, store: Store | null = defaultStore()): void {
  try {
    if (on) store?.setItem(crtKey(kidId), '1');
    else store?.removeItem(crtKey(kidId));
  } catch {
    /* blocked storage: the switch just is not remembered */
  }
}

/** Sets or clears the overlay on the page. Pass no kid (signed out, picker) to clear it. */
export function applyCrt(on: boolean, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!root) return;
  if (on) root.dataset.crt = 'on';
  else delete root.dataset.crt;
}
