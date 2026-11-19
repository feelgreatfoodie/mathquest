import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INTRO_CARDS } from './introCards';

describe('"What is Math Quest?" cards', () => {
  it('has 5 cards, each with one image and one or two sentences', () => {
    expect(INTRO_CARDS).toHaveLength(5);
    for (const c of INTRO_CARDS) {
      expect(c.alt.length).toBeGreaterThan(10);
      const sentences = c.text.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, c.id).toBeGreaterThanOrEqual(1);
      expect(sentences.length, c.id).toBeLessThanOrEqual(2);
      expect(c.text).not.toMatch(/—|–/);
    }
  });
  it('has every image in public/intro as WebP under 150 KB', () => {
    for (const c of INTRO_CARDS) {
      const url = new URL(`../../../public/intro/${c.file}`, import.meta.url);
      const b = readFileSync(url);
      expect(b.subarray(0, 4).toString('latin1'), c.file).toBe('RIFF');
      expect(b.subarray(8, 12).toString('latin1'), c.file).toBe('WEBP');
      expect(statSync(url).size, c.file).toBeLessThan(150 * 1024);
    }
  });
  it('lazy-loads the images and uses only same-origin static files', () => {
    const src = readFileSync(new URL('./Intro.tsx', import.meta.url), 'utf8');
    expect(src).toContain('loading="lazy"');
    const imports = src.split('\n').filter((l) => /^import /.test(l)).join('\n');
    expect(imports).not.toMatch(/firebase|firestore|auth|repo/i);
    expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/https?:\/\//);
  });
});
