// The Grown-ups tour: what each step points at and says. A step whose section is missing for this player (a Learning progress
// panel with no ladder, a vault that is off) is skipped. Plain words, no dashes.

export interface TourStep {
  id: string;
  title: string;
  text: string;
  /** Tried in order; the first match in the page is the spotlight. */
  selectors: readonly string[];
  /** The spotlight grows to this ancestor (a setting's label, not just its checkbox). */
  closest?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'kids',
    title: 'Pick a player',
    text: 'Each player has a tab. Tap a name to see that player’s numbers, settings and history. Plus Add player makes a new one.',
    selectors: ['[data-tour="kids"]'],
  },
  {
    id: 'stats',
    title: 'The numbers at a glance',
    text: 'XP, gems, level and streak. The streak counts days played in a row, and one rest day does not break it. Earned today shows how many gems today’s play has paid.',
    selectors: ['[data-tour="stats"]'],
  },
  {
    id: 'pause',
    title: 'Pause play',
    text: 'Pause stops one player for 15, 30 or 60 minutes, until tomorrow morning, or until you resume. Pause everyone, at the top, stops all players. The question on screen finishes first and nothing is lost.',
    selectors: ['[data-testid="pause-card"]', '[data-testid="pause-everyone"]'],
  },
  {
    id: 'progress',
    title: 'Learning progress',
    text: 'Every fact is a colored square, from not seen to fluent. Grey is not started, amber needs work and green is strong. Under it, the group ladder shows how facts unlock: a group opens when 80% of the one before it is steady.',
    selectors: ['[data-testid="insights"]'],
  },
  {
    id: 'needs-work',
    title: 'Needs work and practice balance',
    text: 'Needs work lists the facts that keep slipping or come back slow. Practice balance shows which facts got the most and the least practice, so you can see what the game is leaning on.',
    selectors: ['[data-testid="ins-needs-work"]', '[data-testid="ins-balance"]'],
  },
  {
    id: 'runs',
    title: 'Recent runs',
    text: 'Each round and each Adventure trip, with its mode, how many answers were right and how long it took. A run from an old app version is marked, so a device that needs a reload stands out.',
    selectors: ['[data-tour="runs"]'],
  },
  {
    id: 'settings',
    title: 'Settings for this player',
    text: 'Learner mode (reader or pre-reader), which modules are on, where to start, how long a round is and how many new facts come in each round. Press Save at the bottom to keep changes.',
    selectors: ['[data-tour="settings"]'],
  },
  {
    id: 'extras',
    title: 'Shop, vault, Gem speed and Adventure',
    text: 'Turn the item shop, the gem vault and Adventure on or off for this player. Gem speed sets how fast gems are earned. A change reaches the player’s device the next time it opens.',
    selectors: ['[data-testid="setting-adventure"]', '[data-testid="setting-vault"]'],
    closest: 'label',
  },
  {
    id: 'voice',
    title: 'Voice, sound and PINs',
    text: 'Voice and Sounds say whether this player hears the game read aloud and hears chimes. Lower down, the sign-in PIN lets this player sign in on their own, and the Grown-up PIN guards this area.',
    selectors: ['[data-testid="setting-voice"]', '[data-testid="setting-sounds"]'],
    closest: 'label',
  },
  {
    id: 'version',
    title: 'Version and What’s new',
    text: 'The app version this device runs, and the last 10 changes in plain words. If a player’s device shows an older version, reload the app there.',
    selectors: ['.version-footer'],
  },
];

/** The steps whose target is in the page, in order, with the element for each. */
export function resolveSteps(root: ParentNode): { step: TourStep; el: HTMLElement }[] {
  const out: { step: TourStep; el: HTMLElement }[] = [];
  for (const step of TOUR_STEPS) {
    let found: HTMLElement | null = null;
    for (const sel of step.selectors) {
      const hit = root.querySelector<HTMLElement>(sel);
      if (hit) {
        found = (step.closest ? hit.closest<HTMLElement>(step.closest) : null) ?? hit;
        break;
      }
    }
    if (found) out.push({ step, el: found });
  }
  return out;
}
