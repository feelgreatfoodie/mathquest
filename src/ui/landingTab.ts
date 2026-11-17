export type LandingTab = 'kid' | 'parent';
export const TABS: readonly LandingTab[] = ['kid', 'parent'];
export const TAB_KEY = 'mq-landing-tab';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // blocked storage can throw on access
  }
}

/** The last tab used on this device. Kid is the default; any storage failure falls back to it. */
export function readTab(store: Store | null = defaultStore()): LandingTab {
  try {
    const v = store?.getItem(TAB_KEY);
    return v === 'parent' ? 'parent' : 'kid';
  } catch {
    return 'kid';
  }
}

export function writeTab(tab: LandingTab, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(TAB_KEY, tab);
  } catch {
    /* private window or blocked storage: the tab just is not remembered */
  }
}

/** Arrow keys move between tabs and wrap; Home and End jump to the ends. Other keys return null. */
export function tabForKey(current: LandingTab, key: string): LandingTab | null {
  const i = TABS.indexOf(current);
  if (key === 'ArrowRight' || key === 'ArrowDown') return TABS[(i + 1) % TABS.length]!;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return TABS[(i - 1 + TABS.length) % TABS.length]!;
  if (key === 'Home') return TABS[0]!;
  if (key === 'End') return TABS[TABS.length - 1]!;
  return null;
}
