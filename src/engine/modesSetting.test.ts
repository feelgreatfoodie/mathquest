import { describe, expect, it } from 'vitest';
import { enabledModes, modeFor } from '../game/modes/registry';
import { DEFAULT_GAME, DEFAULT_SETTINGS, PRESETS, modesOnOf, soundOf, type Kid, type KidSettings } from './models';

const kid = (settings: Partial<KidSettings>): Kid => ({ id: 'k1', name: 'Pip', createdAt: 1, settings: { ...DEFAULT_SETTINGS, ...settings }, game: { ...DEFAULT_GAME } });

describe('KidSettings.modes: Adventure is on for every kid unless a parent turns it off', () => {
  it('a reader doc with no modes field has the Dungeon and Adventure on', () => {
    expect(modesOnOf(DEFAULT_SETTINGS)).toEqual({ dungeon: true, prereader: false, overworld: true });
  });
  it('a pre-reader doc with no modes field has the picture run and Adventure on, and no Dungeon', () => {
    expect(modesOnOf(PRESETS.prereader)).toEqual({ dungeon: false, prereader: true, overworld: true });
  });
  it('an explicit false keeps Adventure off for a reader and for a pre-reader', () => {
    expect(modesOnOf({ ...DEFAULT_SETTINGS, modes: { overworld: false } })).toEqual({ dungeon: true, prereader: false, overworld: false });
    expect(modesOnOf({ ...PRESETS.prereader, modes: { overworld: false } })).toEqual({ dungeon: false, prereader: true, overworld: false });
  });
  it('the Dungeon is on unless modes.dungeon is false and Adventure is on; a reader always has at least one mode', () => {
    expect(modesOnOf({ ...DEFAULT_SETTINGS, modes: { overworld: true } })).toMatchObject({ dungeon: true, overworld: true });
    expect(modesOnOf({ ...DEFAULT_SETTINGS, modes: { dungeon: false } })).toMatchObject({ dungeon: false, overworld: true });
    expect(modesOnOf({ ...DEFAULT_SETTINGS, modes: { dungeon: false, overworld: false } }).dungeon).toBe(true);
    expect(modesOnOf({ ...DEFAULT_SETTINGS, modes: { dungeon: false, overworld: true } })).toMatchObject({ dungeon: false, overworld: true });
  });
  it('only an exact false turns Adventure off: junk values read as on', () => {
    expect(modesOnOf({ ...DEFAULT_SETTINGS, modes: { overworld: 'no' as never } }).overworld).toBe(true);
    expect(modesOnOf({ ...PRESETS.prereader, modes: { overworld: 0 as never } }).overworld).toBe(true);
  });
  it('the home picker lists the Dungeon and Adventure for a reader, the picture run and Adventure for a pre-reader', () => {
    expect(enabledModes(kid({})).map((m) => m.id)).toEqual(['dungeon', 'overworld']);
    expect(enabledModes(kid({ modes: { overworld: false } })).map((m) => m.id)).toEqual(['dungeon']);
    expect(enabledModes(kid({ learner: 'prereader' })).map((m) => m.id)).toEqual(['prereader', 'overworld']);
    expect(enabledModes(kid({ learner: 'prereader', modes: { overworld: false } })).map((m) => m.id)).toEqual(['prereader']);
  });
  it('modeFor honours the last choice only while that mode is still on', () => {
    const on = kid({});
    expect(modeFor(on, 'overworld')).toBe('overworld');
    expect(modeFor(on, 'dungeon')).toBe('dungeon');
    expect(modeFor(kid({ modes: { overworld: false } }), 'overworld')).toBe('dungeon');
    expect(modeFor(on, null)).toBe('dungeon');
    expect(modeFor(kid({ learner: 'prereader' }), 'overworld')).toBe('overworld');
    expect(modeFor(kid({ learner: 'prereader' }), 'dungeon')).toBe('prereader');
    expect(modeFor(kid({ learner: 'prereader', modes: { overworld: false } }), 'overworld')).toBe('prereader');
  });
  it('sound is on unless a parent turned it off for this kid', () => {
    expect(soundOf(DEFAULT_SETTINGS)).toBe(true);
    expect(soundOf({ ...DEFAULT_SETTINGS, sound: false })).toBe(false);
    expect(soundOf({ ...DEFAULT_SETTINGS, sound: true })).toBe(true);
  });
});
