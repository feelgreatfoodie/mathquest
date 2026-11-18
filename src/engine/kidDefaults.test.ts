import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepo } from '../data/localRepo';
import { KidHome, Picker } from '../ui/screens/KidScreens';
import { levelFor } from './game';
import { DEFAULT_GAME, DEFAULT_SETTINGS, normalizeGame, normalizeKid, type Kid } from './models';

const bare = (game: unknown) => ({ id: 'k1', name: 'Zed', createdAt: 1, settings: { ...DEFAULT_SETTINGS }, game }) as Kid;

describe('kid game defaults', () => {
  it('reads game {} with every field at its default and a numeric level', () => {
    const k = normalizeKid(bare({}));
    expect(k.game).toEqual(DEFAULT_GAME);
    expect(levelFor(k.game.xp).level).toBe(1);
    expect(Number.isFinite(levelFor(k.game.xp).level)).toBe(true);
  });
  it('fills a missing game map and a null one', () => {
    expect(normalizeKid(bare(undefined)).game).toEqual(DEFAULT_GAME);
    expect(normalizeKid(bare(null)).game).toEqual(DEFAULT_GAME);
  });
  it('keeps stored values and fills only the missing fields', () => {
    const g = normalizeGame({ xp: 250, streakDays: 3, hero: 'mage', heroes: ['knight', 'mage'] });
    expect(g).toEqual({ ...DEFAULT_GAME, xp: 250, streakDays: 3, hero: 'mage', heroes: ['knight', 'mage'] });
  });
  it('replaces wrong-typed and non-finite values', () => {
    const g = normalizeGame({ xp: 'x', gems: NaN, bestCombo: null, lastPlayedDay: 5, heroes: [], hero: '' });
    expect(g).toEqual(DEFAULT_GAME);
  });
  it('does not share the heroes array with DEFAULT_GAME', () => {
    const g = normalizeGame({});
    g.heroes.push('mage');
    expect(DEFAULT_GAME.heroes).toEqual(['knight']);
  });
});

describe('kid with game {} through the repo and the screens', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  it('shows no NaN on the picker or the kid home', async () => {
    const repo = new LocalRepo();
    await repo.createKid(bare({}));
    const [listed] = await repo.listKids();
    const got = await repo.getKid('k1');
    expect(listed?.game).toEqual(DEFAULT_GAME);
    expect(got?.game).toEqual(DEFAULT_GAME);
    const noop = () => {};
    const home = renderToStaticMarkup(createElement(KidHome, { kid: got!, onStart: noop, onGame: async () => true, onBack: noop }));
    const pick = renderToStaticMarkup(createElement(Picker, { kids: [listed!], onPick: noop, onParent: noop }));
    expect(home).not.toContain('NaN');
    expect(pick).not.toContain('NaN');
    expect(home).toContain('LV 1');
    expect(pick).toContain('LV 1');
  });
});
