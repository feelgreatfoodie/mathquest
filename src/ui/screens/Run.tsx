import { defaultModeFor, getMode } from '../../game/modes/registry';
import type { GameModeProps } from '../../game/modes/types';

/** Picks the game mode for the kid and runs it. Every mode asks its questions through the same SessionRunner. */
export function Run(props: GameModeProps) {
  const Mode = getMode(defaultModeFor(props.kid)).Component;
  return <Mode {...props} />;
}
