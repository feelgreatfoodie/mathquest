// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dayKey } from '../engine/game';
import { displayStreak, streakWithRest, weekDays } from '../engine/habit';
import { goAction, wholeAllowed } from '../engine/fractionInput';
import { defeat, hit, levelUp, setMuted, isMuted } from './early/sounds';

const day = (s: string) => dayKey(new Date(`${s}T12:00:00`).getTime());

describe('item 7: fraction input', () => {
  it('Whole shows only for families that can give a whole or mixed answer', () => {
    for (const id of ['fr:add', 'fr:madd', 'fr:msub', 'fr:maddr', 'fr:msubr', 'fr:mulwm']) expect(wholeAllowed(id), id).toBe(true);
    for (const id of ['fr:sub', 'fr:mulw']) expect(wholeAllowed(id), id).toBe(false);
  });
  it('GO jumps to the next empty box first, then submits', () => {
    expect(goAction({ w: '', n: '', d: '' })).toEqual({ kind: 'none' });
    expect(goAction({ w: '', n: '3', d: '' })).toEqual({ kind: 'field', field: 'd' });
    expect(goAction({ w: '', n: '', d: '8' })).toEqual({ kind: 'field', field: 'n' });
    expect(goAction({ w: '2', n: '3', d: '' })).toEqual({ kind: 'field', field: 'd' });
    expect(goAction({ w: '', n: '3', d: '8' })).toEqual({ kind: 'submit' });
    expect(goAction({ w: '2', n: '3', d: '8' })).toEqual({ kind: 'submit' });
    expect(goAction({ w: '2', n: '', d: '' })).toEqual({ kind: 'submit' }); // a whole-number answer
  });
});

describe('item 13: weekly star chart and a streak with one rest day', () => {
  // 2026-11-16 is a Monday.
  const played = ['2026-11-16', '2026-11-18', '2026-11-19'].map(day);
  it('weekDays lists Monday to Sunday with the played days marked', () => {
    const w = weekDays(played, day('2026-11-19'));
    expect(w.map((d) => d.day)).toEqual(['16', '17', '18', '19', '20', '21', '22'].map((d) => day(`2026-11-${d}`)));
    expect(w.map((d) => d.played)).toEqual([true, false, true, true, false, false, false]);
    expect(w.find((d) => d.today)!.day).toBe(day('2026-11-19'));
  });
  it('one missed day in a week keeps the streak; two in the same week break it', () => {
    expect(streakWithRest(played, day('2026-11-19'))).toBe(3); // Mon, (rest Tue), Wed, Thu
    const two = ['2026-11-16', '2026-11-19'].map(day);
    expect(streakWithRest(two, day('2026-11-19'))).toBe(1); // Tue and Wed both missed
  });
  it('today not played yet does not break a streak that reached yesterday', () => {
    expect(streakWithRest(played, day('2026-11-20'))).toBe(3);
    expect(streakWithRest([], day('2026-11-20'))).toBe(0);
  });
  it('the rest day is per week: a miss in each of two weeks still counts', () => {
    const d = ['2026-11-09', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-18'].map(day);
    // Mon 9, (rest Tue 10), Wed 11 .. Mon 16, (rest Tue 17), Wed 18
    expect(streakWithRest(d, day('2026-11-18'))).toBe(8);
  });
  it('the shown streak never drops below the stored one', () => {
    expect(displayStreak(9, [], day('2026-11-19'))).toBe(9);
    expect(displayStreak(1, played, day('2026-11-19'))).toBe(3);
  });
});

describe('items 4 and 5: sounds and the mute', () => {
  let made = 0;
  beforeEach(() => {
    made = 0;
    class FakeCtx {
      currentTime = 0;
      destination = {};
      resume() { return Promise.resolve(); }
      createOscillator() { made++; return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  });
  afterEach(() => setMuted(false));
  it('hit, defeat and level up each make sound, and sound is on by default', () => {
    expect(isMuted()).toBe(false);
    for (const f of [hit, defeat, levelUp]) {
      const before = made;
      f();
      expect(made, f.name).toBeGreaterThan(before);
    }
  });
  it('muted makes no sound at all', () => {
    setMuted(true);
    for (const f of [hit, defeat, levelUp]) f();
    expect(made).toBe(0);
  });
});
