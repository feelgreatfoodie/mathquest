import { describe, expect, it } from 'vitest';
import { unlockedGroups } from '../../engine/mastery';
import { DEFAULT_SETTINGS, PRESETS, type CardMap, type CardState, type KidSettings } from '../../engine/models';
import { FACTS } from '../../engine/modules/facts';
import { getModule } from '../../engine/modules';
import { mulberry32 } from '../../engine/problems';
import { bossPlan, bossReady } from './boss';
import { REGION_IDS, type RegionId } from './maps';
import { LAIR_TOKENS, REGION_GROUPS, furthestRegion, gateInfo, lairPicture, regionCards, regionFactsText, regionProgress } from './regions';

const NOW = new Date('2026-11-18T16:00:00').getTime();
const DAY = 86_400_000;

function young(id: string, results: boolean[] = [true, true]): CardState {
  return {
    id, attempts: results.length, correct: results.filter(Boolean).length, recentMs: [2500], lastRating: 3, updatedAt: NOW - DAY, lastResults: results,
    fsrs: { due: NOW + DAY, stability: 0.6, difficulty: 5, elapsed_days: 1, scheduled_days: 1, learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: NOW - DAY },
  };
}
const seen = (ids: string[], results?: boolean[]): CardMap => Object.fromEntries(ids.map((id) => [id, young(id, results)]));
const ADD10 = getModule('add10')!;
const SUB10 = getModule('sub10')!;
const idsOf = (m: { groups?: { cardIds: string[] }[] }, i: number) => m.groups![i]!.cardIds;

/** "Pip": a pre-reader with add10 and sub10 on and facts off. */
const PIP: KidSettings = { ...PRESETS.prereader, modules: { add10: true, sub10: true, facts: false } };
const FACTS_ONLY: KidSettings = { ...DEFAULT_SETTINGS, tracks: { facts: true, multidigit: false, fractions: false } };

describe('regionCards for a reader with only times tables on', () => {
  it.each([DEFAULT_SETTINGS, FACTS_ONLY])('matches the old REGION_GROUPS mapping byte for byte', (settings) => {
    for (const region of REGION_IDS) {
      const [from, to] = REGION_GROUPS[region];
      const old = FACTS.groups!.slice(from - 1, to).flatMap((g) => g.cardIds);
      expect(JSON.stringify(regionCards(region, settings))).toBe(JSON.stringify(old));
    }
  });
  it('keeps the old gate for forest: open exactly when 3 fact groups are open', () => {
    const g2 = idsOf(FACTS, 1);
    const cards = seen(idsOf(FACTS, 0));
    expect(gateInfo('forest', cards, FACTS_ONLY).open).toBe(unlockedGroups(FACTS, cards, FACTS_ONLY) >= 3);
    expect(gateInfo('forest', { ...cards, ...seen(g2) }, FACTS_ONLY).open).toBe(true);
    expect(gateInfo('forest', {}, { ...FACTS_ONLY, factGroupsUnlocked: 3 }).open).toBe(true);
  });
});

describe('a pre-reader with add10 and sub10 on and facts off (Pip)', () => {
  it('maps regions to his own groups: Meadow add g1 + g2, Forest sub g1, Castle sub g2', () => {
    expect(regionCards('meadow', PIP)).toEqual([...idsOf(ADD10, 0), ...idsOf(ADD10, 1)]);
    expect(regionCards('forest', PIP)).toEqual(idsOf(SUB10, 0));
    expect(regionCards('castle', PIP)).toEqual(idsOf(SUB10, 1));
    for (const id of REGION_IDS.flatMap((r) => regionCards(r, PIP))) expect(id).toMatch(/^(add|sub):/);
  });
  it('the Castle lair can turn ready, and the fight asks only add and sub cards he has seen', () => {
    const castle = regionCards('castle', PIP);
    expect(bossReady('castle', {}, PIP)).toBe(false);
    const need = Math.ceil(castle.length * 0.8);
    const cards = seen(castle.slice(0, need));
    expect(regionProgress('castle', cards, PIP).total).toBe(castle.length);
    expect(bossReady('castle', cards, PIP)).toBe(true);
    const plan = bossPlan({ region: 'castle', cards, now: NOW, rng: mulberry32(1), settings: PIP });
    expect(plan).toHaveLength(5);
    for (const p of plan) {
      expect(p.cardId).toMatch(/^(add|sub):/);
      expect(cards[p.cardId]).toBeDefined();
    }
  });
  it('gates follow his ladder: Forest opens when the add groups are done, not at the start', () => {
    expect(gateInfo('meadow', {}, PIP).open).toBe(true);
    expect(gateInfo('forest', {}, PIP).open).toBe(false);
    expect(gateInfo('castle', {}, PIP).open).toBe(false);
    const meadow = seen(regionCards('meadow', PIP));
    expect(gateInfo('forest', meadow, PIP).open).toBe(true);
    expect(gateInfo('castle', meadow, PIP).open).toBe(false);
    expect(gateInfo('forest', {}, PIP).label).toBe('0 of 36 learned');
  });
  it('names his real groups, not times tables', () => {
    expect(regionFactsText('castle', PIP)).toBe('Start with 6 to 10');
    expect(regionFactsText('meadow', PIP)).toBe('Sums to 5 and Sums 6 to 10');
  });
});

