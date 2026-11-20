// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { drawScene, type Scene } from './draw';
import type { Entity } from './encounters';
import { MAPS, heroStart, tileAt, type Point } from './maps';
import { PET_TARGET_PX } from './pets';
import { BOOMERANG_RANGE, BOOMERANG_STREAK, BOW_RANGE, activeWeapon, boomerangStep, boomerangTarget, bowTarget, clearShot, monstersInRange } from './weapons';
import { LEGENDARY_ARMOR, LEGENDARY_STAFF, glowOf, lookSpot, roars, titleFor, wornLooks } from '../shop/looks';
import { ITEMS } from '../shop/catalog';
import { HeroFigure } from '../../ui/HeroFigure';
import { TitleBadge } from '../../ui/TitleBadge';
import { WHATS_NEW } from '../../whatsnew';

// Item powers, weapons and looks PR. PDR rule 1: no weapon and no look touches a question, an answer, timing or grading.

const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const NAME = 'Testa'; // a made-up display name: the code must use whatever name the kid has

const mon = (x: number, y: number, over: Partial<Entity> = {}): Entity => ({ id: `m${x}_${y}`, kind: 'monster', x, y, look: 'slime', cardId: 'c', shown: true, ...over });
const chest = (x: number, y: number): Entity => ({ id: `c${x}_${y}`, kind: 'chest', x, y, look: 'slime', cardId: 'c', shown: true });
const ctx = { gateOpen: true, hasKey: false, hasBridgeKit: false };
const meadow = MAPS.meadow;
const start = heroStart(meadow);
/** A row of walkable tiles to the right of the start, for placing monsters at known distances. */
function lineRight(n: number): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) out.push({ x: start.x + i, y: start.y });
  return out;
}

describe('weapons work only while owned and equipped', () => {
  it('names the weapon of the equipped item, and none when it is not owned, not equipped or has no power', () => {
    expect(activeWeapon('w-bow', ['w-bow'])).toBe('bow');
    expect(activeWeapon('w-boomerang', ['w-boomerang', 'w-bow'])).toBe('boomerang');
    expect(activeWeapon('w-bow', [])).toBeNull();
    expect(activeWeapon(undefined, ['w-bow'])).toBeNull();
    expect(activeWeapon('w-sword', ['w-sword'])).toBeNull();
    expect(activeWeapon('p-dog', ['p-dog'])).toBeNull();
  });
});

describe('Bow: a monster up to 3 tiles away', () => {
  it('reaches a monster within 3 tiles and no farther, never a chest, never one that waits off the map', () => {
    expect(BOW_RANGE).toBe(3);
    const [a, b, c, d] = lineRight(4) as [Point, Point, Point, Point];
    const near = monstersInRange([mon(a.x, a.y), mon(b.x, b.y), mon(c.x, c.y), mon(d.x, d.y)], start, meadow, BOW_RANGE);
    expect(near.map((e) => e.x)).toEqual([a.x, b.x, c.x]);
    expect(monstersInRange([chest(a.x, a.y)], start, meadow, BOW_RANGE)).toEqual([]);
    expect(monstersInRange([mon(a.x, a.y, { shown: false })], start, meadow, BOW_RANGE)).toEqual([]);
    expect(monstersInRange([mon(start.x, start.y)], start, meadow, BOW_RANGE)).toEqual([]); // on the hero's own tile: walking handles it
  });

  it('a wall between the hero and the monster stops the arrow', () => {
    const m = { ...meadow, rows: meadow.rows.map((r, y) => (y === start.y ? r.slice(0, start.x + 1) + 'W' + r.slice(start.x + 2) : r)) };
    expect(tileAt(m, start.x + 1, start.y)).toBe('wall');
    expect(clearShot(m, start, { x: start.x + 2, y: start.y })).toBe(false);
    expect(clearShot(meadow, start, { x: start.x + 2, y: start.y })).toBe(true);
  });

  // Geometry for the tap: 1 canvas pixel = 1 CSS pixel, 48 px tiles, no scroll.
  const rect = { left: 0, top: 0, width: 960 };
  const view = { t: 48, left: 0, top: 0 };
  const px = (p: Point) => ({ x: (p.x + 0.5) * 48, y: (p.y + 0.5) * 48 });
  const hero = { x: 5, y: 5 };
  const open = { ...meadow, w: 40, h: 40, rows: Array.from({ length: 40 }, () => '.'.repeat(40)) };

  it('a tap within 60 px of a monster in range hits it (a 120 px target); a tap 70 px off does not', () => {
    expect(PET_TARGET_PX).toBe(120);
    const target = mon(8, 5);
    const c = px(target);
    expect(bowTarget({ x: c.x + 55, y: c.y }, rect, 960, view, [target], hero, open)?.id).toBe(target.id);
    expect(bowTarget({ x: c.x + 70, y: c.y }, rect, 960, view, [target], hero, open)).toBeNull();
  });

  it('a monster 4 tiles away is not a target even when tapped dead center', () => {
    const far = mon(9, 5);
    expect(bowTarget(px(far), rect, 960, view, [far], hero, open)).toBeNull();
  });

  it('two monsters in range: the tap picks the one it is nearest to', () => {
    const a = mon(7, 5);
    const b = mon(8, 5);
    const c = px(b);
    expect(bowTarget({ x: c.x - 10, y: c.y }, rect, 960, view, [a, b], hero, open)?.id).toBe(b.id);
  });
});

