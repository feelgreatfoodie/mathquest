import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AREAS, EDGE, EDGE_TITLE, FILLS, HILLS, MIN_CONTRAST, PAIRS, SKY, contrast } from './tokens';
import { PIXEL_ICONS, PIXEL_ICON_NAMES } from './icons';
import { applyCrt, crtKey, readCrt, writeCrt } from './crt';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const varOf = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();

describe('pixel tokens: contrast', () => {
  it('has a known contrast scale', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
  for (const p of PAIRS) {
    it(`${p.name} is at least ${MIN_CONTRAST}:1`, () => {
      expect(contrast(p.fg, p.bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
  }
  it('lists a pair for every fill and area', () => {
    const names = PAIRS.map((p) => p.name).join('|');
    for (const k of [...Object.keys(FILLS), ...Object.keys(AREAS)]) expect(names).toContain(k);
  });
});

describe('pixel tokens: styles.css matches the table', () => {
  it('fills', () => {
    for (const [k, f] of Object.entries(FILLS)) {
      expect(varOf(`px-${k}`)).toBe(f.fill);
      expect(varOf(`px-${k}-dark`)).toBe(f.dark);
      expect(varOf(`px-${k}-text`)).toBe(f.text);
    }
  });
  it('areas', () => {
    for (const k of ['dungeon', 'adventure', 'lightning'] as const) {
      expect(varOf(`px-${k}`)).toBe(AREAS[k].fill);
      expect(varOf(`px-${k}-dark`)).toBe(AREAS[k].dark);
    }
  });
  it('edge, sky and hills', () => {
    expect(varOf('px-edge')).toBe(EDGE);
    expect(varOf('px-edge-title')).toBe(EDGE_TITLE);
    SKY.forEach((c, i) => expect(varOf(`px-sky-${i + 1}`)).toBe(c));
    HILLS.forEach((c, i) => expect(varOf(`px-hill-${i + 1}`)).toBe(c));
  });
  it('the frame has no radius and the 4 ring plus 2 bevel shadow', () => {
    const frame = /\.px-frame \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(frame).toContain('border-radius: 0');
    expect(frame).toContain('-4px 0 0 var(--e), 4px 0 0 var(--e), 0 -4px 0 var(--e), 0 4px 0 var(--e)');
    expect(frame).toContain('inset 0 4px 0 rgba(255, 255, 255, 0.18), inset 0 -6px 0 var(--d)');
  });
  it('buttons are at least 48 px, and 120 px for pre-readers', () => {
    expect(/\.px-btn \{[^}]*min-height: 48px/.test(css)).toBe(true);
    expect(/\.px-btn\.px-prereader \{[^}]*min-height: 120px/.test(css)).toBe(true);
  });
  it('every keyframe animation added for the pixel parts is behind prefers-reduced-motion', () => {
    const block = css.slice(css.indexOf('Modern pixel: tokens'));
    // Every reduced-motion block after the marker, so later sections can add their own.
    const reduced = block.split('@media (prefers-reduced-motion: reduce)').slice(1).map((b) => b.slice(0, 300)).join('\n');
    for (const sel of ['.px-twinkle', '.title-bat']) expect(reduced).toContain(sel);
  });
});

describe('pixel icon set', () => {
  it('has the 10 icons, each a 12 by 12 grid with every letter in its palette', () => {
    expect(PIXEL_ICON_NAMES.sort()).toEqual(['bolt', 'chest', 'flame', 'gem', 'house', 'key', 'speaker', 'star', 'torch', 'vault']);
    for (const name of PIXEL_ICON_NAMES) {
      const def = PIXEL_ICONS[name];
      expect(def.rows, name).toHaveLength(12);
      for (const row of def.rows) {
        expect(row, name).toHaveLength(12);
        for (const ch of row) if (ch !== '.') expect(Object.keys(def.palette), `${name} uses ${ch}`).toContain(ch);
      }
    }
  });
});

describe('CRT scanline switch', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  it('is off by default and per kid', () => {
    const s = mem();
    expect(readCrt('a', s)).toBe(false);
    writeCrt('a', true, s);
    expect(readCrt('a', s)).toBe(true);
    expect(readCrt('b', s)).toBe(false);
    expect(s.getItem(crtKey('a'))).toBe('1');
    writeCrt('a', false, s);
    expect(readCrt('a', s)).toBe(false);
  });
  it('survives blocked storage', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(readCrt('a', bad)).toBe(false);
    expect(() => writeCrt('a', true, bad)).not.toThrow();
  });
  it('sets and clears the page flag', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyCrt(true, root);
    expect(root.dataset.crt).toBe('on');
    applyCrt(false, root);
    expect(root.dataset.crt).toBeUndefined();
  });
});