describe('a fight never uses an unseen card and always starts when the lair is ready', () => {
  it('fills from other seen cards on the ladder when fewer than 5 region cards are seen', () => {
    const castle = regionCards('castle', PIP);
    const meadowSeen = regionCards('meadow', PIP).slice(0, 4);
    const cards = { ...seen(castle.slice(0, 2)), ...seen(meadowSeen) };
    const plan = bossPlan({ region: 'castle', cards, now: NOW, rng: mulberry32(2), settings: PIP });
    expect(plan).toHaveLength(5);
    expect(plan.filter((p) => castle.includes(p.cardId))).toHaveLength(2);
    for (const p of plan) expect(cards[p.cardId]).toBeDefined();
    expect(new Set(plan.map((p) => p.cardId)).size).toBe(5);
  });
  it('plays only the cards he has seen when fewer than 5 are seen at all', () => {
    const cards = seen(regionCards('castle', PIP).slice(0, 3));
    const plan = bossPlan({ region: 'castle', cards, now: NOW, rng: mulberry32(2), settings: PIP });
    expect(plan.map((p) => p.cardId).sort()).toEqual(Object.keys(cards).sort());
    expect(bossPlan({ region: 'castle', cards: {}, now: NOW, rng: mulberry32(2), settings: PIP })).toEqual([]);
  });
  it('a ready lair always starts a fight', () => {
    const castle = regionCards('castle', PIP);
    const cards = seen(castle.slice(0, Math.ceil(castle.length * 0.8)));
    expect(bossReady('castle', cards, PIP)).toBe(true);
    expect(bossPlan({ region: 'castle', cards, now: NOW, rng: mulberry32(3), settings: PIP }).length).toBeGreaterThan(0);
  });
});

describe('grandfathering', () => {
  it('keeps every gate up to the reached region open, and never past it', () => {
    expect(gateInfo('castle', {}, PIP).open).toBe(false);
    expect(gateInfo('castle', {}, PIP, 'castle').open).toBe(true);
    expect(gateInfo('forest', {}, PIP, 'castle').open).toBe(true);
    expect(gateInfo('forest', {}, PIP, 'forest').open).toBe(true);
    expect(gateInfo('castle', {}, PIP, 'forest').open).toBe(false);
    expect(gateInfo('castle', {}, PIP, 'meadow').open).toBe(false);
  });
  it('the furthest region wins', () => {
    expect(furthestRegion('forest', 'meadow')).toBe('forest');
    expect(furthestRegion('meadow', 'castle', 'forest')).toBe('castle');
    expect(furthestRegion()).toBe('meadow');
  });
});

describe('other ladders', () => {
  it('a mixed kid (add10 and times tables) gets add groups first, then facts, in registry order', () => {
    const mixed: KidSettings = { ...DEFAULT_SETTINGS, modules: { add10: true, facts: true }, tracks: { facts: true, multidigit: false, fractions: false } };
    const all = REGION_IDS.flatMap((r) => regionCards(r, mixed));
    expect(all).toEqual([...idsOf(ADD10, 0), ...idsOf(ADD10, 1), ...FACTS.groups!.flatMap((g) => g.cardIds)]);
    expect(regionCards('meadow', mixed)).toEqual([...idsOf(ADD10, 0), ...idsOf(ADD10, 1), ...idsOf(FACTS, 0)]);
  });
  it('with fewer than 3 groups the later regions reuse the last group', () => {
    const addOnly: KidSettings = { ...PRESETS.prereader, modules: { add10: true } };
    expect(regionCards('meadow', addOnly)).toEqual(idsOf(ADD10, 0));
    expect(regionCards('forest', addOnly)).toEqual(idsOf(ADD10, 1));
    expect(regionCards('castle', addOnly)).toEqual(idsOf(ADD10, 1));
  });
  it('a kid with only fractions and multidigit on still has a lair to open', () => {
    const skills: KidSettings = { ...DEFAULT_SETTINGS, tracks: { facts: false, multidigit: true, fractions: true } };
    for (const r of REGION_IDS) expect(regionCards(r, skills).length).toBeGreaterThan(0);
    expect(gateInfo('castle', {}, skills).open).toBe(true);
  });
});

describe('the pre-reader lair picture', () => {
  it('shows a row of tokens, the ready ones lit, and a numeral count of 1 word', () => {
    expect(lairPicture(4, 12)).toEqual({ tokens: 12, lit: 4, count: '4/12' });
    expect(lairPicture(0, 45)).toEqual({ tokens: LAIR_TOKENS, lit: 0, count: '0/45' });
    expect(lairPicture(1, 45).lit).toBe(1);
    expect(lairPicture(45, 45).lit).toBe(LAIR_TOKENS);
    for (const [d, t] of [[0, 0], [4, 12], [30, 45]] as const) expect(lairPicture(d, t).count.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(2);
  });
});

describe('regions stay in the three ids', () => {
  it('every region id has cards for Pip', () => {
    const ids: RegionId[] = [...REGION_IDS];
    for (const r of ids) expect(regionCards(r, PIP).length).toBeGreaterThan(0);
  });
});
