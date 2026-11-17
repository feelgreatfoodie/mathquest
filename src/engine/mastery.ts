import { Rating, State } from 'ts-fsrs';
import { FACT_CARDS, FACT_GROUPS, SKILL_CARDS, getCardDef, type CardDef, type Track } from './content';
import { thresholdsFor } from './grading';
import { DEFAULT_PACE, type CardMap, type CardState, type KidSettings } from './models';
import { median } from './scheduler';

/** 0 new · 1 learning · 2 reviewing · 3 solid · 4 fluent (solid and fast) */
export type Level = 0 | 1 | 2 | 3 | 4;

export const LEVEL_LABELS: Record<Level, string> = {
  0: 'Not started',
  1: 'Learning',
  2: 'Reviewing',
  3: 'Solid',
  4: 'Fluent',
};

/** FSRS stability (days until recall drops to 90%) needed for each level. */
const REVIEWING_STABILITY_DAYS = 2;
const SOLID_STABILITY_DAYS = 7;
const GROUP_UNLOCK_SHARE = 0.8;

export function cardLevel(state: CardState | undefined, factBaselineMs: number, pace: number): Level {
  if (!state || state.fsrs.reps === 0) return 0;
  if (state.fsrs.state !== State.Review || state.lastRating === Rating.Again) return 1;
  if (state.fsrs.stability < REVIEWING_STABILITY_DAYS) return 1;
  // One lucky answer can't make a card solid: require repeated successful reviews.
  if (state.fsrs.stability < SOLID_STABILITY_DAYS || state.fsrs.reps < 2) return 2;
  if (state.fsrs.reps < 3) return 3;
  const def = getCardDef(state.id);
  const fastMs = def ? thresholdsFor(def, factBaselineMs, pace).fastMs : 0;
  const med = median(state.recentMs);
  return Number.isFinite(med) && med <= fastMs ? 4 : 3;
}

/** Share of a fact group's cards that are at least "reviewing". */
export function groupProgress(groupIndex: number, cards: CardMap): number {
  const group = FACT_CARDS.filter((c) => c.groupIndex === groupIndex);
  const ok = group.filter((c) => cardLevel(cards[c.id], Infinity, DEFAULT_PACE) >= 2).length;
  return group.length ? ok / group.length : 1;
}

/** How many fact groups are open: the parent's setting, plus any earned by progress. */
export function unlockedFactGroups(cards: CardMap, settings: KidSettings): number {
  let n = Math.max(1, Math.min(FACT_GROUPS.length, settings.factGroupsUnlocked));
  while (n < FACT_GROUPS.length && groupProgress(n - 1, cards) >= GROUP_UNLOCK_SHARE) n++;
  return n;
}

function skillReady(id: string, cards: CardMap): boolean {
  const s = cards[id];
  return !!s && s.fsrs.reps >= 3 && cardLevel(s, Infinity, DEFAULT_PACE) >= 2;
}

export function prereqMet(ref: string, cards: CardMap, settings: KidSettings): boolean {
  if (ref.startsWith('facts:')) {
    if (!settings.tracks.facts) return true; // facts handled outside the app
    const idx = FACT_GROUPS.findIndex((g) => `facts:${g.id}` === ref);
    if (idx < settings.factGroupsUnlocked - 1) return true; // parent says these are known
    return groupProgress(idx, cards) >= GROUP_UNLOCK_SHARE;
  }
  return skillReady(ref, cards);
}

/** Every card the kid may see right now, in curriculum order. */
export function availableCards(cards: CardMap, settings: KidSettings): CardDef[] {
  const out: CardDef[] = [];
  if (settings.tracks.facts) {
    const groups = unlockedFactGroups(cards, settings);
    out.push(...FACT_CARDS.filter((c) => c.groupIndex < groups));
  }
  for (const s of SKILL_CARDS) {
    if (!settings.tracks[s.track as Track]) continue;
    if (cards[s.id] || s.prereqs.every((p) => prereqMet(p, cards, settings))) out.push(s);
  }
  return out;
}
