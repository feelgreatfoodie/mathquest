import type { Repo } from '../data/repo';
import type { Kid, KidGame } from '../engine/models';
import type { RunSummary, SessionRunner } from '../engine/session';
import { reportFailure } from './failures';
import { saveRun, type RunInfo, type SaveExtra } from './runShared';

export interface FinishArgs {
  repo: Repo;
  kid: Kid;
  runner: SessionRunner;
  startedAt: number;
  onSynced?: (game: KidGame) => void;
  onDone: (summary: RunSummary, kid: Kid, info: RunInfo) => void;
  onExit: () => void;
  /** The mode tag, and for Adventure the trip. Absent: the mode follows the player type. */
  extra?: SaveExtra;
}

/**
 * Ends a run for both run screens. The kid leaves whatever happens: when the save throws, or the summary screen
 * throws while opening, the run exits and a toast says the round was not saved. Nothing here may stay latched.
 */
export async function finishRun({ repo, kid, runner, startedAt, onSynced, onDone, onExit, extra }: FinishArgs): Promise<void> {
  let left = false;
  try {
    const done = await saveRun(repo, kid, runner, startedAt, onSynced, extra);
    if (done) {
      onDone(done.summary, done.updated, done.info);
      left = true;
    }
  } catch (e) {
    reportFailure('This round was not saved.', e);
  } finally {
    if (!left) onExit();
  }
}
