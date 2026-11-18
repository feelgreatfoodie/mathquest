import { learnerOf, type Kid } from '../../engine/models';
import { DungeonMode } from './DungeonMode';
import { PrereaderMode } from './PrereaderMode';
import type { GameModeDef, GameModeId, ModeLearner } from './types';

/** All modes, in picker order. Both of today's runs are modes; nothing about how they play changed. */
export const MODES: readonly GameModeDef[] = [
  { id: 'dungeon', name: 'Dungeon Run', learners: ['reader'], inputs: ['keypad', 'fraction'], status: 'live', Component: DungeonMode },
  { id: 'prereader', name: 'Picture Run', learners: ['prereader'], inputs: ['choices'], status: 'live', Component: PrereaderMode },
];

export function getMode(id: GameModeId): GameModeDef {
  const mode = MODES.find((m) => m.id === id);
  if (!mode) throw new Error(`Unknown game mode: ${id}`);
  return mode;
}

export function modesFor(learner: ModeLearner): GameModeDef[] {
  return MODES.filter((m) => m.learners.includes(learner));
}

/** The mode a kid plays when nothing else is chosen. Readers get the Dungeon, pre-readers the picture run. */
export function defaultModeFor(kid: Kid): GameModeId {
  return learnerOf(kid.settings) === 'prereader' ? 'prereader' : 'dungeon';
}
