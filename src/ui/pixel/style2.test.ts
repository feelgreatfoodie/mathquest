import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { DUNGEON, INSET, MIN_CONTRAST, PAIRS, contrast } from './tokens';
import { TorchRow, HpBar } from './dungeon';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const src = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const varOf = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();

describe('style-2 tokens', () => {
  it('styles.css matches the DUNGEON and INSET tables', () => {
    expect(varOf('px-wall')).toBe(DUNGEON.wall);
    expect(varOf('px-wall-dark')).toBe(DUNGEON.wallDark);
    expect(varOf('px-floor')).toBe(DUNGEON.floor);
    expect(varOf('px-floor-dark')).toBe(DUNGEON.floorDark);
    expect(varOf('px-inset')).toBe(INSET.fill);
    expect(varOf('px-inset-text')).toBe(INSET.text);
    expect(varOf('px-inset-muted')).toBe(INSET.muted);
    expect(varOf('px-inset-gold')).toBe(INSET.gold);
    expect(varOf('px-inset-good')).toBe(INSET.good);
    expect(varOf('px-inset-info')).toBe(INSET.info);
    expect(varOf('px-inset-bad')).toBe(INSET.bad);
  });
  it('lists contrast pairs for the tablet, the inset and the dungeon, all at least 4.5:1', () => {
    const named = PAIRS.filter((p) => /tablet|inset|dungeon/.test(p.name));
    expect(named.length).toBeGreaterThanOrEqual(9);
    for (const p of named) expect(contrast(p.fg, p.bg), p.name).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
  it('the brick wall and floor tiles are self-hosted files that use the table colors', () => {
    const wall = readFileSync(new URL('../../../public/pixel/wall.svg', import.meta.url), 'utf8');
    const floor = readFileSync(new URL('../../../public/pixel/floor.svg', import.meta.url), 'utf8');
    expect(wall).toContain(DUNGEON.wall);
    expect(wall).toContain(DUNGEON.wallDark);
    expect(floor).toContain(DUNGEON.floor);
    expect(floor).toContain(DUNGEON.floorDark);
    expect(css).toContain("url('/pixel/wall.svg')");
  });
});

describe('style-2 parts', () => {
  it('TorchRow lights the finished torches and names the progress', () => {
    const html = renderToStaticMarkup(createElement(TorchRow, { done: 3, label: '30% through the dungeon' }));
    expect((html.match(/px-torch is-lit/g) ?? []).length).toBe(3);
    expect((html.match(/class="px-torch[ "]/g) ?? []).length).toBe(10);
    expect(html).toContain('aria-label="30% through the dungeon"');
    expect(html).toContain('data-lit="3"');
  });
  it('TorchRow clamps out-of-range progress', () => {
    expect(renderToStaticMarkup(createElement(TorchRow, { done: 99, label: 'x' }))).toContain('data-lit="10"');
    expect(renderToStaticMarkup(createElement(TorchRow, { done: -2, label: 'x' }))).toContain('data-lit="0"');
  });
  it('HpBar draws the exact fraction', () => {
    expect(renderToStaticMarkup(createElement(HpBar, { fraction: 0.4 }))).toContain('width:40%');
    expect(renderToStaticMarkup(createElement(HpBar, { fraction: 2 }))).toContain('width:100%');
  });
});

describe('style-2 css rules', () => {
  const block = css.slice(css.indexOf('style-2: Dungeon question'));
  it('keys are 72 px, and 96 px on a tall screen', () => {
    expect(block).toMatch(/\.key \{[^}]*min-height: 72px/);
    expect(block).toMatch(/min-height: 1000px\) \{ \.key \{ min-height: 96px; \} \}/);
  });
  it('Picture Run choices stay at 120 px or more, with square dots at 20 px or more', () => {
    expect(block).toMatch(/\.choice \{ width: 168px; height: 176px; \}/);
    expect(block).toMatch(/\.choice-dot \{ width: 22px; height: 22px; border-radius: 0/);
  });
  it('every style-2 animation is switched off under reduced motion', () => {
    const reduced = block.slice(block.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    for (const sel of ['.px-flicker', '.px-treasure-screen .stat', '.combo-badge']) expect(reduced).toContain(sel);
  });
  it('the style-2 block has no radius above 0 on frames and no gradients between colors', () => {
    expect(block).not.toMatch(/border-radius: [1-9]/);
  });
});

describe('no emoji on kid screens', () => {
  const emoji = /\p{Extended_Pictographic}/u;
  const files = ['ui/screens/KidScreens.tsx', 'game/modes/DungeonMode.tsx', 'game/modes/PrereaderMode.tsx', 'game/QuestionPanel.tsx', 'ui/Keypad.tsx', 'ui/CampScene.tsx', 'ui/early/PrereaderScreens.tsx', 'ui/early/PrereaderSummary.tsx', 'ui/early/ChoiceButtons.tsx'];
  for (const f of files) it(f, () => expect(src(f)).not.toMatch(emoji));
  it('lists every file in the early folder it did not name', () => {
    expect(readdirSync(new URL('../early', import.meta.url)).length).toBeGreaterThan(5);
  });
});
