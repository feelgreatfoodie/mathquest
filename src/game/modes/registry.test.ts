import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME, DEFAULT_SETTINGS, type Kid } from '../../engine/models';
import { MODES, defaultModeFor, enabledModes, getMode, modesFor } from './registry';

const kid = (settings: object): Kid => ({
  id: 'k1',
  name: 'Pip',
  createdAt: 1,
  settings: { ...DEFAULT_SETTINGS, ...settings },
  game: { ...DEFAULT_GAME },
});

describe('game mode registry', () => {
  it('enabledModes for a pre-reader with no modes lists Picture Run and Adventure', () => {
    expect(enabledModes(kid({ learner: 'prereader' })).map((m) => m.name)).toEqual(['Picture Run', 'Adventure', 'Lightning Round']);
  });

  it('registers the two runs that exist, the Adventure (beta) and Lightning Round', () => {
    expect(MODES.map((m) => m.id)).toEqual(['dungeon', 'prereader', 'overworld', 'lightning']);
    expect(MODES.filter((m) => m.status === 'live').map((m) => m.id)).toEqual(['dungeon', 'prereader', 'lightning']);
  });

  it('a reader defaults to the Dungeon and a pre-reader to the picture run', () => {
    expect(defaultModeFor(kid({}))).toBe('dungeon');
    expect(defaultModeFor(kid({ learner: 'reader' }))).toBe('dungeon');
    expect(defaultModeFor(kid({ learner: 'prereader' }))).toBe('prereader');
  });

  it('each mode is offered only to the learner it was built for, with a component', () => {
    expect(modesFor('reader').map((m) => m.id)).toEqual(['dungeon', 'overworld', 'lightning']);
    expect(modesFor('prereader').map((m) => m.id)).toEqual(['prereader', 'overworld', 'lightning']);
    expect(getMode('lightning')).toMatchObject({ name: 'Lightning Round', learners: ['reader', 'prereader'], inputs: ['keypad', 'choices'] });
    expect(getMode('overworld').inputs).toEqual(['keypad', 'fraction', 'choices']);
    expect(MODES.every((m) => typeof m.Component === 'function')).toBe(true);
    expect(getMode('dungeon').inputs).toEqual(['keypad', 'fraction']);
    expect(getMode('prereader').inputs).toEqual(['choices']);
  });

  it('an unknown id throws', () => {
    expect(() => getMode('nope' as never)).toThrow(/Unknown game mode/);
  });
});
