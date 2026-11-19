import type { ComponentType } from 'react';
import type { Repo } from '../../data/repo';
import type { Kid, KidGame } from '../../engine/models';
import type { InputKind } from '../../engine/modules/types';
import type { RunSummary } from '../../engine/session';
import type { RunInfo } from '../../ui/runShared';

/** Every mode that is registered. Later modes (overworld, ghost, tower, coop) add an id here. */
export type GameModeId = 'dungeon' | 'prereader' | 'overworld' | 'lightning';

export type ModeLearner = 'reader' | 'prereader';

export interface GameModeProps {
  repo: Repo;
  kid: Kid;
  /** The run was saved through `saveRun`; show the summary. */
  onDone(summary: RunSummary, kid: Kid, info: RunInfo): void;
  /** The stored game after a Try again succeeds. */
  onSynced?(game: KidGame): void;
  /** Leave without a summary (nothing answered, or a load error). */
  onExit(): void;
}

export interface GameModeDef {
  id: GameModeId;
  name: string;
  /** Who can play it. */
  learners: ModeLearner[];
  /** Input kinds its questions can use. A module whose input is not listed cannot appear in the mode. */
  inputs: InputKind[];
  status: 'live' | 'beta';
  Component: ComponentType<GameModeProps>;
}
