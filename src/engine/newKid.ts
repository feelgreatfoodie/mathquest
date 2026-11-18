import { newId } from '../data/repo';
import { DEFAULT_GAME, PRESETS, type Kid, type KidSettings, type Learner } from './models';

/** Settings for a new player: the preset for their type, copied so nothing is shared between kids. */
export function settingsFor(type: Learner): KidSettings {
  const p = PRESETS[type];
  return { ...p, tracks: { ...p.tracks }, ...(p.modules ? { modules: { ...p.modules } } : {}) };
}

export function makeKid(name: string, type: Learner = 'reader'): Kid {
  return { id: newId(), name: name.trim(), createdAt: Date.now(), settings: settingsFor(type), game: { ...DEFAULT_GAME } };
}
