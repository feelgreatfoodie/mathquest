// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawScene, type Scene } from './draw';
import { MAPS, findTiles, heroStart, tileAt } from './maps';

/** A 2D context that records fill colors and the source row of every drawImage, so the test reads what was drawn. */
function recorder() {
  const fills: string[] = [];
  const images: number[][] = [];
  const target: Record<string, unknown> = {};
  const g = new Proxy(target, {
    get: (t, k: string) => {
      if (k in t) return t[k];
      if (k === 'drawImage') return (...a: unknown[]) => void images.push(a.slice(1, 5) as number[]);
      if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => undefined;
    },
    set: (t, k: string, v) => {
      if (k === 'fillStyle') fills.push(String(v));
      t[k] = v;
      return true;
    },
  });
  return { g: g as unknown as CanvasRenderingContext2D, fills, images };
}

const SHADOW = 'rgba(8, 12, 24, 0.26)';

function scene(over: Partial<Scene> = {}): Scene {
  const map = MAPS.meadow;
  const hero = heroStart(map);
  return {
    map, hero: { x: hero.x, y: hero.y, facing: 'right', frame: 0 }, heroSprite: 'knight', entities: [], gateOpen: true,
    campLit: false, bossDefeated: false, hasKey: false, hasBridgeKit: false, openedChests: [], lantern: false, time: 0, marker: null, ...over,
  };
}

describe('Adventure polish', () => {
  afterEach(() => vi.restoreAllMocks());

  it('map has trees or rocks with open ground below, so a shadow is expected', () => {
    const map = MAPS.meadow;
    const spots = [...findTiles(map, 'tree'), ...findTiles(map, 'rock')].filter((p) => !['tree', 'rock', 'wall', 'water'].includes(tileAt(map, p.x, p.y + 1)));
    expect(spots.length).toBeGreaterThan(0);
  });

  it('draws a soft shadow band under trees and rocks', () => {
    const atlas = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(atlas.g as never);
    const draw = recorder();
    const s = scene();
    const hero = heroStart(s.map);
    // Look at the whole map, around the hero: a view as big as the map.
    drawScene(draw.g, s.map.w * 12 * 2, s.map.h * 12 * 2, 2, { ...s, hero: { ...s.hero, x: s.map.w / 2, y: s.map.h / 2 } });
    expect(hero).toBeTruthy();
    expect(draw.fills).toContain(SHADOW);
    expect(draw.fills).toContain('rgba(8, 12, 24, 0.14)');
  });

  it('swaps water to its second frame, and holds the first frame under reduced motion', () => {
    const atlas = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(atlas.g as never);
    const rows = (time: number, still: boolean) => {
      const r = recorder();
      const s = scene({ time, still });
      drawScene(r.g, s.map.w * 12 * 2, s.map.h * 12 * 2, 2, { ...s, hero: { ...s.hero, x: s.map.w / 2, y: s.map.h / 2 } });
      return r.images.map((i) => i[1]).join(',');
    };
    expect(rows(0, false)).not.toBe(rows(0.6, false));
    expect(rows(0, true)).toBe(rows(0.6, true));
    expect(rows(0, true)).toBe(rows(0, false));
  });
});
