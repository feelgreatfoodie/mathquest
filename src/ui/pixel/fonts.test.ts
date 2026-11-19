import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const file = (p: string) => new URL(p, root);

describe('self-hosted fonts', () => {
  const woff2 = ['press-start-2p-latin-400-normal', 'atkinson-hyperlegible-latin-400-normal', 'atkinson-hyperlegible-latin-700-normal'];
  it('ships 3 Latin WOFF2 files and both OFL license files', () => {
    for (const f of woff2) {
      const b = readFileSync(file(`public/fonts/${f}.woff2`));
      expect(b.subarray(0, 4).toString('latin1'), f).toBe('wOF2');
      expect(b.length, f).toBeLessThan(30_000);
    }
    for (const f of ['OFL-PressStart2P.txt', 'OFL-AtkinsonHyperlegible.txt']) {
      expect(readFileSync(file(`public/fonts/${f}`), 'utf8')).toContain('SIL Open Font License');
    }
    expect(statSync(file('public/fonts')).isDirectory()).toBe(true);
  });
  it('declares them with font-display: swap', () => {
    const css = readFileSync(file('src/styles.css'), 'utf8');
    const faces = css.match(/@font-face \{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(3);
    for (const f of faces) expect(f).toContain('font-display: swap');
    for (const f of woff2) expect(css).toContain(`/fonts/${f}.woff2`);
  });
  it('makes no third-party font request', () => {
    const html = readFileSync(file('index.html'), 'utf8');
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    const css = readFileSync(file('src/styles.css'), 'utf8');
    expect(css).not.toMatch(/https?:\/\//);
    const vite = readFileSync(file('vite.config.ts'), 'utf8');
    expect(vite).not.toMatch(/fonts\.(googleapis|gstatic)/);
    expect(existsSync(file('public/fonts/press-start-2p-latin-400-normal.woff2'))).toBe(true);
  });
});
