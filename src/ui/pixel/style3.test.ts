import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GROWNUPS_LIGHT, MIN_CONTRAST, PAIRS, STATUS, contrast } from './tokens';
import { readTheme, themeKey, writeTheme } from './theme';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const varOf = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();
const block = css.slice(css.indexOf('style-3: Grown-ups area'));

describe('style-3: status colors', () => {
  it('green is strong, amber needs work, grey is not started, each at 4.5:1 or better', () => {
    for (const [k, s] of Object.entries(STATUS)) expect(contrast(s.text, s.fill), k).toBeGreaterThanOrEqual(MIN_CONTRAST);
    const names = PAIRS.map((p) => p.name).join('|');
    for (const k of Object.keys(STATUS)) expect(names).toContain(`status ${k}`);
  });
  it('styles.css matches the STATUS table and maps lv0 to lv4 onto it', () => {
    expect(varOf('st-none')).toBe(STATUS.notStarted.fill);
    expect(varOf('st-none-text')).toBe(STATUS.notStarted.text);
    expect(varOf('st-work')).toBe(STATUS.needsWork.fill);
    expect(varOf('st-work-near')).toBe(STATUS.needsWorkNear.fill);
    expect(varOf('st-strong')).toBe(STATUS.strong.fill);
    expect(varOf('st-strongest')).toBe(STATUS.strongest.fill);
    expect(block).toContain('.lv0 { background: var(--st-none)');
    expect(block).toContain('.lv1 { background: var(--st-work)');
    expect(block).toContain('.lv3 { background: var(--st-strong)');
    expect(block).toContain('.lv4 { background: var(--st-strongest)');
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
  it('the walk pad stays see-through and keeps its 64 px keys', () => {
    expect(block).toMatch(/\.ow-dir \{[^}]*rgba\(44, 51, 84, 0\.58\)/);
    expect(css).toMatch(/\.ow-dir \{ width: 64px; height: 64px;/);
  });
});
