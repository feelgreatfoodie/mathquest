import { GameDeltaError, type GameDelta } from '../../engine/game';
import { learnerOf, type Kid, type KidGame } from '../../engine/models';
import { putQuietly, removeQuietly } from '../../data/outbox';
import { newId, type Repo } from '../../data/repo';

/** The shop math tip: 1 gem as its own delta. It goes through the same throttle as chest gems (gemGrant) and the cap lives in applyDelta. */
export function tipDelta(kid: Pick<Kid, 'settings'>, now: number): GameDelta {
  return {
    shopTip: true,
    gemGrant: { base: 1, learner: learnerOf(kid.settings), settings: { gemSpeed: kid.settings.gemSpeed, gemFullRate: kid.settings.gemFullRate } },
    playedAt: now,
  };
}

export type TipResult = { status: 'paid'; game: KidGame } | { status: 'capped' } | { status: 'failed'; error: unknown };

/**
 * Pays one tip. The delta waits in the outbox under a fresh runId until the server confirms it, so a closed tab or a
 * dropped connection replays it. The 4th tip of a day throws GameDeltaError: it is dropped from the outbox and not retried.
 * Never writes a card, a session or the schedule.
 */
export async function payShopTip(repo: Repo, kid: Kid, now = Date.now()): Promise<TipResult> {
  const delta = tipDelta(kid, now);
  const runId = newId();
  await putQuietly({ runId, kidId: kid.id, gameDelta: delta, savedAt: now });
  try {
    const game = await repo.applyGameDelta(kid.id, delta);
    await removeQuietly(runId);
    return { status: 'paid', game };
  } catch (error) {
    if (error instanceof GameDeltaError) {
      await removeQuietly(runId);
      return { status: 'capped' };
    }
    return { status: 'failed', error }; // stays in the outbox: the next launch replays it
  }
}
