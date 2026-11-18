import { describe, expect, it } from 'vitest';
import type { SessionLog } from './models';
import { adventureLine, runLabel } from './runLabel';

const log = (over: Partial<SessionLog> = {}): SessionLog => ({ id: 's', startedAt: 1, endedAt: 2, answered: 23, graded: 23, correct: 20, fast: 5, newLearned: 1, medianMs: 900, xp: 200, gems: 0, bestCombo: 6, missed: [], ...over });

describe('runLabel', () => {
  it('an open Adventure trip reads "Adventure · castle · 23 answers · in progress"', () => {
    expect(runLabel(log({ mode: 'overworld', region: 'castle', finished: false }), 'reader')).toEqual({ mode: 'overworld', text: 'Adventure · castle · 23 answers · in progress' });
  });
  it('a closed trip reads finished, and a trip that was never closed reads left early', () => {
    expect(runLabel(log({ mode: 'overworld', region: 'forest', graded: 1, finished: true, endedBy: 'camp' }), 'reader').text).toBe('Adventure · forest · 1 answer · finished');
    expect(runLabel(log({ mode: 'overworld', region: 'meadow', finished: false, endedBy: 'left' }), 'reader').text).toContain('left early');
  });
  it('a log with no mode reads by player type', () => {
    expect(runLabel(log(), 'reader')).toEqual({ mode: 'dungeon', text: 'Dungeon run' });
    expect(runLabel(log(), 'prereader')).toEqual({ mode: 'prereader', text: 'Picture run' });
    expect(runLabel(log({ mode: 'dungeon' }), 'prereader').mode).toBe('dungeon');
  });
});

describe('adventureLine', () => {
  it('is empty before the first Adventure save', () => {
    expect(adventureLine(null)).toBeNull();
  });
  it('counts chests and bosses and names the furthest region reached', () => {
    expect(adventureLine({ region: 'meadow', openedChests: ['a', 'b'], bossesDefeated: [] })).toBe('Adventure: reached the meadow, 2 chests opened, 0 of 3 bosses beaten.');
    expect(adventureLine({ region: 'meadow', openedChests: ['a'], bossesDefeated: ['meadow'] })).toBe('Adventure: reached the forest, 1 chest opened, 1 of 3 bosses beaten.');
    expect(adventureLine({ region: 'castle', openedChests: [], bossesDefeated: ['meadow', 'forest'] })).toContain('reached the castle');
  });
});
