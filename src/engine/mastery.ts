import { Rating, State } from 'ts-fsrs';
import { FACTS } from './modules/facts';
import { MODULES, getCardDef, getModule, type CardDef, type ModuleDef } from './modules';
import { thresholdsFor } from './grading';
import { DEFAULT_PACE, learnerOf, modulesOf, type CardMap, type CardState, type KidSettings } from './models';
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
/** Share of a group that opens the next one. The planner, the unlock gap and the parent insights panel all read this one constant. */
export const GROUP_UNLOCK_SHARE = 0.8;

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

/** Share of one of a module's groups that is at least "reviewing". */
export function groupProgress(mod: ModuleDef, groupIndex: number, cards: CardMap): number {
  const group = mod.groups?.[groupIndex];
  if (!group || !group.cardIds.length) return 1;
  const ok = group.cardIds.filter((id) => cardLevel(cards[id], Infinity, DEFAULT_PACE) >= 2).length;
  return ok / group.cardIds.length;
}

/** Share of a group whose facts were seen and whose last two graded answers were both right. */
export function groupSteady(mod: ModuleDef, groupIndex: number, cards: CardMap): number {
  const group = mod.groups?.[groupIndex];
  if (!group || !group.cardIds.length) return 1;
  const ok = group.cardIds.filter((id) => {
    const r = cards[id]?.lastResults;
    return !!r && r.length >= 2 && r.every(Boolean);
  }).length;
  return ok / group.cardIds.length;
}

type GroupSettings = Pick<KidSettings, 'factGroupsUnlocked'> & Partial<Pick<KidSettings, 'groupsUnlocked'>>;

/**
 * The parent's floor for a module: groups up to it count as open (and as known by prereqMet). It is
 * `groupsUnlocked[module]` when that is a whole number of 1 or more, else the old rule: `factGroupsUnlocked`
 * for times tables, group 1 for everything else. A bad stored value falls back, so it can never close group 1.
 */
export function groupFloor(mod: ModuleDef, settings: GroupSettings): number {
  const set = settings.groupsUnlocked?.[mod.id];
  if (typeof set === 'number' && Number.isInteger(set) && set >= 1) return set;
  return mod.id === 'facts' ? Math.max(1, settings.factGroupsUnlocked) : 1;
}

/**
 * How many of a module's groups are open: group 1, plus any earned by progress. A group opens when
 * 80% of the one before it is in review, or when 80% of it was seen and its last two answers were right,
 * whichever comes first. A pre-reader uses the second rule only. For times tables the parent's
 * "start at" setting also counts.
 */
export function unlockedGroups(mod: ModuleDef, cards: CardMap, settings: GroupSettings & { learner?: KidSettings['learner'] }): number {
  const total = mod.groups?.length ?? 0;
  const prereader = learnerOf(settings) === 'prereader';
  let n = Math.min(total, groupFloor(mod, settings)); // the parent's floor
  while (
    n < total &&
    ((!prereader && groupProgress(mod, n - 1, cards) >= GROUP_UNLOCK_SHARE) || groupSteady(mod, n - 1, cards) >= GROUP_UNLOCK_SHARE)
  )
    n++;
  return n;
}

/** How many fact groups are open: the parent's setting, plus any earned by progress. */
export function unlockedFactGroups(cards: CardMap, settings: GroupSettings): number {
  return unlockedGroups(FACTS, cards, settings);
}

function skillReady(id: string, cards: CardMap): boolean {
  const s = cards[id];
  return !!s && s.fsrs.reps >= 3 && cardLevel(s, Infinity, DEFAULT_PACE) >= 2;
}

/** A prerequisite is a card id ("fr:add") or a group ref ("facts:g2": module id, then group id). */
export function prereqMet(ref: string, cards: CardMap, settings: KidSettings): boolean {
  const [prefix, groupId] = ref.split(':');
  const mod = prefix ? getModule(prefix as never) : undefined;
  if (mod?.groups) {
    if (!modulesOf(settings)[mod.id]) return true; // that module is handled outside the app
    const idx = mod.groups.findIndex((g) => g.id === groupId);
    if (idx < groupFloor(mod, settings) - 1) return true; // parent says these are known
    return groupProgress(mod, idx, cards) >= GROUP_UNLOCK_SHARE;
  }
  return skillReady(ref, cards);
}

/** Every card the kid may see right now: each enabled module in registry order, in curriculum order. */
export function availableCards(cards: CardMap, settings: KidSettings): CardDef[] {
  const on = modulesOf(settings);
  const out: CardDef[] = [];
  for (const mod of MODULES) {
    if (!on[mod.id]) continue;
    if (mod.groups) {
      const open = new Set(mod.groups.slice(0, unlockedGroups(mod, cards, settings)).flatMap((g) => g.cardIds));
      // A card seen in a preview stays in review while its group is still locked.
      out.push(...mod.cards.filter((c) => open.has(c.id) || cards[c.id]));
      continue;
    }
    for (const c of mod.cards) {
      if (cards[c.id] || c.kind !== 'skill' || c.prereqs.every((p) => prereqMet(p, cards, settings))) out.push(c);
    }
  }
  return out;
}

/**
 * Unseen cards of locked groups, in the order previews take them: the next locked group of each module first,
 * then the group after it. Within a rank, registry order, then curriculum order.
 */
export function previewPool(cards: CardMap, settings: KidSettings): CardDef[] {
  const on = modulesOf(settings);
  const ranked: { rank: number; mod: number; at: number; def: CardDef }[] = [];
  MODULES.forEach((mod, mi) => {
    if (!on[mod.id] || !mod.groups) return;
    const n = unlockedGroups(mod, cards, settings);
    mod.groups.slice(n).forEach((g, gi) => {
      g.cardIds.forEach((id, at) => {
        const def = getCardDef(id);
        if (def && !cards[id]) ranked.push({ rank: gi, mod: mi, at, def });
      });
    });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.mod - b.mod || a.at - b.at).map((r) => r.def);
}

/** What a parent sees: how much of a module the kid has met, and which groups are untouched. */
export function moduleCoverage(mod: ModuleDef, cards: CardMap): { seen: number; total: number; untouched: string[] } {
  const total = mod.cards.filter((c) => c.kind === 'fact').length;
  const seen = mod.cards.filter((c) => c.kind === 'fact' && cards[c.id]).length;
  const untouched = (mod.groups ?? []).filter((g) => g.cardIds.length && g.cardIds.every((id) => !cards[id])).map((g) => g.label);
  return { seen, total, untouched };
}
