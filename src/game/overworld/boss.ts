import type { CardMap } from '../../engine/models';
import type { Rng } from '../../engine/problems';
import { isDue, retrievability } from '../../engine/scheduler';
import type { PlanItem } from '../../engine/session';
import type { RegionId } from './maps';
import { BOSS_SHARE, REGION_GROUPS, regionProgress } from './regions';
import { FACTS } from '../../engine/modules/facts';

export const BOSS_QUESTIONS = 5;
/** Correct answers that win the fight. */
export const BOSS_WIN = 4;
export const BOSS_GEMS = 10;

/** The lair opens when 80% of the region's cards are Reviewing or better. */
export function bossReady(region: RegionId, cards: CardMap): boolean {
  const p = regionProgress(region, cards);
  return p.total > 0 && p.share >= BOSS_SHARE;
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
