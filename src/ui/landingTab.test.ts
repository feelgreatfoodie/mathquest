import { describe, expect, it } from 'vitest';
import { TAB_KEY, readTab, tabForKey, writeTab } from './landingTab';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const throwing = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
};

describe('landing tab memory', () => {
  it('defaults to kid', () => expect(readTab(mem())).toBe('kid'));
  it('remembers parent', () => {
    const s = mem();
    writeTab('parent', s);
    expect(s.getItem(TAB_KEY)).toBe('parent');
    expect(readTab(s)).toBe('parent');
  });
  it('ignores a junk stored value', () => {
    const s = mem();
    s.setItem(TAB_KEY, 'admin');
    expect(readTab(s)).toBe('kid');
  });
  it('survives blocked storage on read and write', () => {
    expect(readTab(throwing)).toBe('kid');
    expect(() => writeTab('parent', throwing)).not.toThrow();
    expect(readTab(null)).toBe('kid');
  });
});

describe('tab arrow keys', () => {
  it('moves and wraps', () => {
    expect(tabForKey('kid', 'ArrowRight')).toBe('parent');
    expect(tabForKey('parent', 'ArrowRight')).toBe('kid');
    expect(tabForKey('kid', 'ArrowLeft')).toBe('parent');
    expect(tabForKey('parent', 'Home')).toBe('kid');
    expect(tabForKey('kid', 'End')).toBe('parent');
  });
  it('ignores other keys', () => expect(tabForKey('kid', 'a')).toBeNull());
});
