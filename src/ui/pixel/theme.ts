// The Grown-ups light theme. One switch for each parent, off by default, kept on this device only (localStorage).
// A parent is the signed-in account (its uid), or "local" in the offline demo, so two parents on one device keep their own choice.
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type Theme = 'dark' | 'light';

export const themeKey = (parentKey: string) => `mq-theme:${parentKey}`;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readTheme(parentKey: string, store: Store | null = defaultStore()): Theme {
  try {
    return store?.getItem(themeKey(parentKey)) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function writeTheme(parentKey: string, theme: Theme, store: Store | null = defaultStore()): void {
  try {
    if (theme === 'light') store?.setItem(themeKey(parentKey), 'light');
    else store?.removeItem(themeKey(parentKey));
  } catch {
    /* blocked storage: the choice is just not remembered */
  }
}
