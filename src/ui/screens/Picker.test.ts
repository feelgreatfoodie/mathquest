// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME, DEFAULT_SETTINGS, avatarOf, type Kid } from '../../engine/models';
import { Picker } from './KidScreens';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (id: string, name: string, extra: Partial<Kid> = {}): Kid => ({ id, name, createdAt: 1, settings: { ...DEFAULT_SETTINGS }, game: { ...DEFAULT_GAME }, ...extra });

describe('Picker (UX review item 9)', () => {
  it('shows each player with their own hero and color; the whole card is one button', () => {
    const kids = [mk('kidaaaa', 'Ann', { avatar: { hero: 'wizard', color: 'blue' } }), mk('kidbbbb', 'Bo', { avatar: { hero: 'dragon', color: 'green' } })];
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => createRoot(host).render(createElement(Picker, { kids, onPick: () => undefined, onParent: () => undefined })));
    const cards = [...host.querySelectorAll<HTMLButtonElement>('button.kid-card')];
    expect(cards.map((c) => [c.dataset.hero, c.dataset.color])).toEqual([['wizard', 'blue'], ['dragon', 'green']]);
    expect(cards.map((c) => c.textContent)).toEqual([expect.stringContaining('Ann'), expect.stringContaining('Bo')]);
  });

  it('an old kid doc with no avatar keeps its game hero and gets a stable color from its id', () => {
    const a = avatarOf(mk('kidaaaa', 'Ann', { game: { ...DEFAULT_GAME, hero: 'robot' } }));
    expect(a.hero).toBe('robot');
    expect(avatarOf(mk('kidaaaa', 'Ann')).color).toBe(avatarOf(mk('kidaaaa', 'Zed')).color);
  });
});