describe('Boomerang: a 5-answer streak arms it, the next right answer throws it', () => {
  it('does not arm before 5 in a row, arms at 5, throws on the next right answer and then needs another 5', () => {
    expect(BOOMERANG_STREAK).toBe(5);
    let armed = false;
    const log: boolean[] = [];
    for (let combo = 1; combo <= 4; combo++) {
      const s = boomerangStep(armed, true, combo);
      armed = s.armed;
      log.push(s.armed || s.throws);
    }
    expect(log).toEqual([false, false, false, false]);
    let s = boomerangStep(armed, true, 5);
    expect(s).toEqual({ armed: true, throws: false });
    s = boomerangStep(s.armed, true, 6);
    expect(s).toEqual({ armed: false, throws: true });
    s = boomerangStep(s.armed, true, 7);
    expect(s).toEqual({ armed: false, throws: false });
    expect(boomerangStep(false, true, 10)).toEqual({ armed: true, throws: false });
  });

  it('a wrong answer disarms it and never throws', () => {
    expect(boomerangStep(true, false, 0)).toEqual({ armed: false, throws: false });
    expect(boomerangStep(false, false, 0)).toEqual({ armed: false, throws: false });
  });

  it('clears the nearest monster in range, ties by position, and nothing when none is in reach', () => {
    expect(BOOMERANG_RANGE).toBe(3);
    const [a, b, c, d] = lineRight(4) as [Point, Point, Point, Point];
    expect(boomerangTarget([mon(c.x, c.y), mon(b.x, b.y)], start, meadow, ctx)?.x).toBe(b.x);
    expect(boomerangTarget([mon(d.x, d.y)], start, meadow, ctx)).toBeNull();
    expect(boomerangTarget([chest(a.x, a.y)], start, meadow, ctx)).toBeNull();
    expect(boomerangTarget([], start, meadow, ctx)).toBeNull();
  });
});

