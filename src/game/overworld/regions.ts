import { GROUP_UNLOCK_SHARE, cardLevel, groupProgress, groupSteady, steadyShare, unlockedGroups } from '../../engine/mastery';
import { DEFAULT_PACE, DEFAULT_SETTINGS, learnerOf, modulesOf, type CardMap, type KidSettings } from '../../engine/models';
import { FACTS } from '../../engine/modules/facts';
import { MODULES, type ModuleDef } from '../../engine/modules';
import { REGION_IDS, type RegionId } from './maps';

/**
 * The times-table mapping the regions had before they followed the kid's modules (1-based, inclusive). `regionCards`
 * returns exactly this for a kid whose only module with groups is the times tables. Nothing else reads it.
 */
export const REGION_GROUPS: Record<RegionId, readonly [number, number]> = { meadow: [1, 2], forest: [3, 3], castle: [4, 5] };

/** The region behind a region's forward gate, or null for the last. */
export const NEXT_REGION: Record<RegionId, RegionId | null> = { meadow: 'forest', forest: 'castle', castle: null };
export const PREV_REGION: Record<RegionId, RegionId | null> = { meadow: null, forest: 'meadow', castle: 'forest' };
export const REGION_NAMES: Record<RegionId, string> = { meadow: 'Meadow', forest: 'Forest', castle: 'Castle' };

const reviewing = (cards: CardMap, id: string) => cardLevel(cards[id], Infinity, DEFAULT_PACE) >= 2;

/** One step of the kid's ladder: a module group (or all the cards of a module with no groups), in curriculum order. */
interface Rung {
  /** Words for the lair text. */
  names: string[];
  cardIds: string[];
  /** The kid is past this rung: the next group of its module is open, or it is the module's last and 80% is in. */
  cleared: (cards: CardMap, settings: KidSettings) => boolean;
}

function groupRung(mod: ModuleDef, index: number): Rung {
  const g = mod.groups![index]!;
  const last = index === mod.groups!.length - 1;
  return {
    names: mod.id === 'facts' ? factNames(g.cardIds, g.label) : [g.label],
    cardIds: g.cardIds,
    cleared: (cards, settings) => {
      const n = unlockedGroups(mod, cards, settings);
      if (n <= index) return false;
      if (n > index + 1) return true;
      return last && ((learnerOf(settings) !== 'prereader' && groupProgress(mod, index, cards) >= GROUP_UNLOCK_SHARE) || groupSteady(mod, index, cards) >= GROUP_UNLOCK_SHARE);
    },
  };
}

/** A group of one card is named by its fact ("12x12"); other groups by their label split into parts ("6s", "7s", "8s"). */
function factNames(cardIds: string[], label: string): string[] {
  if (cardIds.length === 1) {
    const m = /^mul:(\d+)x(\d+)$/.exec(cardIds[0]!);
    if (m) return [`${m[1]}x${m[2]}`];
  }
  return label.split(/,\s*|\s+and\s+/).filter(Boolean);
}

/**
 * The kid's ladder: the groups of every module that is on, in registry order, so a module added to the registry later
 * joins at the end. A kid with no module that has groups (multidigit or fractions only) gets one rung of those cards.
 * A kid with no module on gets the times tables, as before.
 */
function ladderOf(settings: KidSettings): Rung[] {
  const on = modulesOf(settings);
  const rungs: Rung[] = [];
  for (const mod of MODULES) {
    if (on[mod.id] && mod.groups?.length) mod.groups.forEach((_, i) => rungs.push(groupRung(mod, i)));
  }
  if (rungs.length) return rungs;
  const loose = MODULES.filter((m) => on[m.id]);
  if (!loose.length) return FACTS.groups!.map((_, i) => groupRung(FACTS, i));
  const cardIds = loose.flatMap((m) => m.cards.map((c) => c.id));
  return [
    {
      names: loose.map((m) => m.name),
      cardIds,
      cleared: (cards) => cardIds.filter((id) => reviewing(cards, id)).length / cardIds.length >= GROUP_UNLOCK_SHARE || steadyShare(cardIds, cards) >= GROUP_UNLOCK_SHARE,
    },
  ];
}

/**
 * Which rungs each region covers, as [from, to) positions in the ladder. The ladder splits by position into three runs:
 * the extra rung of an uneven split goes to the Meadow, and a second one to the Castle (5 rungs: 2, 1, 2). With fewer
 * than 3 rungs the later regions reuse the last rung.
 */
