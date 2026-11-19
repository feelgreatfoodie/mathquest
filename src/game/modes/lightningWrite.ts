import type { GameDelta } from '../../engine/game';
import { earnedTodayOf, gemSpeedOf, throttledGems } from '../../engine/gems';
import { LIGHTNING, LightningRound, lightningGrantBase, lightningLog, type RoundResult } from '../../engine/lightning';
import { learnerOf, type Kid, type KidGame } from '../../engine/models';
import { noteDenied, putQuietly, removeQuietly, replayOutbox } from '../../data/outbox';
import type { Repo } from '../../data/repo';
import { reportFailure } from '../../ui/failures';
import { BUILD, isSaveDenied } from '../../version';

/** The gems a round shows on its end screen: the same throttle the write runs, never above 3. The write recomputes from the stored count. */
export function shownGems(kid: Kid, r: RoundResult, now: number): number {
  const learner = learnerOf(kid.settings);
  const settings = { gemSpeed: kid.settings.gemSpeed, gemFullRate: kid.settings.gemFullRate };
  const base = lightningGrantBase(r.hits, gemSpeedOf(settings));
  if (base === 0) return 0;
  return Math.min(LIGHTNING.maxGems, throttledGems(base, learner, settings, earnedTodayOf(kid.game, now)));
}

export interface LightningSave {
  /** The stored game after the write, when it went through. */
  game: KidGame | null;
  gems: number;
}

/**
 * Saves a Lightning Round the way an Adventure trip saves: one session doc (sessions/{roundId}) that grows. The cumulative totals go
 * into the IndexedDB outbox first (save-first), then the changed cards, then one transaction (applyGameDelta with `checkpoint`) that
 * credits only the XP above what the stored doc already holds. Call it every 10 answers and on pagehide, visibilitychange hidden and
 * unmount (`close: false`), and once at the end (`close: true`). The close carries the round's single gemGrant, at most 3 gems at the
 * usual daily rate. Every answer is a Lightning answer only: nothing here feeds a Dungeon run's stats or fill practice.
 * The promise never rejects: a failed write is shown as a toast with Try again and stays in the outbox.
 */
export function saveLightning(repo: Repo, kid: Kid, round: LightningRound, opts: { close: boolean; left?: boolean }, now = Date.now()): Promise<LightningSave> {
  const r = round.result();
  round.seq += 1;
  const learner = learnerOf(kid.settings);
  const settings = { gemSpeed: kid.settings.gemSpeed, gemFullRate: kid.settings.gemFullRate };
  const base = opts.close ? lightningGrantBase(r.hits, gemSpeedOf(settings)) : 0;
  const estimate = opts.close ? shownGems(kid, r, now) : 0;
  const log = lightningLog(round, r, now, BUILD, { finished: opts.close, ...(opts.left ? { left: true } : {}), gems: estimate });
  const delta: GameDelta = { xp: r.xp, playedAt: now, ...(base > 0 ? { gemGrant: { base, learner, settings } } : {}) };
  const runId = `${round.id}:${round.seq}`;
  const cards = round.changedCards();
  return (async (): Promise<LightningSave> => {
    await putQuietly({ runId, kidId: kid.id, sessionLog: log, gameDelta: delta, checkpoint: true, savedAt: now });
    if (cards.length) {
      try {
        await repo.saveCards(kid.id, cards);
      } catch (e) {
        reportFailure('Some of this round was not saved.', e, () => repo.saveCards(kid.id, cards));
      }
    }
    try {
      const game = await repo.applyGameDelta(kid.id, delta, { session: log, checkpoint: true });
      await removeQuietly(runId);
      return { game, gems: estimate };
    } catch (e) {
      if (isSaveDenied(e)) await noteDenied(runId);
      reportFailure('Your Lightning Round was not saved.', e, async () => {
        await replayOutbox(repo, kid.id);
      });
      return { game: null, gems: estimate };
    }
  })();
}