describe('wearables: only the owned and equipped ones show', () => {
  const game = (items: string[], equipped: Record<string, string>) => ({ items, equipped }) as never;
  it('shows an equipped, owned piece and drops an equipped piece that is not owned or an owned piece that is not equipped', () => {
    expect(wornLooks(game(['g-cape', 'w-bow'], { gear: 'g-cape', weapon: 'w-bow' }))).toEqual({ gear: 'g-cape', weapon: 'w-bow' });
    expect(wornLooks(game([], { gear: 'g-cape' }))).toEqual({});
    expect(wornLooks(game(['g-cape'], {}))).toEqual({});
  });

  it('gives every gear piece and weapon a spot on the hero, and draws behind only the cape', () => {
    for (const i of ITEMS.filter((x) => x.slot === 'gear' || x.slot === 'weapon')) {
      const s = lookSpot(i.id);
      expect(s.size, i.id).toBeGreaterThan(0.4);
      expect(s.behind, i.id).toBe(i.id === 'g-cape');
    }
  });

  afterEach(() => vi.restoreAllMocks());

  function drawn(worn: Scene['worn'], glow?: Scene['glow'], facing: 'left' | 'right' = 'right') {
    const calls: unknown[][] = [];
    const gradients: number[] = [];
    const g = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : k === 'drawImage' ? (...a: unknown[]) => void calls.push(a) : k === 'createRadialGradient' ? () => { gradients.push(1); return { addColorStop() {} }; } : () => undefined),
      set: (t, k: string, v) => ((t[k] = v), true),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(g as never);
    const scene = {
      map: meadow, hero: { x: start.x, y: start.y, facing, frame: 0 }, heroSprite: 'knight', entities: [], gateOpen: true, campLit: false, bossDefeated: false,
      hasKey: false, hasBridgeKit: false, openedChests: [], lantern: false, time: 1, marker: null, ...(worn ? { worn } : {}), ...(glow ? { glow } : {}),
    } as Scene;
    drawScene(g as unknown as CanvasRenderingContext2D, 640, 480, 4, scene);
    return { calls: calls.filter((c) => c.length === 9), gradients: gradients.length };
  }

  it('the map hero draws one extra sprite for the gear and one for the weapon, and none without them', () => {
    const none = drawn(undefined).calls.length;
    expect(drawn({ gear: 'g-wizhat' }).calls.length).toBe(none + 1);
    expect(drawn({ gear: 'g-cape', weapon: 'w-sword' }).calls.length).toBe(none + 2);
  });

  it('the cape is drawn before the hero and a hat after it; a hero facing left mirrors the piece', () => {
    const sizes = (w: Scene['worn']) => drawn(w).calls.map((c) => c[7]);
    const base = sizes(undefined);
    const cape = sizes({ gear: 'g-cape' });
    const hat = sizes({ gear: 'g-wizhat' });
    const capeAt = cape.findIndex((s, i) => s !== base[i]);
    const hatAt = hat.findIndex((s, i) => s !== base[i]);
    expect(capeAt).toBeGreaterThanOrEqual(0);
    expect(hatAt).toBeGreaterThan(capeAt); // the hat sits in the hero's row after the hero; the cape before it
    expect(drawn({ gear: 'g-wizhat' }, undefined, 'left').calls.length).toBe(drawn({ gear: 'g-wizhat' }).calls.length);
  });

  it('the legendary glow adds one gradient behind the hero, and none without it', () => {
    const base = drawn(undefined).gradients;
    expect(drawn(undefined, 'gold').gradients).toBe(base + 1);
    expect(drawn(undefined, 'cyan').gradients).toBe(base + 1);
  });
});