function spans(n: number): Record<RegionId, readonly [number, number]> {
  if (n === 0) return { meadow: [0, 0], forest: [0, 0], castle: [0, 0] };
  if (n === 1) return { meadow: [0, 1], forest: [0, 1], castle: [0, 1] };
  if (n === 2) return { meadow: [0, 1], forest: [1, 2], castle: [1, 2] };
  const base = Math.floor(n / 3);
  const rem = n % 3;
  const a = base + (rem >= 1 ? 1 : 0);
  const b = a + base;
  return { meadow: [0, a], forest: [a, b], castle: [b, n] };
}

/**
 * The single source for what a region covers: the card ids of the kid's own groups, in ladder order. Gates, the lair
 * bar, the lair gate, the fight and the lair message all read it. For a kid whose only module with groups is the times
 * tables it returns the old mapping (`REGION_GROUPS`) exactly.
 */
export function regionCards(region: RegionId, settings: KidSettings): string[] {
  const ladder = ladderOf(settings);
  const [from, to] = spans(ladder.length)[region];
  return ladder.slice(from, to).flatMap((r) => r.cardIds);
}

/** Every card on the kid's ladder, in order. */
export function ladderCards(settings: KidSettings): string[] {
  return ladderOf(settings).flatMap((r) => r.cardIds);
}

/** The furthest region the kid has stood in or beaten. A gate into it or any region before it stays open. */
export function furthestRegion(...seen: RegionId[]): RegionId {
  return seen.reduce((best, r) => (REGION_IDS.indexOf(r) > REGION_IDS.indexOf(best) ? r : best), 'meadow' as RegionId);
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
 * The gate that leads into `region`. It is open when the kid is past every rung before the region (the next group of
 * each module is open, parent "start at" counts), or when `reached` is `region` or a later one: a kid is never moved
 * back from a land the ladder has not yet earned.
 */
export function gateInfo(region: RegionId, cards: CardMap, settings: KidSettings = DEFAULT_SETTINGS, reached?: RegionId): GateInfo {
  const ladder = ladderOf(settings);
  const before = ladder.slice(0, spans(ladder.length)[region][0]);
  const ids = before.flatMap((r) => r.cardIds);
  const learned = ids.filter((id) => reviewing(cards, id)).length;
  const grandfathered = !!reached && REGION_IDS.indexOf(reached) >= REGION_IDS.indexOf(region);
  const open = grandfathered || before.every((r) => r.cleared(cards, settings));
  return { open, learned, total: ids.length, label: `${learned} of ${ids.length} learned` };
}

/** The region's card ids, in ladder order. */
export function regionCardIds(region: RegionId, settings: KidSettings = DEFAULT_SETTINGS): string[] {
  return regionCards(region, settings);
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
export function regionProgress(region: RegionId, cards: CardMap, settings: KidSettings = DEFAULT_SETTINGS): RegionCount {
  const ids = regionCards(region, settings);
  const reviewingN = ids.filter((id) => reviewing(cards, id)).length;
  const steadyN = ids.length ? Math.round(steadyShare(ids, cards) * ids.length) : 0;
  const done = Math.max(reviewingN, steadyN);
  return { reviewing: reviewingN, steady: steadyN, done, total: ids.length, share: ids.length ? done / ids.length : 0 };
}

/** The groups of a region in words: "6s, 7s, 8s and 12x12" for times tables, "Sums to 5 and Sums 6 to 10" for addition. */
export function regionFactsText(region: RegionId, settings: KidSettings = DEFAULT_SETTINGS): string {
  const ladder = ladderOf(settings);
  const [from, to] = spans(ladder.length)[region];
  const parts = ladder.slice(from, to).flatMap((r) => r.names);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join('');
}

/** The words the locked lair shows a reader. A pre-reader gets a picture instead (`lairPicture`). */
export function lairMessage(region: RegionId, ready: number, total: number, settings: KidSettings = DEFAULT_SETTINGS): string {
  return `Answer the ${REGION_NAMES[region]} facts to wake the dragon: ${regionFactsText(region, settings)}. ${ready} of ${total} ready.`;
}

/** Most tokens the locked-lair picture shows. A region with more cards fills them in proportion. */
export const LAIR_TOKENS = 12;

/** The locked lair for a pre-reader: a row of tokens with the ready ones lit, and a numeral count of 1 word ("4/12"). */
export function lairPicture(done: number, total: number): { tokens: number; lit: number; count: string } {
  const tokens = Math.min(total, LAIR_TOKENS);
  const lit = total && done > 0 ? Math.min(tokens, Math.max(1, Math.floor((done / total) * tokens))) : 0;
  return { tokens, lit, count: `${done}/${total}` };
}
