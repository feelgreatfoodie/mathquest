import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME } from '../../engine/models';
import { buildShopMath, promptFor, cheapestUnaffordable, prereaderText, readerText, shopMathChoices } from './shopMath';

const NOW = Date.parse('2026-11-18T18:00:00Z');
const DAY = 86_400_000;
const game = (over: Partial<typeof DEFAULT_GAME>) => ({ ...DEFAULT_GAME, ...over });

describe('shop math prompt', () => {
  it('a reader gets the pinned goal with the real numbers', () => {
    const p = buildShopMath(game({ gems: 47, goal: 'w-bow' }), 'reader', 'kid-a', NOW)!;
    expect(p).toMatchObject({ itemId: 'w-bow', source: 'goal', have: 47, cost: 55, answer: 8, variant: false });
    expect(readerText(p)).toBe('You have 47. The Bow costs 55. How many more?');
  });

  it('with no goal a reader gets the cheapest thing out of reach', () => {
    const g = game({ gems: 16, items: ['w-sword'] });
    expect(cheapestUnaffordable(g)).toEqual({ id: 'c-banner', cost: 20 });
    const p = buildShopMath(g, 'reader', 'kid-a', NOW)!;
    expect(p).toMatchObject({ itemId: 'c-banner', source: 'cheapest', have: 16, cost: 20, answer: 4 });
  });

  it('a reached goal falls back to the cheapest thing out of reach', () => {
    const p = buildShopMath(game({ gems: 60, goal: 'w-bow' }), 'reader', 'kid-a', NOW)!;
    expect(p.source).toBe('cheapest');
    expect(p.cost).toBeGreaterThan(60);
  });

  it('shows no card when everything is affordable or owned', () => {
    expect(buildShopMath(game({ gems: 100000 }), 'reader', 'kid-a', NOW)).toBeNull();
    expect(buildShopMath(game({ gems: 100000 }), 'prereader', 'kid-a', NOW)).toBeNull();
  });

  it('a pre-reader gets the real numbers when the cost and the gap are both 10 or less', () => {
    const p = promptFor({ id: 'w-bow', source: 'goal', have: 3, cost: 8 }, 'prereader', 'kid-a', NOW);
    expect(p).toMatchObject({ have: 3, cost: 8, answer: 5, variant: false });
    expect(prereaderText(p)).toBe('You have 3 dots. You need 8. How many more?');
  });

  it('a gap of 10 or less with a cost over 10 still uses the variant', () => {
    const p = promptFor({ id: 'w-bow', source: 'goal', have: 8, cost: 15 }, 'prereader', 'kid-a', NOW);
    expect(p.variant).toBe(true);
    expect(p.cost).toBeLessThanOrEqual(10);
  });

  it('a pre-reader gets a within-10 variant when the gap is over 10, the same all day', () => {
    const g = game({ gems: 5, goal: 'w-bow' }); // need 50
    const a = buildShopMath(g, 'prereader', 'kid-a', NOW)!;
    expect(a.variant).toBe(true);
    expect(a.cost).toBeLessThanOrEqual(10);
    expect(a.cost - a.have).toBeGreaterThanOrEqual(1);
    expect(a.have).toBeGreaterThanOrEqual(1);
    expect(a.answer).toBe(a.cost - a.have);
    // The same prompt later the same day, and after the gems change.
    expect(buildShopMath(g, 'prereader', 'kid-a', NOW + 60_000)).toEqual(a);
    expect(buildShopMath(game({ gems: 9, goal: 'w-bow' }), 'prereader', 'kid-a', NOW)).toMatchObject({ have: a.have, cost: a.cost, variant: true });
    expect(prereaderText(a)).toBe(`You have ${a.have} dots. You need ${a.cost}. How many more?`);
  });

  it('the variant differs across days and kids', () => {
    const g = game({ gems: 5, goal: 'w-bow' });
    const seen = new Set<string>();
    for (let d = 0; d < 12; d++) for (const k of ['kid-a', 'kid-b']) {
      const p = buildShopMath(g, 'prereader', k, NOW + d * DAY)!;
      seen.add(`${p.have}/${p.cost}`);
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it('pre-reader choices are three distinct numbers from 1 to 10 with the answer among them', () => {
    for (let a = 1; a <= 9; a++) {
      const c = shopMathChoices(a, 'kid-a', NOW);
      expect(c).toHaveLength(3);
      expect(new Set(c).size).toBe(3);
      expect(c).toContain(a);
      expect(c.every((n) => n >= 1 && n <= 10)).toBe(true);
    }
  });
});
