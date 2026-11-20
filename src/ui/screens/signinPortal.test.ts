import { describe, expect, it } from 'vitest';
import { cleanUsername, verdictText } from './SignInPortal';

describe('the wizard username helpers', () => {
  it('lowercases and trims what the grown-up typed, the way the server does', () => {
    expect(cleanUsername('  Maya_77 ')).toBe('maya_77');
  });

  it('says each verdict in plain words', () => {
    expect(verdictText({ free: true })).toBe('That username is free.');
    expect(verdictText({ free: false, reason: 'taken' })).toBe('That username is taken. Pick another one.');
    expect(verdictText({ free: false, reason: 'reserved' })).toBe("That username isn't allowed. Pick another one.");
    expect(verdictText({ free: false, reason: 'invalid' })).toBe('A username is 3 to 20 letters, digits or _.');
  });
});
