import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEROES, GameDeltaError, applyDelta, dayKey } from './game';
import { DEFAULT_GAME } from './models';

const T0 = Date.parse('2026-11-17T20:00:00Z');
const DAY = 86_400_000;
const rich = { ...DEFAULT_GAME, gems: 40, xp: 100, bestCombo: 6 };

describe('applyDelta', () => {
  it('adds xp and gems, keeps the best combo as a max, moves the streak', () => {
    const a = applyDelta(rich, { xp: 50, gems: 5, bestCombo: 4, playedAt: T0 });
    expect(a).toMatchObject({ xp: 150, gems: 45, bestCombo: 6, streakDays: 1 });
    const b = applyDelta(a, { xp: 10, gems: 1, bestCombo: 9, playedAt: T0 + DAY });
    expect(b).toMatchObject({ xp: 160, gems: 46, bestCombo: 9, streakDays: 2 });
    expect(applyDelta(b, { xp: 1, playedAt: T0 + DAY + 1000 }).streakDays).toBe(2);
    expect(applyDelta(b, { xp: 1, playedAt: T0 + 5 * DAY }).streakDays).toBe(1);
  });

  it('a purchase spends the price, adds the hero and equips it, all or nothing', () => {
    const g = applyDelta(rich, { purchase: 'wizard' });
    expect(g.gems).toBe(25);
    expect(g.heroes).toEqual(['knight', 'wizard']);
    expect(g.hero).toBe('wizard');
    expect(() => applyDelta(g, { purchase: 'wizard' })).toThrow(GameDeltaError);
    expect(() => applyDelta(g, { purchase: 'dragon' })).toThrow(/Not enough gems/);
    expect(() => applyDelta(g, { purchase: 'nobody' })).toThrow(GameDeltaError);
  });

  it('equip needs an owned hero; negative xp and a negative gem balance are refused', () => {
    expect(() => applyDelta(rich, { equip: 'robot' })).toThrow(GameDeltaError);
    expect(applyDelta(applyDelta(rich, { purchase: 'wizard' }), { equip: 'knight' }).hero).toBe('knight');
    expect(() => applyDelta(rich, { xp: -1 })).toThrow(GameDeltaError);
    expect(() => applyDelta(rich, { gems: -41 })).toThrow(GameDeltaError);
  });

  it('does not change the game it was given', () => {
    const copy = JSON.parse(JSON.stringify(rich));
    applyDelta(rich, { xp: 5, purchase: 'wizard' });
    expect(rich).toEqual(copy);
  });
});

describe('the hero price map in firestore.rules', () => {
  it('lists every hero at its catalog price and nothing else', () => {
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const body = /function heroPrices\(\) \{\s*return \{([^}]*)\};/.exec(rules);
    expect(body).not.toBeNull();
    const map: Record<string, number> = {};
    for (const m of body![1]!.matchAll(/'([a-z]+)':\s*(\d+)/g)) map[m[1]!] = Number(m[2]);
    expect(map).toEqual(Object.fromEntries(HEROES.map((h) => [h.id, h.cost])));
  });
});

