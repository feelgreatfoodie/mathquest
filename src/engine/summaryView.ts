import { levelFor } from './game';
import { cardLevel, groupFloor, unlockedGroups } from './mastery';
import { DEFAULT_PACE, modulesOf, type CardMap, type KidSettings } from './models';
import { MODULES, type ModuleDef } from './modules';

/** Share of a group that opens the next one (the coverage-1 rule in mastery.ts). */
const UNLOCK_SHARE = 0.8;

export interface LevelStep {
  levelBefore: number;
  levelAfter: number;
  levelUp: boolean;
  /** XP bar fill (0 to 1) of the level the kid was on before, and of the level after. */
  fromFrac: number;
  toFrac: number;
}

/** The XP bar for one run: where it starts, where it ends, and whether the level changed. */
export function levelStep(xpBefore: number, xpAfter: number): LevelStep {
  const a = levelFor(xpBefore);
  const b = levelFor(xpAfter);
  return {
    levelBefore: a.level,
    levelAfter: b.level,
    levelUp: b.level > a.level,
    fromFrac: a.into / a.span,
    toFrac: b.into / b.span,
  };
}

/**
 * How many more facts of group `index - 1` must be in shape before group `index` opens, by the same rule
 * `unlockedGroups` uses: 80% steady (seen, last two graded answers right) for a pre-reader; for a reader,
 * 80% steady or 80% in review, whichever is closer. 0 when the group is already open.
 */
export function unlockGap(mod: ModuleDef, index: number, cards: CardMap, settings: KidSettings): number {
  const prev = mod.groups?.[index - 1];
  if (!prev || index < groupFloor(mod, settings)) return 0;
  const need = Math.ceil(prev.cardIds.length * UNLOCK_SHARE - 1e-9);
  const steady = prev.cardIds.filter((id) => {
    const r = cards[id]?.lastResults;
    return !!r && r.length >= 2 && r.every(Boolean);
  }).length;
  let best = need - steady;
  if (settings.learner !== 'prereader') {
    const review = prev.cardIds.filter((id) => cardLevel(cards[id], Infinity, DEFAULT_PACE) >= 2).length;
    best = Math.min(best, need - review);
  }
  return Math.max(0, best);
}

export interface Stone {
  groupId: string;
  total: number;
  /** Facts of the group the kid has answered at least once. */
  seen: number;
  /** done: passed. current: where the hero stands. locked: not open yet. */
  state: 'done' | 'current' | 'locked';
  /** Only on the first locked stone: facts still needed to open it. */
  gap?: number;
}

export interface MapRow {
  moduleId: ModuleDef['id'];
  stones: Stone[];
}

/** One row per enabled module with groups, one stone per group. The hero stands on the last open stone. */
export function mapRows(cards: CardMap, settings: KidSettings): MapRow[] {
  const on = modulesOf(settings);
  const rows: MapRow[] = [];
  for (const mod of MODULES) {
    if (!on[mod.id] || !mod.groups?.length || mod.audience === 'reader') continue;
    const open = unlockedGroups(mod, cards, settings);
    rows.push({
      moduleId: mod.id,
      stones: mod.groups.map((grp, i) => {
        const stone: Stone = {
          groupId: grp.id,
          total: grp.cardIds.length,
          seen: grp.cardIds.filter((id) => cards[id]).length,
          state: i < open - 1 ? 'done' : i === open - 1 ? 'current' : 'locked',
        };
        if (i === open) stone.gap = unlockGap(mod, i, cards, settings);
        return stone;
      }),
    });
  }
  return rows;
}

/** The reader's compact row for the first module with groups that is on, e.g. "Times tables: 81 of 91 seen · next: 6s–8s". */
export function readerMapLine(cards: CardMap, settings: KidSettings): string | null {
  const on = modulesOf(settings);
  const mod = MODULES.find((m) => on[m.id] && m.groups?.length && m.audience !== 'prereader');
  if (!mod) return null;
  const facts = mod.cards.filter((c) => c.kind === 'fact');
  const seen = facts.filter((c) => cards[c.id]).length;
  const open = unlockedGroups(mod, cards, settings);
  const next = mod.groups![open];
  return `${mod.name}: ${seen} of ${facts.length} seen${next ? ` · next: ${next.label}` : ''}`;
}
