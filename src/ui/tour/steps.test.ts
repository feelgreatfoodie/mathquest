import { describe, expect, it } from 'vitest';
import { TOUR_STEPS, resolveSteps } from './steps';

/** A page with only the named selectors present. */
const page = (present: string[]) =>
  ({
    querySelector: (sel: string) => (present.includes(sel) ? ({ closest: () => null } as unknown as HTMLElement) : null),
  }) as unknown as ParentNode;

describe('Grown-ups tour steps', () => {
  it('has 8 to 10 steps with unique ids, and one is the Pause step', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(8);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(10);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    const pause = TOUR_STEPS.find((s) => s.id === 'pause');
    expect(pause?.text).toMatch(/Pause everyone/);
  });
  it('covers the sections the tour was asked to spotlight', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    for (const id of ['kids', 'stats', 'progress', 'needs-work', 'runs', 'settings', 'extras', 'voice', 'version']) expect(ids).toContain(id);
  });
  it('uses plain words: no dashes, no Parent', () => {
    for (const s of TOUR_STEPS) {
      expect(`${s.title} ${s.text}`).not.toMatch(/—|–/);
      expect(`${s.title} ${s.text}`).not.toMatch(/parent/i);
    }
  });
  it('renders every step when every section is present', () => {
    const all = TOUR_STEPS.flatMap((s) => s.selectors);
    expect(resolveSteps(page(all)).map((r) => r.step.id)).toEqual(TOUR_STEPS.map((s) => s.id));
  });
  it('skips a step whose section is missing or off for the player', () => {
    const all = TOUR_STEPS.flatMap((s) => s.selectors).filter((sel) => !sel.includes('setting-vault') && !sel.includes('setting-adventure') && !sel.includes('ins-needs-work') && !sel.includes('ins-balance'));
    const ids = resolveSteps(page(all)).map((r) => r.step.id);
    expect(ids).not.toContain('extras');
    expect(ids).not.toContain('needs-work');
    expect(ids).toContain('settings');
    expect(ids.length).toBe(TOUR_STEPS.length - 2);
  });
  it('uses the first selector that is present', () => {
    const only = ['[data-testid="ins-balance"]'];
    expect(resolveSteps(page(only)).map((r) => r.step.id)).toEqual(['needs-work']);
  });
});
