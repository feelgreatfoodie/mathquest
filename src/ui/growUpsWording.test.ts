import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WHATS_NEW } from '../whatsnew';
import { TOUR_STEPS } from './tour/steps';
import { INTRO_CARDS } from './screens/introCards';

// User-facing text says "Grown-ups", never "Parent". Code identifiers (Parent.tsx, ParentArea, a 'parent' tab id, CSS classes) stay.
// Scans every string literal and every one-line JSX text in src (not tests) for the word parent or parents. Allowed: the sign-in
// sub-line "For parents and teachers", which names who a grown-up can be.
const ALLOWED = new Set(['For parents and teachers']);
const SRC = new URL('../', import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

/** Strings that read as words for a person: they hold a space or start with a capital. Class names, ids and paths do not. */
function userFacing(s: string): boolean {
  return /\s/.test(s) || /^[A-Z]/.test(s);
}

export function offenders(source: string): string[] {
  const out: string[] = [];
  for (const raw of source.split('\n')) {
    const t = raw.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || /^import\s/.test(t)) continue;
    const code = raw.replace(/\s\/\/.*$/, '');
    if (/className=/.test(code) && !/>[^<>{}]*parents?[^<>{}]*</i.test(code)) {
      // A class name may hold the word (landing-parent); other strings on the line are checked below.
    }
    for (const m of code.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`|>([^<>{}]*)</g)) {
      const s = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
      if (!/\bparents?\b/i.test(s) || ALLOWED.has(s)) continue;
      if (/^[a-z0-9_ ./-]+$/.test(s) && !/\s[a-z]+\s/.test(s) && !/[.!?]/.test(s)) continue; // class names, ids, paths
      if (userFacing(s)) out.push(s);
    }
  }
  return out;
}

describe('no "Parent" in user-facing text', () => {
  it('the scanner finds a leak and skips code names', () => {
    expect(offenders('<h1>Parent area</h1>')).toEqual(['Parent area']);
    expect(offenders("title=\"Parent PIN\"")).toEqual(['Parent PIN']);
    expect(offenders("setScreen({ name: 'parent' }); <div className=\"screen parent\">")).toEqual([]);
    expect(offenders("const x = 'For parents and teachers';")).toEqual([]);
    expect(offenders("'A parent can turn it on.'")).toEqual(['A parent can turn it on.']);
  });
  it('no source file leaks the word', () => {
    const bad: string[] = [];
    for (const f of files(SRC)) for (const s of offenders(readFileSync(f, 'utf8'))) bad.push(`${f.slice(SRC.length)}: ${s}`);
    expect(bad).toEqual([]);
  });
  it('What’s new, the tour and the intro cards say Grown-ups', () => {
    const all = [...WHATS_NEW.map((e) => e.text), ...TOUR_STEPS.flatMap((s) => [s.title, s.text]), ...INTRO_CARDS.map((c) => `${c.text} ${c.alt}`)];
    for (const t of all) expect(t).not.toMatch(/\bparents?\b/i);
  });
});
