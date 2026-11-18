import { describe, expect, it } from 'vitest';
import { enabledModes, modeFor } from '../game/modes/registry';
import { DEFAULT_GAME, DEFAULT_SETTINGS, PRESETS, modesOnOf, soundOf, type Kid, type KidSettings } from './models';

const kid = (settings: Partial<KidSettings>): Kid => ({ id: 'k1', name: 'Pip', createdAt: 1, settings: { ...DEFAULT_SETTINGS, ...settings }, game: { ...DEFAULT_GAME } });

describe('KidSettings.modes: the Overworld is off for every kid until a parent turns it on', () => {
  it('a reader doc with no modes field has the Dungeon on and the Overworld off', () => {
    expect(modesOnOf(DEFAULT_SETTINGS)).toEqual({ dungeon: true, prereader: false, overworld: false });
  });
  it('a pre-reader has only the picture run, even if overworld is stored true', () => {
    expect(modesOnOf(PRESETS.prereader)).toEqual({ dungeon: false, prereader: true, overworld: false });
    expect(modesOnOf({ ...PRESETS.prereader, modes: { overworld: true } }).overworld).toBe(false);
  });
  it('overworld true turns it on beside the Dungeon; the Dungeon cannot be turned off alone', () => {
    expect(modesOnOf({ ...DEFAULT_SETTINGS, modes: { overworld: true } })).toMatchObject({ dungeon: true, overworld: true });
    expect(modesOnOf({ ...DEFAULT_SETTINGS, modes: { dungeon: false } }).dungeon).toBe(true);
    expect(modesOnOf({ ...DEFAULT_SETTINGS, modes: { dungeon: false, overworld: true } })).toMatchObject({ dungeon: false, overworld: true });
  });
  it('junk values read as off', () => {
    expect(modesOnOf({ ...DEFAULT_SETTINGS, modes: { overworld: 'yes' as never } }).overworld).toBe(false);
  });
  it('the home picker lists one mode normally and two when Adventure is on', () => {
    expect(enabledModes(kid({})).map((m) => m.id)).toEqual(['dungeon']);
    expect(enabledModes(kid({ modes: { overworld: true } })).map((m) => m.id)).toEqual(['dungeon', 'overworld']);
    expect(enabledModes(kid({ learner: 'prereader' })).map((m) => m.id)).toEqual(['prereader']);
  });
  it('modeFor honours the last choice only while that mode is still on', () => {
    const on = kid({ modes: { overworld: true } });
    expect(modeFor(on, 'overworld')).toBe('overworld');
    expect(modeFor(on, 'dungeon')).toBe('dungeon');
    expect(modeFor(kid({}), 'overworld')).toBe('dungeon');
    expect(modeFor(on, null)).toBe('dungeon');
    expect(modeFor(kid({ learner: 'prereader' }), 'overworld')).toBe('prereader');
  });
  it('sound is on unless a parent turned it off for this kid', () => {
    expect(soundOf(DEFAULT_SETTINGS)).toBe(true);
    expect(soundOf({ ...DEFAULT_SETTINGS, sound: false })).toBe(false);
    expect(soundOf({ ...DEFAULT_SETTINGS, sound: true })).toBe(true);
  });
});
