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
  { pr: 42, text: 'A mute button on every pre-reader screen: Picture Run, the pre-reader Home and the end screen, 120 pixels wide, the same button Dungeon and Adventure use. One choice per player on each device: muting in one place mutes everywhere, and it silences the voice and the chimes. While muted, a Hear it speaker says the question once per tap and never plays by itself. In the parent area, Settings has Voice (player\'s choice, which is the default, on, or off) and Sounds (on or off) for each player. On keeps the voice speaking and the mute button silences the chimes only, with a bell icon. Off is silent and the player cannot turn it back on, and Hear it is hidden. Players with the old sound switch off stay silent.' },
  { pr: 41, text: 'The Forest and the Castle look and play like new places. The Forest is thick with dark trees, a winding path and a narrow stream you cross on a log bridge. The Castle has stone floors, a red carpet road, courtyard walls with torches, and a moat you cross on a drawbridge. The Meadow stays as it was. Your place, your chests, your keys and your dragons are all kept: if you were standing where a wall or the moat now is, you start at the beginning of that land.' },
  { pr: 40, text: 'Adventure fits older iPads held sideways. The map no longer depends on the size of its drawing surface, so the Home button, the sound button and the walk arrows stay on screen when the iPad turns. Pre-readers get Home, sound and walk arrows 120 pixels wide, and always see at least 11 by 7 squares of map, with the tiles shrinking before the buttons do. The gold trail to the campfire is gone; "Camp is lit!" and the voice that says where to walk stay.' },
  { pr: 39, text: 'Practice rounds read right. When every fact has had its 3 graded answers for the day, the end screen no longer says "0/0 correct": it shows the right answers out of all the answers, practice included, with a line saying it was a practice round, and pre-readers get stars and a voice for it. Practice rounds now pick facts that have rested for an hour first, so they repeat less. Every saved run records which app version played it, and the parent area marks a run from an old app version with "old app version", so a device that has not reloaded stands out.' },
  { pr: 37, text: 'Adventure fixes. The Castle wall no longer has an opening that leads nowhere: its far edge is a closed door that says “More lands coming soon”. A lair now also opens when 80% of its facts are steady (seen, with the last 2 answers right), not only when they have held for days, and a locked lair says which facts to answer, like “6s, 7s, 8s and 12x12. 8 of 10 ready”. Pre-readers get a dragon, dots and a voice instead of words. When the campfire lights, a gold trail points the way and a voice says where to walk. A lair pays its gems and key once.' },
  { pr: 36, text: 'Practice questions now count. When every fact has had its 3 graded answers for the day, a round fills up with practice questions, and those used to earn no gems. Right answers on them now count toward gems at the same daily rate, with at least 1 gem for a round with any right answer. The parent area shows such a round as answers, right and practice, so it no longer looks empty.' },
  { pr: 35, text: 'Adventure trips are saved as you play. Every 10 answers, and whenever the app goes to the background or closes, the trip is written as one run with its XP, so leaving without walking to the campfire loses nothing. The parent area shows each run with its mode, and an Adventure trip as in progress, finished or left early, with its region. A new line under Recent runs says how far the map has been explored. Learning progress reads fresh when the parent area opens and when you switch players.' },
  { pr: 34, text: 'Adventure is on for every player. Readers and pre-readers now see an Adventure button on Home next to the usual run. Pre-readers walk the same map, and every monster or chest asks the same picture question with dots or a ten-frame, 3 big choices and a voice. Gems and the daily limit work as before. A parent can turn Adventure off for a player in Settings.' },
  { pr: 32, text: 'A shop math card on Home: a practice sum with your own gems, like "You have 47. The bow costs 60. How many more?". It uses the thing you are saving for, or the cheapest thing still out of reach. A right first answer earns a 1-gem tip, up to 3 a day. A wrong answer shows the right one and costs nothing. Pre-readers get the same idea with dots, within 10, and a voice. It never changes the review schedule. A parent turns it on for each player in Settings, next to the item shop.', setting: true },
  { pr: 31, text: 'A Learning progress panel in the parent area, under the stat tiles. It shows each fact as a colored square (not seen to fluent, with a dot for facts met early in a preview), the group ladder with the 80% unlock marker, how many new facts came each day, which facts got the most and least practice, the facts that need work, and accuracy and speed over 14 days. Alerts at the top flag a stuck group, facts asked once and missed, and one fact practiced more than 3 times in a day. Parents only. Nothing changes for players.', behindTheScenes: true },
  { pr: 30, text: 'A picture PIN for players who cannot read digits yet. A parent picks 4 of 9 animal pictures for a player, and that player taps their face on the Kid tab, then the 4 pictures, to sign in. The faces are remembered on each device after someone signs in there, and nothing is shown on a device that never signed in. The digit PIN still works, and picture tries count toward the same wrong-try limits.', setting: true },
  { pr: 29, text: 'Adventure: walk a map with the hero, tap a spot to go there, meet monsters and chests that ask your own review questions, and fight a boss for a key and gems. Hits now lunge, flash and sound off, the combo shows by the monster, and sound has a mute in the top bar. Teach cards and hints have a speaker. Fractions hide the Whole box when it cannot be the answer, and GO jumps to the next empty box. The reader Home shows icons with big numbers and a star for each day played this week, with one rest day that keeps the streak. A parent turns Adventure on for each player in Settings.', setting: true },
  { pr: 28, text: 'Vault payouts pay each gem once and pick up where they stopped. If the app closes in the middle of a collect, the rest arrives the next time the vault opens, and two devices collecting at once never pay twice. A parent can set the vault bonus from 0 to 10 extra per 10 gems.', setting: true },
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
