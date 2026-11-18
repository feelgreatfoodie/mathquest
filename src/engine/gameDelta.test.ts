import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEROES, MAX_HERO_PRICE, GameDeltaError, applyDelta } from './game';
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

describe('the gems guard in firestore.rules', () => {
  it('holds the same maximum as the dearest hero', () => {
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const m = /function maxHeroPrice\(\) \{\s*return (\d+);/.exec(rules);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(MAX_HERO_PRICE);
    expect(MAX_HERO_PRICE).toBe(Math.max(...HEROES.map((h) => h.cost)));
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
