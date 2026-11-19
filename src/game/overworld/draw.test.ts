// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawScene, type Scene } from './draw';
import { MAPS, findTiles, heroStart } from './maps';

/** A 2D context that records every fill colour, stroke colour and path call, so the test reads what was drawn. */
function recorder() {
  const fills: string[] = [];
  const calls: string[] = [];
  const target: Record<string, unknown> = {};
  const g = new Proxy(target, {
    get: (t, k: string) => (k in t ? t[k] : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : (...a: unknown[]) => void calls.push(k + ':' + a.length)),
    set: (t, k: string, v) => {
      if (k === 'fillStyle' || k === 'strokeStyle') fills.push(String(v));
      t[k] = v;
      return true;
    },
  });
  return { g: g as unknown as CanvasRenderingContext2D, fills, calls };
}

const GOLD = /251,\s*191,\s*36|#fbbf24/i;

describe('camp lit: no guide to the campfire is drawn', () => {
  afterEach(() => vi.restoreAllMocks());

  it('draws no gold trail, no arrow and no path even when a guide path is handed to the scene', () => {
    const atlas = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(atlas.g as never);
    const map = MAPS.meadow;
    const hero = heroStart(map);
    const camp = findTiles(map, 'camp')[0]!;
    const path = [{ x: hero.x + 1, y: hero.y }, { x: hero.x + 2, y: hero.y }, camp];
    const scene = {
      map, hero: { x: hero.x, y: hero.y, facing: 'right', frame: 0 }, heroSprite: 'knight', entities: [], gateOpen: true,
      campLit: true, bossDefeated: false, hasKey: false, hasBridgeKit: false, openedChests: [], lantern: false, time: 1, marker: null,
      campGuide: path, // an old caller; nothing may draw it
    } as unknown as Scene;
    const draw = recorder();
    drawScene(draw.g, 640, 480, 4, scene);
    expect(draw.fills.filter((c) => GOLD.test(c))).toEqual([]);
    expect(draw.calls.filter((c) => c.startsWith('moveTo') || c.startsWith('lineTo') || c.startsWith('closePath'))).toEqual([]);
  });
});
