import { GROUP_UNLOCK_SHARE } from '../../engine/mastery';
import type { CardMap } from '../../engine/models';
import type { Rng } from '../../engine/problems';
import { isDue, retrievability } from '../../engine/scheduler';
import type { PlanItem } from '../../engine/session';
import type { RegionId } from './maps';
import { REGION_GROUPS, regionProgress } from './regions';
import type { WorldState } from './worldState';
import { FACTS } from '../../engine/modules/facts';

export const BOSS_QUESTIONS = 5;
/** Correct answers that win the fight. */
export const BOSS_WIN = 4;
export const BOSS_GEMS = 10;

/**
 * The lair opens when the share of the region's cards at cardLevel 2 or more reaches GROUP_UNLOCK_SHARE, or when the
 * steady share (seen, last 2 answers right) reaches it. The second rule is the one `unlockedGroups` already has, so a
 * kid who answers well is not held back days by FSRS stability.
 */
export function bossReady(region: RegionId, cards: CardMap): boolean {
  const p = regionProgress(region, cards);
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
 * The five questions of a fight: cards the kid has already seen in the region, weakest first. A card that is due is
 * graded like any review; a card that is not due is ungraded practice (`fill`), so the fight never moves FSRS early.
 */
export function bossPlan({ region, cards, now, rng }: { region: RegionId; cards: CardMap; now: number; rng: Rng }): PlanItem[] {
  const [from, to] = REGION_GROUPS[region];
  const ids = (FACTS.groups ?? []).slice(from - 1, to).flatMap((g) => g.cardIds).filter((id) => cards[id]);
  // Ties break by a shuffle, so two equally weak cards do not always come in the same order.
  const shuffled = ids.map((id) => ({ id, r: rng() })).sort((a, b) => a.r - b.r).map((x) => x.id);
  const weakest = shuffled.sort((a, b) => retrievability(cards[a]!, now) - retrievability(cards[b]!, now)).slice(0, BOSS_QUESTIONS);
  return weakest.map((cardId) => (isDue(cards[cardId]!, now) ? { cardId, isNew: false } : { cardId, isNew: false, fill: true }));
}
