import { GROUP_UNLOCK_SHARE } from '../../engine/mastery';
import { DEFAULT_SETTINGS, type CardMap, type KidSettings } from '../../engine/models';
import type { Rng } from '../../engine/problems';
import { isDue, retrievability } from '../../engine/scheduler';
import type { PlanItem } from '../../engine/session';
import type { RegionId } from './maps';
import { ladderCards, regionCards, regionProgress } from './regions';
import type { WorldState } from './worldState';

export const BOSS_QUESTIONS = 5;
/** Correct answers that win the fight. */
export const BOSS_WIN = 4;
export const BOSS_GEMS = 10;

/**
 * The lair opens when the share of the region's cards at cardLevel 2 or more reaches GROUP_UNLOCK_SHARE, or when the
 * steady share (seen, last 2 answers right) reaches it. The second rule is the one `unlockedGroups` already has, so a
 * kid who answers well is not held back days by FSRS stability.
 */
export function bossReady(region: RegionId, cards: CardMap, settings: KidSettings = DEFAULT_SETTINGS): boolean {
  const p = regionProgress(region, cards, settings);
  return p.total > 0 && Math.max(p.reviewing, p.steady) / p.total >= GROUP_UNLOCK_SHARE;
}

/**
 * What a won fight pays. A lair pays once per region: when the world already lists the region as defeated, the win pays
 * 0 gems. The key follows the same rule inside `worldReducer`. XP comes from the graded answers, and a defeated lair
 * cannot be entered again (`startBoss`), so a second win has no fight to pay for.
 */
export function bossReward(world: Pick<WorldState, 'bossesDefeated'>, region: RegionId): { gems: number; first: boolean } {
  const first = !world.bossesDefeated.includes(region);
  return { gems: first ? BOSS_GEMS : 0, first };
}

/**
 * The five questions of a fight: cards the kid has already seen in the region, weakest first. A region with fewer than
 * 5 seen cards fills the rest from other seen cards on the kid's ladder, so a ready lair always starts a fight. An unseen
 * card never comes up. A card that is due is graded like any review; a card that is not due is ungraded practice
 * (`fill`), so the fight never moves FSRS early.
 */
export function bossPlan({ region, cards, now, rng, settings = DEFAULT_SETTINGS }: { region: RegionId; cards: CardMap; now: number; rng: Rng; settings?: KidSettings }): PlanItem[] {
  const weakestFirst = (ids: string[]) => {
    // Ties break by a shuffle, so two equally weak cards do not always come in the same order.
    const shuffled = ids.map((id) => ({ id, r: rng() })).sort((a, b) => a.r - b.r).map((x) => x.id);
    return shuffled.sort((a, b) => retrievability(cards[a]!, now) - retrievability(cards[b]!, now));
  };
  const here = regionCards(region, settings).filter((id) => cards[id]);
  const picked = weakestFirst(here).slice(0, BOSS_QUESTIONS);
  if (picked.length < BOSS_QUESTIONS) {
    const inRegion = new Set(here);
    const rest = [...new Set(ladderCards(settings))].filter((id) => cards[id] && !inRegion.has(id));
    picked.push(...weakestFirst(rest).slice(0, BOSS_QUESTIONS - picked.length));
  }
  return picked.map((cardId) => (isDue(cards[cardId]!, now) ? { cardId, isNew: false } : { cardId, isNew: false, fill: true }));
}
