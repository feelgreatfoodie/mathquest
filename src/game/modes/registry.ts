import { learnerOf, modesOnOf, type Kid } from '../../engine/models';
import { DungeonMode } from './DungeonMode';
import { PrereaderMode } from './PrereaderMode';
import { OverworldMode } from './OverworldMode';
import { LightningMode } from './LightningMode';
import type { GameModeDef, GameModeId, ModeLearner } from './types';

/** All modes, in picker order. Both of today's runs are modes; nothing about how they play changed. */
export const MODES: readonly GameModeDef[] = [
  { id: 'dungeon', name: 'Dungeon Run', learners: ['reader'], inputs: ['keypad', 'fraction'], status: 'live', Component: DungeonMode },
  { id: 'prereader', name: 'Picture Run', learners: ['prereader'], inputs: ['choices'], status: 'live', Component: PrereaderMode },
  // The Overworld loads its map, renderer and sprites in a separate chunk, only when a kid opens Adventure.
  { id: 'overworld', name: 'Adventure', learners: ['reader', 'prereader'], inputs: ['keypad', 'fraction', 'choices'], status: 'beta', Component: OverworldMode },
  // Practice only: facts the kid is still learning, mixed with known ones, behind a reveal that shrinks. Never changes the review schedule.
  { id: 'lightning', name: 'Lightning Round', learners: ['reader', 'prereader'], inputs: ['keypad', 'choices'], status: 'live', Component: LightningMode },
];

/** The modes this kid has on, in picker order. A mode a parent has not turned on is never listed. */
export function enabledModes(kid: Kid): GameModeDef[] {
  const on = modesOnOf(kid.settings);
  return MODES.filter((m) => on[m.id]);
}

/** The mode to play: the last pick while it is still on, else the first mode that is on (the default). */
export function modeFor(kid: Kid, last: GameModeId | null | undefined): GameModeId {
  const on = enabledModes(kid);
  if (last && on.some((m) => m.id === last)) return last;
  return on[0]?.id ?? defaultModeFor(kid);
}

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
