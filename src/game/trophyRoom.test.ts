import { describe, expect, it } from 'vitest';
import { State } from 'ts-fsrs';
import { newCardState } from '../engine/scheduler';
import type { CardMap, KidGame, SessionLog } from '../engine/models';
import { DEFAULT_GAME } from '../engine/models';
import { newWorld, type WorldState } from './overworld/worldState';
import { ITEMS } from './shop/catalog';
import { buildTrophyRoom } from './trophyRoom';

const NOW = 1_700_000_000_000;
const game = (over: Partial<KidGame> = {}): KidGame => ({ ...DEFAULT_GAME, ...over });
const world = (over: Partial<WorldState> = {}): WorldState => ({ ...newWorld(NOW), ...over });
const lair = (region: string, won: boolean, ms?: number): SessionLog =>
  ({ id: `${region}${ms}${won}`, startedAt: NOW, endedAt: NOW, answered: 0, graded: 0, correct: 0, fast: 0, newLearned: 0, medianMs: 0, xp: 0, gems: 0, bestCombo: 0, missed: [], mode: 'lair', region, bossWon: won, bossMs: ms }) as SessionLog;
/** A fact the kid knows well and answers fast: Fluent (level 4). */
const fluent = (id: string): CardMap[string] => ({
  ...newCardState(id, NOW),
  fsrs: { ...newCardState(id, NOW).fsrs, state: State.Review, stability: 30, reps: 6 },
  attempts: 6,
  correct: 6,
  recentMs: [900, 1000, 1100],
  lastRating: 3,
});
const slow = (id: string): CardMap[string] => ({ ...fluent(id), recentMs: [60_000, 60_000, 60_000] });

const room = (o: { g?: Partial<KidGame>; w?: WorldState | null; logs?: SessionLog[]; cards?: CardMap; name?: string } = {}) =>
  buildTrophyRoom({ game: game(o.g), name: o.name ?? 'Pip', settings: undefined, world: o.w === undefined ? world() : o.w, logs: o.logs ?? [], cards: o.cards ?? {} });

describe('trophy room view model', () => {
  it('a new kid: three empty stands, every item a silhouette, no titles, zero counts', () => {
    const r = room();
    expect(r.lairs.map((l) => [l.region, l.earned, l.beaten, l.bestMs])).toEqual([['meadow', false, 0, null], ['forest', false, 0, null], ['castle', false, 0, null]]);
    expect(r.categories.flatMap((c) => c.items).every((i) => !i.owned)).toBe(true);
    expect(r.categories.flatMap((c) => c.items)).toHaveLength(ITEMS.length);
    expect(r.titles).toEqual([]);
    expect(r.counts).toEqual({ chests: 0, bosses: 0, fluent: 0 });
  });

  it('a region beaten twice shows the win count and the best time; a lost fight earns nothing', () => {
    const r = room({ logs: [lair('forest', true, 41_000), lair('forest', true, 38_500), lair('forest', false, 5_000), lair('castle', false, 9_000)] });
    const f = r.lairs.find((l) => l.region === 'forest')!;
    expect([f.earned, f.beaten, f.bestMs]).toEqual([true, 2, 38_500]);
    expect(r.lairs.find((l) => l.region === 'castle')!.earned).toBe(false);
    expect(r.lairs.find((l) => l.region === 'meadow')!.earned).toBe(false);
  });

  it('owned items are filled, and a sold item shows as a silhouette again', () => {
    const owned = room({ g: { items: ['w-sword', 'w-bow', 'c-tent'] } });
    const flat = (r: ReturnType<typeof room>) => Object.fromEntries(r.categories.flatMap((c) => c.items).map((i) => [i.id, i.owned]));
    expect(flat(owned)).toMatchObject({ 'w-sword': true, 'w-bow': true, 'c-tent': true, 'w-wand': false });
    const sold = room({ g: { items: ['w-sword', 'c-tent'] } });
    expect(flat(sold)['w-bow']).toBe(false);
  });

  it('groups every item by category, in shop order, with the legendaries last', () => {
    const r = room();
    expect(r.categories.map((c) => c.category)).toEqual(['weapon', 'gear', 'pet', 'adventure', 'camp', 'legendary']);
  });

  it('shows no price anywhere in the model', () => {
    expect(JSON.stringify(room({ g: { items: ['w-bow'] } }))).not.toMatch(/cost|price|gems/i);
  });

  it('both legendaries owned give 2 titles from the display name; one gives 1; none gives 0', () => {
    expect(room({ g: { items: ['g-goldarmor', 'w-crystalstaff'] }, name: 'Zed' }).titles).toEqual(['Sir Zed', 'Archmage Zed']);
    expect(room({ g: { items: ['w-crystalstaff'] }, name: 'Zed' }).titles).toEqual(['Archmage Zed']);
    expect(room({ g: { items: ['w-sword'] } }).titles).toEqual([]);
    expect(room({ g: { items: ['g-goldarmor'] }, name: '  ' }).titles).toEqual([]);
  });

  it('counts chests (the ledger marker plus old card ids), bosses beaten, and Fluent facts', () => {
    const cards: CardMap = { 'mul:2x3': fluent('mul:2x3'), 'mul:4x5': fluent('mul:4x5'), 'mul:6x7': slow('mul:6x7'), 'mul:8x9': newCardState('mul:8x9', NOW) };
    const r = room({ w: world({ openedChests: ['#7', 'mul:1x1'], bossesDefeated: ['meadow', 'forest'] }), cards });
    expect(r.counts).toEqual({ chests: 8, bosses: 2, fluent: 2 });
  });

  it('a kid with no world save reads as zero chests and bosses, not an error', () => {
    expect(room({ w: null }).counts).toMatchObject({ chests: 0, bosses: 0 });
  });
});
