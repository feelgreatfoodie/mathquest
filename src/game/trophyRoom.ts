import { lifetimeChests } from '../engine/chestLedger';
import { factBaseline } from '../engine/grading';
import { cardLevel } from '../engine/mastery';
import { getCardDef } from '../engine/modules';
import { paceOf, type CardMap, type KidGame, type KidSettings, type SessionLog } from '../engine/models';
import { lairStats } from './overworld/lair';
import { REGION_IDS, type RegionId } from './overworld/maps';
import type { WorldState } from './overworld/worldState';
import { ITEMS, type ItemCategory } from './shop/catalog';
import { LEGENDARY_ARMOR, LEGENDARY_STAFF } from './shop/looks';
import { ownedItems } from './shop/shopState';

// The trophy room (item powers PDR section 5). A pure view model: it reads the kid's game, world save, lair logs and cards, and
// writes nothing. It holds no price, so the screen cannot show one.

export interface LairTrophy {
  region: RegionId;
  /** True from the first boss win. A region not beaten is an empty stand. */
  earned: boolean;
  beaten: number;
  bestMs: number | null;
}

export interface TrophyItem {
  id: string;
  name: string;
  /** False draws the item as a dark silhouette: never bought, or sold back. */
  owned: boolean;
}

export interface TrophyCategory {
  category: ItemCategory;
  label: string;
  items: TrophyItem[];
}

export interface TrophyRoomModel {
  lairs: LairTrophy[];
  categories: TrophyCategory[];
  titles: string[];
  counts: { chests: number; bosses: number; fluent: number };
}

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  weapon: 'Weapons',
  gear: 'Gear',
  pet: 'Pets',
  adventure: 'Adventure',
  camp: 'Camp',
  legendary: 'Legendary',
};
const CATEGORY_ORDER: readonly ItemCategory[] = ['weapon', 'gear', 'pet', 'adventure', 'camp', 'legendary'];

export interface TrophyInput {
  game: Pick<KidGame, 'items' | 'equipped'>;
  /** The kid's display name, read at runtime. */
  name: string;
  settings: Pick<KidSettings, 'paceMultiplier'> | undefined;
  /** world/main, or null before the first save. */
  world: Pick<WorldState, 'openedChests' | 'bossesDefeated'> | null;
  logs: ReadonlyArray<Pick<SessionLog, 'mode' | 'region' | 'bossWon' | 'bossCorrect' | 'bossMs'>>;
  cards: CardMap;
}

/** Facts at Fluent (mastery level 4: solid and fast). */
export function fluentFacts(cards: CardMap, settings: TrophyInput['settings']): number {
  const baseline = factBaseline(cards);
  const pace = paceOf(settings);
  return Object.values(cards).filter((c) => getCardDef(c.id)?.kind === 'fact' && cardLevel(c, baseline, pace) === 4).length;
}

export function buildTrophyRoom(input: TrophyInput): TrophyRoomModel {
  const own = new Set(ownedItems(input.game));
  const name = input.name.trim();
  const titles: string[] = [];
  if (name && own.has(LEGENDARY_ARMOR)) titles.push(`Sir ${name}`);
  if (name && own.has(LEGENDARY_STAFF)) titles.push(`Archmage ${name}`);
  return {
    lairs: REGION_IDS.map((region) => {
      const s = lairStats(input.logs, region);
      return { region, earned: s.beaten > 0, beaten: s.beaten, bestMs: s.bestMs };
    }),
    categories: CATEGORY_ORDER.map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      items: ITEMS.filter((i) => i.category === category).map((i) => ({ id: i.id, name: i.name, owned: own.has(i.id) })),
    })),
    titles,
    counts: {
      chests: lifetimeChests(input.world?.openedChests),
      bosses: new Set(input.world?.bossesDefeated ?? []).size,
      fluent: fluentFacts(input.cards, input.settings),
    },
  };
}
