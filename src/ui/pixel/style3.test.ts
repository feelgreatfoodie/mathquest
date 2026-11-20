import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GROWNUPS_LIGHT, MIN_CONTRAST, PANEL, PAIRS, STATUS, STATUS_LIGHT, contrast } from './tokens';
import { readTheme, themeKey, writeTheme } from './theme';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const varOf = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();
const block = css.slice(css.indexOf('style-3: Grown-ups area'));

const KEYS = ['notStarted', 'missed', 'learning', 'reviewing', 'solid', 'fluent'] as const;
const VAR: Record<(typeof KEYS)[number], string> = { notStarted: 'st-none', missed: 'st-missed', learning: 'st-learning', reviewing: 'st-reviewing', solid: 'st-solid', fluent: 'st-fluent' };
const lightRule = /\.screen\.parent\[data-theme='light'\] \{[^}]*\}/.exec(css)?.[0] ?? '';
const lightVar = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(lightRule)?.[1]?.toLowerCase();

describe('style-3: mastery colors, one blue ramp', () => {
  for (const [theme, table, panel] of [['dark', STATUS, PANEL.dark], ['light', STATUS_LIGHT, PANEL.light]] as const) {
    it(`${theme}: every number is at least 4.5:1 on its fill, and every fill has a pair in PAIRS`, () => {
      for (const k of KEYS) {
        const t = table[k];
        expect(contrast(t.text, t.fill ?? panel), `${theme} ${k}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
      const names = PAIRS.map((p) => p.name);
      for (const k of KEYS) expect(names.filter((n) => n.includes(`status ${k} text on fill`) && (theme === 'light') === n.startsWith('light theme')), `${theme} ${k}`).toHaveLength(1);
    });
    it(`${theme}: Reviewing is not white on #2b7be0 (4.19:1 fails AA at grid size)`, () => {
      expect(contrast('#ffffff', STATUS.reviewing.fill)).toBeLessThan(MIN_CONTRAST);
      expect(table.reviewing.text).not.toBe('#ffffff');
    });
    it(`${theme}: the ramp gets darker from Learning to Fluent, each step at least 1.4:1 apart`, () => {
      const order = ['learning', 'reviewing', 'solid', 'fluent'] as const;
      const fills = order.map((k) => table[k].fill);
      for (let i = 0; i < fills.length - 1; i++) expect(contrast(fills[i]!, fills[i + 1]!), `${order[i]} to ${order[i + 1]}`).toBeGreaterThanOrEqual(1.4);
    });
  }
  it('dark ramp keeps the fills Flynn approved', () => {
    expect(STATUS.missed.fill).toBe('#ff8a5c');
    expect(STATUS.learning.fill).toBe('#62b4ff');
    expect(STATUS.reviewing.fill).toBe('#2b7be0');
    expect(STATUS.solid.fill).toBe('#1c4585');
    expect(STATUS.fluent.fill).toBe('#131a33');
    expect(STATUS.fluent.border).toBe('#28335c');
    expect(STATUS.notStarted.border).toBe('#5a6594');
    expect(STATUS.notStarted.fill).toBeNull();
  });
  it('light fluent is not near-white and stays apart from the panel', () => {
    expect(STATUS_LIGHT.fluent.fill).not.toBe('#ffffff');
    expect(contrast(STATUS_LIGHT.fluent.border, PANEL.light)).toBeGreaterThanOrEqual(1.5);
  });
  it('styles.css matches both tables', () => {
    for (const k of KEYS) {
      const v = VAR[k];
      const d = STATUS[k];
      const l = STATUS_LIGHT[k];
      if (d.fill) expect(varOf(v), v).toBe(d.fill);
      expect(varOf(`${v}-text`), `${v}-text`).toBe(d.text);
      expect(lightVar(`${v}-text`), `light ${v}-text`).toBe(l.text);
      if (l.fill) expect(lightVar(v), `light ${v}`).toBe(l.fill);
    }
    expect(varOf('st-none-border')).toBe(STATUS.notStarted.border);
    expect(varOf('st-fluent-border')).toBe(STATUS.fluent.border);
    expect(lightVar('st-fluent-border')).toBe(STATUS_LIGHT.fluent.border);
    expect(lightVar('st-none-border')).toBe(STATUS_LIGHT.notStarted.border);
  });
  it('maps lv0 to lv4 and leech onto the variables, with no other mastery color left', () => {
    expect(block).toContain('.lv0 { background: transparent; color: var(--st-none-text); border: 1px dashed var(--st-none-border)');
    expect(block).toContain('.lv1 { background: var(--st-learning)');
    expect(block).toContain('.lv2 { background: var(--st-reviewing)');
    expect(block).toContain('.lv3 { background: var(--st-solid)');
    expect(block).toContain('.lv4 { background: var(--st-fluent)');
    expect(block).toContain('.leech { background: var(--st-missed)');
    expect(css.match(/^\.lv[0-4] \{/gm)).toHaveLength(5);
    expect(css).not.toMatch(/outline: 3px solid #fb923c/);
    for (const old of ['#d97706', '#4ade80', '#3b3f8c', '#a7f3d0']) expect(block.slice(0, block.indexOf('.ins-state.locked'))).not.toContain(old);
  });
  it('the Grown-ups legends list Missed 3+ times first and Not started last', () => {
    const parent = readFileSync(new URL('../screens/Parent.tsx', import.meta.url), 'utf8');
    const insights = readFileSync(new URL('../InsightsPanel.tsx', import.meta.url), 'utf8');
    expect(parent).not.toContain('swatch lv1 leech');
    expect(parent.match(/swatch leech/g)).toHaveLength(1); // one shared GridLegend for both grids
    expect(parent).toContain('([1, 2, 3, 4, 0] as Level[])');
    expect(insights).toContain('([1, 2, 3, 4, 0] as Level[])');
  });
});

describe('style-3: light theme', () => {
  it('every light pair is at least 4.5:1', () => {
    const light = PAIRS.filter((p) => p.name.startsWith('light theme'));
    expect(light.length).toBeGreaterThanOrEqual(10);
    for (const p of light) expect(contrast(p.fg, p.bg), p.name).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
  it('styles.css sets the light table on the Grown-ups screen only', () => {
    const rule = /\.screen\.parent\[data-theme='light'\] \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain(`--bg: ${GROWNUPS_LIGHT.bg}`);
    expect(rule).toContain(`--panel: ${GROWNUPS_LIGHT.panel}`);
    expect(rule).toContain(`--text: ${GROWNUPS_LIGHT.text}`);
    expect(rule).toContain(`--muted: ${GROWNUPS_LIGHT.muted}`);
    expect(css).not.toMatch(/html\[data-theme=['"]light['"]\]/);
  });
});

describe('style-3: theme storage is per parent, on this device', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  it('is dark by default and each parent keeps their own choice', () => {
    const s = mem();
    expect(readTheme('parent-a', s)).toBe('dark');
    writeTheme('parent-a', 'light', s);
    expect(readTheme('parent-a', s)).toBe('light');
    expect(readTheme('parent-b', s)).toBe('dark');
    expect(s.getItem(themeKey('parent-a'))).toBe('light');
    writeTheme('parent-a', 'dark', s);
    expect(readTheme('parent-a', s)).toBe('dark');
  });
  it('survives blocked storage', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(readTheme('p', bad)).toBe('dark');
    expect(() => writeTheme('p', 'light', bad)).not.toThrow();
  });
});

describe('style-3: motion and shape rules', () => {
  it('has no radius above 0 on the new scene pieces', () => {
    const scenes = css.slice(css.indexOf('style-3: the shop stall'));
    expect(scenes).not.toMatch(/border-radius: [1-9]/);
  });
  it('the walk pad has the size and look of the first build (#29) for every player', () => {
    // adventure-pad-toast, TENSOR task anbU4hhJ: 64 px keys, a 204 px pad, no 120 px picture-player override.
    expect(css).toMatch(/\.ow-dir \{ width: 64px; height: 64px; border-radius: 16px;/);
    expect(css).toMatch(/\.ow-dpad \{[^}]*width: 204px; height: 204px;/);
    expect(css).not.toMatch(/\.ow-pre \.ow-dpad/);
  });
});
