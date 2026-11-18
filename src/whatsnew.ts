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
  { pr: 29, text: 'Adventure: walk a map with the hero, tap a spot to go there, meet monsters and chests that ask your own review questions, and fight a boss for a key and 10 gems. Hits now lunge, flash and sound off, the combo shows by the monster, and sound has a mute in the top bar. Teach cards and hints have a speaker. Fractions hide the Whole box when it cannot be the answer, and GO jumps to the next empty box. The reader Home shows icons with big numbers and a star for each day played this week, with one rest day that keeps the streak. A parent turns Adventure on for each player in Settings.', setting: true },
  { pr: 27, text: 'A gem vault. Put 10 or more gems in for 3, 7 or 14 days and get a fixed bonus back: 1, 3 or 7 extra for every 10. Break early and every gem you put in comes back, only the bonus is lost. A glowing chest on Home shows when a deposit is ready. The vault opens by the server clock, so changing the iPad clock does nothing. No random rewards. Pre-readers get a picture-and-voice vault of 10 gems for 3 days.', setting: true },
  { pr: 26, text: 'Leaving a round can no longer freeze the screen: if a save fails, you still go back and a note says so. The progress bar only moves forward, even after a retry. After a miss, the right answer shows big in the sum with a check, your answer small and crossed out, and a bigger hint with a speaker that reads it. Each player picks a hero and a color, so the player screen shows each one with their own picture.' },
  { pr: 25, text: 'A round never opens with a preview of a locked group. Pre-readers get no preview in the first 3 questions, readers none in the first 2, and previews never come back to back.', behindTheScenes: true },
  { pr: 24, text: 'A new shop with weapons, gear, pets, adventure items and camp decorations, from 15 to 350 gems. Every price is fixed and shown up front. Buy something, wear it on your hero, and pin one thing to save for: a jar on Home fills as your gems grow. Weapons change how your hero strikes on a correct answer. Nothing makes the math easier.', setting: true },
  { pr: 23, text: 'Gems come in more slowly. A round gives at most 10 gems, and gems earned later in the same day count for less. A parent can set the Gem speed for each player. A round saved by an older copy of the app is cut to 10 gems instead of failing to save.' },
  { pr: 22, text: 'Pre-readers get a picture-only end screen after a round: gems earned, XP and level, the map, and the streak. A tap skips ahead.' },
  { pr: 21, text: 'Rounds always save. An update never interrupts a round.', behindTheScenes: true },
  { pr: 20, text: 'The parent area fits an iPhone: a row of players at the top, two-column stat tiles, a times-table grid you can tap, full-width buttons. Pinch-zoom works for parents. Kids cannot pinch-zoom while they play. A version line at the bottom shows which build is live.' },
  { pr: 19, text: 'A parent can choose which sum group a player starts at for Addition and Subtraction within 10.', setting: true },
  { pr: 18, text: 'PIN screens have no GO key. The 4th digit signs in. A wrong PIN shakes and clears, and typing in the name box no longer enters PIN digits.' },
  { pr: 17, text: 'Practice mixes in a few facts from groups not yet open, shown as a preview. It picks the facts a player is least sure of, a fact repeats at most 3 times a day, and the next group opens after steady work. The parent area shows coverage for each module.' },
  { pr: 16, text: 'Gems can only go down in the same save that buys a hero. A stale screen can no longer erase gems.', behindTheScenes: true },
  { pr: 15, text: 'An old copy of the app shows an update screen. A save that fails now says so, and tapping it tries again.' },
  { pr: 14, text: 'The parent area shows live XP, gems, hero and a gem history. Pre-readers get a hero shop with pictures only.' },
  { pr: 13, text: 'Rules now refuse any save that lowers XP or best combo, or removes a hero.', behindTheScenes: true },
  { pr: 12, text: 'On the pre-reader Home button, a quick tap wiggles the house and says how to go home. Holding for 1.2 seconds goes home.' },
  { pr: 11, text: 'Only one safe write changes a player’s game numbers, so two devices can no longer overwrite each other.', behindTheScenes: true },
  // Older entries stay in the list; the footer shows the newest 10.
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