describe('legendary glow and titles', () => {
  const game = (items: string[], equipped: Record<string, string>) => ({ items, equipped }) as never;
  it('glows gold in the armor and cyan with the staff, only while worn and owned', () => {
    expect(glowOf(game([LEGENDARY_ARMOR], { gear: LEGENDARY_ARMOR }))).toBe('gold');
    expect(glowOf(game([LEGENDARY_STAFF], { weapon: LEGENDARY_STAFF }))).toBe('cyan');
    expect(glowOf(game([LEGENDARY_ARMOR], {}))).toBeNull();
    expect(glowOf(game([], { gear: LEGENDARY_ARMOR }))).toBeNull();
    expect(glowOf(game(['g-cape'], { gear: 'g-cape' }))).toBeNull();
  });

  it('the title comes from the kid name at runtime: Sir for the armor, Archmage for the staff, none without either', () => {
    expect(titleFor(game([LEGENDARY_ARMOR], {}), NAME)).toBe(`Sir ${NAME}`);
    expect(titleFor(game([LEGENDARY_STAFF], {}), NAME)).toBe(`Archmage ${NAME}`);
    expect(titleFor(game([LEGENDARY_ARMOR], {}), 'Maple')).toBe('Sir Maple');
    expect(titleFor(game(['g-cape', 'w-bow'], { gear: 'g-cape' }), NAME)).toBeNull();
    expect(titleFor(game([], { gear: LEGENDARY_ARMOR }), NAME)).toBeNull();
    expect(titleFor(game([LEGENDARY_ARMOR], {}), '  ')).toBeNull();
  });

  it('with both owned, the worn one picks the title, else the armor', () => {
    const both = [LEGENDARY_ARMOR, LEGENDARY_STAFF];
    expect(titleFor(game(both, { weapon: LEGENDARY_STAFF }), NAME)).toBe(`Archmage ${NAME}`);
    expect(titleFor(game(both, { gear: LEGENDARY_ARMOR }), NAME)).toBe(`Sir ${NAME}`);
    expect(titleFor(game(both, {}), NAME)).toBe(`Sir ${NAME}`);
  });

  it('HeroFigure glows with the legendary item worn and not with a plain one', () => {
    const on = renderToStaticMarkup(createElement(HeroFigure, { game: { hero: 'knight', items: [LEGENDARY_ARMOR], equipped: { gear: LEGENDARY_ARMOR } } as never, size: 96 }));
    expect(on).toContain('hero-glow-gold');
    const off = renderToStaticMarkup(createElement(HeroFigure, { game: { hero: 'knight', items: ['g-cape'], equipped: { gear: 'g-cape' } } as never, size: 96 }));
    expect(off).not.toContain('hero-glow');
  });

  it('the title badge shows the title, a pre-reader gets a 120 px picture button, and nothing shows without a legendary item', () => {
    const g = { items: [LEGENDARY_STAFF], equipped: {} } as never;
    const reader = renderToStaticMarkup(createElement(TitleBadge, { game: g, name: NAME }));
    expect(reader).toContain(`Archmage ${NAME}`);
    const pic = renderToStaticMarkup(createElement(TitleBadge, { game: g, name: NAME, picture: true }));
    expect(pic).toContain('kid-title-pic');
    expect(pic).toContain(`aria-label="Archmage ${NAME}"`);
    expect(renderToStaticMarkup(createElement(TitleBadge, { game: { items: [], equipped: {} } as never, name: NAME }))).toBe('');
    expect(read('../../styles.css')).toMatch(/button\.kid-title-pic \{[^}]*min-width: 120px; min-height: 120px/);
  });

  it('no kid name is written in the title code', () => {
    for (const f of ['../shop/looks.ts', '../../ui/TitleBadge.tsx']) {
      const src = noComments(read(f));
      expect(src, f).not.toMatch(/['"`](Sir|Archmage) [A-Za-z]/);
    }
  });
});

describe('Dino Hood roar', () => {
  it('roars on a boss win only while the hood is worn and owned', () => {
    expect(roars({ items: ['g-dinohood'], equipped: { gear: 'g-dinohood' } } as never)).toBe(true);
    expect(roars({ items: ['g-dinohood'], equipped: {} } as never)).toBe(false);
    expect(roars({ items: [], equipped: { gear: 'g-dinohood' } } as never)).toBe(false);
    expect(roars({ items: ['g-helm'], equipped: { gear: 'g-helm' } } as never)).toBe(false);
  });
});

describe('rule 1: nothing makes the math easier, no gem moves, nothing is written', () => {
  it('the weapon and look modules read no session, grading, gem, world or card state', () => {
    for (const f of ['./weapons.ts', '../shop/looks.ts', '../../ui/TitleBadge.tsx']) {
      const src = noComments(read(f));
      expect(src, f).not.toMatch(/engine\/(session|grading|gems|game|mastery|scheduler|problems)'/);
      expect(src, f).not.toMatch(/answerEntry|gemGrant|applyDelta|saveWorld|touchWorld|saveTrip|\.gems\b|\bxp\b/);
    }
  });

  it('no engine, grading or boss file knows a weapon or a look', () => {
    for (const f of ['../../engine/session.ts', '../../engine/grading.ts', './boss.ts', './tripPlan.ts', './encounters.ts', './chests.ts']) {
      expect(read(f), f).not.toMatch(/w-bow|w-boomerang|boomerang|bowTarget|activeWeapon|glowOf|titleFor|roars\(/);
    }
  });

  it('the Overworld starts the same fight a walk would: a shot lands in openEntity and the boomerang waits for a right map answer', () => {
    const src = noComments(read('./Overworld.tsx'));
    expect(src).toMatch(/if \(target\) openEntity\(target\)/);
    expect(src).toMatch(/boomerangStep\(boomArmed\.current, fb\.verdict === 'correct', fb\.combo\)/);
    expect(src).toMatch(/step\.throws && !m\.boss/);
    // The weapon paths never call the question flow with a grade, a timer, or a gem grant.
    const at = src.indexOf('const shootAt');
    const block = src.slice(at, src.indexOf('}, [say]);', at));
    expect(block).not.toMatch(/answerEntry|grant\(|touchWorld|clock|Date\.now/);
  });

  it('the Bow and the Boomerang run only on the equipped, owned weapon', () => {
    const src = noComments(read('./Overworld.tsx'));
    expect(src).toMatch(/activeWeapon\(kid\.game\.equipped\?\.weapon, items\)/);
    expect(src).toMatch(/weaponRef\.current === 'bow'/);
    expect(src).toMatch(/weaponRef\.current !== 'boomerang'\) boomArmed\.current = false/);
  });
});

describe('whatsnew', () => {
  it('has an entry for this change', () => {
    expect(WHATS_NEW.some((e) => /Bow/.test(e.text) && /Boomerang/.test(e.text))).toBe(true);
  });
});