describe('who writes game', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
    });
  const src = walk(new URL('..', import.meta.url).pathname).map((p) => [p, readFileSync(p, 'utf8')] as const);

  it('no full-kid save exists: nothing calls or declares saveKid', () => {
    const hits = src.filter(([, t]) => /\bsaveKid\s*[(:]/.test(t)).map(([p]) => p);
    expect(hits).toEqual([]);
  });

  it('only the two repos write a kid doc, and only applyGameDelta writes game', () => {
    const kidWrites = src.filter(([, t]) => /\b(setDoc|updateDoc)\(\s*doc\(this\.kids\(\)/.test(t) || /tx\.(set|update)\(ref/.test(t)).map(([p]) => p.split('/src/')[1]);
    expect(kidWrites.sort()).toEqual(['data/firestoreRepo.ts']);
    const gameWrites = src.filter(([, t]) => /\{\s*game\s*[:}]|\bgame:\s*next/.test(t) && /(updateDoc|tx\.update|setDoc)/.test(t)).map(([p]) => p.split('/src/')[1]);
    expect(gameWrites).toEqual(['data/firestoreRepo.ts']);
  });
});

describe('applyDelta: gems earned today and gemRun', () => {
  const stats = { correct: 27, graded: 30, bestCombo: 8, newLearned: 0 }; // base 9
  const gemRun = { stats, learner: 'reader' as const, settings: {} };
  const dayOf = (ms: number) => dayKey(ms);

  it('a run adds its gems to gemsEarnedToday and stamps gemsDay', () => {
    const g = applyDelta(rich, { xp: 10, gems: 9, playedAt: T0 });
    expect(g).toMatchObject({ gems: 49, gemsEarnedToday: 9, gemsDay: dayOf(T0) });
    const h = applyDelta(g, { xp: 10, gems: 4, playedAt: T0 + 1000 });
    expect(h).toMatchObject({ gems: 53, gemsEarnedToday: 13, gemsDay: dayOf(T0) });
  });

  it('a new day starts the count again; the balance carries over', () => {
    const g = applyDelta(applyDelta(rich, { gems: 9, playedAt: T0 }), { gems: 7, playedAt: T0 + DAY });
    expect(g).toMatchObject({ gems: 56, gemsEarnedToday: 7, gemsDay: dayOf(T0 + DAY) });
  });

  it('a purchase and an equip leave the count alone', () => {
    const g = applyDelta(rich, { gems: 9, playedAt: T0 });
    const bought = applyDelta(g, { purchase: 'wizard' });
    expect(bought.gems).toBe(g.gems - 15);
    expect(bought).toMatchObject({ gemsEarnedToday: 9, gemsDay: dayOf(T0) });
  });

  it('gemRun works out the gems from the count in the game it is applied to, not from a copy the screen held', () => {
    const full = applyDelta(rich, { gemRun, playedAt: T0 });
    expect(full.gems).toBe(49);
    expect(full.gemsEarnedToday).toBe(9);
    // Another device already earned 30 today: the same run is now at half rate (9 * 0.5 = 4).
    const busy = { ...rich, gemsEarnedToday: 30, gemsDay: dayOf(T0) };
    const half = applyDelta(busy, { gemRun, playedAt: T0 });
    expect(half.gems).toBe(44);
    expect(half.gemsEarnedToday).toBe(34);
  });

  it('gemRun without playedAt is refused', () => {
    expect(() => applyDelta(rich, { gemRun })).toThrow(GameDeltaError);
  });

  it('no clawback: no run lowers a balance or removes a hero, at any tier', () => {
    const owned = { ...rich, gems: 200, heroes: ['knight', 'wizard', 'ranger', 'robot', 'dragon'], hero: 'dragon', gemsEarnedToday: 900, gemsDay: dayOf(T0) };
    const after = applyDelta(owned, { gemRun, playedAt: T0 });
    expect(after.gems).toBeGreaterThanOrEqual(200);
    expect(after.heroes).toEqual(owned.heroes);
    // A stored game with no gemsEarnedToday (every game before this change) reads as 0 earned and keeps its balance.
    expect(applyDelta({ ...rich, gems: 202 }, { gemRun, playedAt: T0 }).gems).toBe(211);
  });
});

describe('applyDelta: map rewards (gemGrant) go through the throttle', () => {
  const grant = (base: number) => ({ gemGrant: { base, learner: 'reader' as const, settings: {} }, playedAt: T0 });
  const after25 = () => applyDelta(applyDelta(applyDelta(rich, { gems: 10, playedAt: T0 }), { gems: 10, playedAt: T0 }), { gems: 5, playedAt: T0 });

  it('at the full tier a boss pays 10 and a chest pays 1, and both count toward today', () => {
    const b = applyDelta(rich, grant(10));
    expect(b).toMatchObject({ gems: rich.gems + 10, gemsEarnedToday: 10, gemsDay: dayKey(T0) });
    expect(applyDelta(rich, grant(1))).toMatchObject({ gems: rich.gems + 1, gemsEarnedToday: 1 });
  });
  it('after 25 run gems in a day the half tier applies: a boss pays 5 and a chest pays 1 (the minimum)', () => {
    const g = after25();
    expect(g.gemsEarnedToday).toBe(25);
    expect(applyDelta(g, grant(10))).toMatchObject({ gems: g.gems + 5, gemsEarnedToday: 30 });
    expect(applyDelta(g, grant(1)).gems).toBe(g.gems + 1);
  });
  it('after 50 the quarter tier pays a boss 2', () => {
    let g = after25();
    g = applyDelta(applyDelta(g, { gems: 10, playedAt: T0 }), { gems: 10, playedAt: T0 });
    g = applyDelta(g, { gems: 5, playedAt: T0 });
    expect(g.gemsEarnedToday).toBe(50);
    expect(applyDelta(g, grant(10)).gems).toBe(g.gems + 2);
  });
  it('a chest earned at the full tier moves the count, so a later run starts in the half tier', () => {
    let g = applyDelta(applyDelta(rich, { gems: 10, playedAt: T0 }), { gems: 10, playedAt: T0 });
    g = applyDelta(g, { gems: 4, playedAt: T0 });
    g = applyDelta(g, grant(1)); // 24 + 1 = 25
    expect(g.gemsEarnedToday).toBe(25);
  });
  it('a grant without the time it was earned is refused', () => {
    expect(() => applyDelta(rich, { gemGrant: { base: 10, learner: 'reader', settings: {} } })).toThrow(GameDeltaError);
  });
});
