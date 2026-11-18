import { describe, expect, it } from 'vitest';
import { WHATS_NEW, buildLabel, entryText, recentChanges } from './whatsnew';

describe('whatsnew', () => {
  it('keeps the last 10 merged changes, newest first, one entry per PR', () => {
    const list = recentChanges();
    expect(list).toHaveLength(10);
    const prs = list.map((e) => e.pr);
    expect(new Set(prs).size).toBe(10);
    expect([...prs].sort((a, b) => b - a)).toEqual(prs);
    expect(WHATS_NEW.map((e) => e.pr)).toContain(10); // backfilled, kept beyond the shown 10
  });
  it('covers every merged change from #25 to #34 (#33 was a layout fix with no line) (the footer shows the newest 10)', () => {
    const prs = recentChanges().map((e) => e.pr);
    for (const n of [25, 26, 27, 28, 29, 30, 31, 32, 34]) expect(prs).toContain(n);
  });
  it('marks changes kids cannot see and changes behind a setting', () => {
    const list = recentChanges();
    expect(list.some((e) => entryText(e).endsWith('(behind the scenes)'))).toBe(true);
    expect(list.some((e) => entryText(e).endsWith('(turn on in Settings)'))).toBe(true);
  });
  it('uses plain words: no dashes', () => {
    for (const e of recentChanges()) expect(e.text).not.toMatch(/—|–/);
  });
  it('builds the footer label from a sha and a build time', () => {
    const t = Date.UTC(2026, 10, 18, 4, 30) / 1000;
    expect(buildLabel('abc1234', t)).toMatch(/^Version abc1234 · built .+/);
  });
});
