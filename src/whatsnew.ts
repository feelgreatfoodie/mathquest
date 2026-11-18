// What's new: the last 10 merged changes in plain words, newest first. Every PR that changes src/ adds its line here
// (CI check: scripts/check-whatsnew.mjs). Mark a change kids cannot see with behindTheScenes, and a change behind a
// parent setting with setting. No kid names.

declare const __APP_SHA__: string | undefined;
declare const __APP_BUILD__: number | undefined;

export interface WhatsNewEntry {
  pr: number;
  text: string;
  /** Kids cannot see it. */
  behindTheScenes?: boolean;
  /** Off until a parent turns it on. */
  setting?: boolean;
}

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  { pr: 20, text: 'The parent area fits an iPhone: a row of players at the top, two-column stat tiles, a times-table grid you can tap, full-width buttons. Pinch-zoom works for parents. Kids cannot pinch-zoom while they play. A version line at the bottom shows which build is live.' },
  { pr: 19, text: 'A parent can choose which sum group a player starts at for Addition and Subtraction within 10.', setting: true },
  { pr: 18, text: 'PIN screens have no GO key. The 4th digit signs in. A wrong PIN shakes and clears, and typing in the name box no longer enters PIN digits.' },
  { pr: 16, text: 'Gems can only go down in the same save that buys a hero. A stale screen can no longer erase gems.', behindTheScenes: true },
  { pr: 15, text: 'An old copy of the app shows an update screen. A save that fails now says so, and tapping it tries again.' },
  { pr: 14, text: 'The parent area shows live XP, gems, hero and a gem history. Pre-readers get a hero shop with pictures only.' },
  { pr: 13, text: 'Rules now refuse any save that lowers XP or best combo, or removes a hero.', behindTheScenes: true },
  { pr: 12, text: 'On the pre-reader Home button, a quick tap wiggles the house and says how to go home. Holding for 1.2 seconds goes home.' },
  { pr: 11, text: 'Only one safe write changes a player’s game numbers, so two devices can no longer overwrite each other.', behindTheScenes: true },
  { pr: 10, text: 'The Dungeon run and the pre-reader run now share one engine. The game looks the same.', behindTheScenes: true },
];

export const entryText = (e: WhatsNewEntry): string =>
  `${e.text}${e.behindTheScenes ? ' (behind the scenes)' : ''}${e.setting ? ' (turn on in Settings)' : ''}`;

export const recentChanges = (): readonly WhatsNewEntry[] => WHATS_NEW.slice(0, 10);

/** The short commit and the build time, injected by Vite define at build time. */
export const BUILD_SHA: string = typeof __APP_SHA__ === 'string' ? __APP_SHA__ : 'dev';
const BUILD_SECONDS: number | null = typeof __APP_BUILD__ === 'number' && __APP_BUILD__ < 1e11 ? __APP_BUILD__ : null;

export function buildLabel(sha: string = BUILD_SHA, seconds: number | null = BUILD_SECONDS): string {
  const when = seconds
    ? new Date(seconds * 1000).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'now (dev)';
  return `Version ${sha} · built ${when}`;
}
