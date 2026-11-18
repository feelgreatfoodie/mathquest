import { getMode, modeFor } from '../../game/modes/registry';
import { readLastMode } from '../../game/modes/lastMode';
import type { GameModeId, GameModeProps } from '../../game/modes/types';

/** Picks the game mode for the kid and runs it. Every mode asks its questions through the same SessionRunner. */
export function Run(props: GameModeProps & { mode?: GameModeId }) {
  const { mode, ...rest } = props;
  const Mode = getMode(mode ?? modeFor(props.kid, readLastMode(props.kid.id))).Component;
  return <Mode {...rest} />;
}
