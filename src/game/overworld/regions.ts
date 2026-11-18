import { cardLevel, unlockedFactGroups } from '../../engine/mastery';
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

export const BOSS_SHARE = 0.8;

/** The share of a region's cards that are Reviewing or better. */
export function regionProgress(region: RegionId, cards: CardMap): { done: number; total: number; share: number } {
  const ids = groupCards(region);
  const done = ids.filter((id) => reviewing(cards, id)).length;
  return { done, total: ids.length, share: ids.length ? done / ids.length : 0 };
}
