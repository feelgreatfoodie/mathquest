import { needsWork } from '../../engine/insights';
import type { CardMap, KidSettings, Learner } from '../../engine/models';
import { getCardDef, moduleOfCard } from '../../engine/modules';
import type { Rng } from '../../engine/problems';
import type { SessionRunner } from '../../engine/session';
import { tripChestSpots, type MapGear, type TripSpot } from './chests';
import { withDogSpot } from './pets';
import { chestRank, planEntities, type Entity } from './encounters';
import { MAPS, type Point, type RegionId, type WalkCtx } from './maps';

export interface RegionPlanInput {
  runner: SessionRunner;
  cards: CardMap;
  settings: KidSettings;
  learner: Learner;
  tripId: string;
  /** Spot ids opened on this trip. */
  opened: string[];
  region: RegionId;
  hero: Point;
  /** Entry ids that are boss questions: they stay off the map. */
  bossIds: ReadonlySet<string>;
  rng: Rng;
  ctx: WalkCtx;
  now: number;
  /** Owned adventure items that add a chest spot (key room, bridge island). Absent reads as none. */
  gear?: MapGear;
  /** The Dog is the equipped pet: one chest of the trip stands out of sight on a grass tile. */
  dog?: boolean;
}

/** The trip's chest spots in a land. A new skill needs a chest for its teach card, so the count never falls under the skills waiting. */
export function spotsFor(runner: SessionRunner, tripId: string, region: RegionId, learner: Learner, bossIds: ReadonlySet<string>, gear: MapGear = {}, opened: readonly string[] = [], dog = false): TripSpot[] {
  const teach = runner.queue.filter((e) => e.kind === 'teach' && runner.queue.some((g) => g.kind === 'graded' && g.cardId === e.cardId && !bossIds.has(g.id))).length;
  const base = tripChestSpots(tripId, region, learner === 'prereader', teach, gear, opened);
  return dog ? withDogSpot(tripId, region, base, opened) : base;
}

/**
 * Everything on the map for one land on one trip. Each closed chest spot of the trip takes the next question in fill order:
 * a new fact, a preview, a fact that needs work, then a riddle. When the run has fewer facts than closed chests, the runner
 * gets riddle entries (practice on a fact the kid has met, from fixed story templates) until every closed chest has one.
 */
export function planRegion(i: RegionPlanInput): { entities: Entity[]; spots: TripSpot[] } {
  const spots = spotsFor(i.runner, i.tripId, i.region, i.learner, i.bossIds, i.gear, i.opened, i.dog);
  const needs = new Set(needsWork({ cards: i.cards, sessions: [], settings: i.settings, now: i.now }, 12).map((f) => f.id));
  const closed = spots.filter((s) => !i.opened.includes(s.id)).length;
  const pend = i.runner.pending().filter((e) => !i.bossIds.has(e.id));
  let need = closed - pend.filter((e) => chestRank(e, needs) < 3).length - pend.filter((e) => e.riddle).length;
  const pool = Object.keys(i.cards).filter((id) => getCardDef(id)?.kind === 'fact' && (i.learner !== 'prereader' || moduleOfCard(id)?.input === 'choices'));
  for (let tries = 0; need > 0 && pool.length && tries < 80; tries++) {
    if (i.runner.appendRiddle(pool[Math.floor(i.rng() * pool.length)]!, i.rng)) need--;
  }
  const pendingIds = new Set(i.runner.pending().map((e) => e.id));
  const entries = i.runner.queue.filter((e) => (e.kind === 'teach' ? i.runner.queue.some((g) => g.kind === 'graded' && g.cardId === e.cardId && pendingIds.has(g.id)) : pendingIds.has(e.id)));
  const entities = planEntities({ entries, map: MAPS[i.region], hero: i.hero, spots, opened: i.opened, needsWork: needs, rng: i.rng, ctx: i.ctx, skip: [...i.bossIds] });
  return { entities, spots };
}
