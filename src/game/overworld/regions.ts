import { cardLevel, steadyShare, unlockedFactGroups } from '../../engine/mastery';
import { DEFAULT_PACE, modulesOf, type CardMap, type KidSettings } from '../../engine/models';
import { FACTS } from '../../engine/modules/facts';
import type { RegionId } from './maps';

/**
 * Which times-table groups each region covers (1-based, inclusive). The regions follow the module's unlock ladder:
 * a gate opens when `unlockedFactGroups` reaches the first group of the region behind it.
 */
export const REGION_GROUPS: Record<RegionId, readonly [number, number]> = { meadow: [1, 2], forest: [3, 3], castle: [4, 5] };

/** The region behind a region's forward gate, or null for the last. */
export const NEXT_REGION: Record<RegionId, RegionId | null> = { meadow: 'forest', forest: 'castle', castle: null };
export const PREV_REGION: Record<RegionId, RegionId | null> = { meadow: null, forest: 'meadow', castle: 'forest' };
export const REGION_NAMES: Record<RegionId, string> = { meadow: 'Meadow', forest: 'Forest', castle: 'Castle' };

const reviewing = (cards: CardMap, id: string) => cardLevel(cards[id], Infinity, DEFAULT_PACE) >= 2;

function groupCards(region: RegionId): string[] {
  const [from, to] = REGION_GROUPS[region];
  return (FACTS.groups ?? []).slice(from - 1, to).flatMap((g) => g.cardIds);
}

export interface GateInfo {
  open: boolean;
  /** Cards in the groups before the gate that are Reviewing or better. */
  learned: number;
  /** Cards in the groups before the gate. */
  total: number;
  label: string;
}

/**
 * The gate that leads into `region`. It is open when the kid's open fact groups reach the region's first group. With
 * the times tables off there is no ladder to follow, so every gate is open.
 */
export function gateInfo(region: RegionId, cards: CardMap, settings: KidSettings): GateInfo {
  const first = REGION_GROUPS[region][0];
  const before = (FACTS.groups ?? []).slice(0, first - 1).flatMap((g) => g.cardIds);
  const learned = before.filter((id) => reviewing(cards, id)).length;
  const base = { learned, total: before.length, label: `${learned} of ${before.length} learned` };
  if (first <= 1 || !modulesOf(settings).facts) return { open: true, ...base };
  return { open: unlockedFactGroups(cards, settings) >= first, ...base };
}

/** The region's card ids, in group order. */
export function regionCardIds(region: RegionId): string[] {
  return groupCards(region);
}

export interface RegionCount {
  /** Cards at cardLevel 2 or more (Reviewing or better). */
  reviewing: number;
  /** Cards seen whose last 2 graded answers were both right. */
  steady: number;
  /** The larger of the two: what the lair gate and its bar show. */
  done: number;
  total: number;
  share: number;
}

/**
 * How ready a region is. A card counts as ready by either rule: its FSRS stability has reached Reviewing, or it was seen
 * and its last two graded answers were right. The two are counted apart and the larger count is the one that shows,
 * because the steady rule is the second way a group opens in `unlockedGroups`.
 */
export function regionProgress(region: RegionId, cards: CardMap): RegionCount {
  const ids = groupCards(region);
  const reviewingN = ids.filter((id) => reviewing(cards, id)).length;
  const steadyN = ids.length ? Math.round(steadyShare(ids, cards) * ids.length) : 0;
  const done = Math.max(reviewingN, steadyN);
  return { reviewing: reviewingN, steady: steadyN, done, total: ids.length, share: ids.length ? done / ids.length : 0 };
}

/** The facts of a region in words: "6s, 7s, 8s and 12x12". A group of one card is named by its fact. */
export function regionFactsText(region: RegionId): string {
  const [from, to] = REGION_GROUPS[region];
  const parts = (FACTS.groups ?? []).slice(from - 1, to).flatMap((g) => {
    if (g.cardIds.length === 1) {
      const m = /^mul:(\d+)x(\d+)$/.exec(g.cardIds[0]!);
      if (m) return [`${m[1]}x${m[2]}`];
    }
    return g.label.split(/,\s*|\s+and\s+/).filter(Boolean);
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join('');
}

/** The words the locked lair shows a reader. */
export function lairMessage(region: RegionId, ready: number, total: number): string {
  return `Answer the ${REGION_NAMES[region]} facts to wake the dragon: ${regionFactsText(region)}. ${ready} of ${total} ready.`;
}
