import { applyRun, type GameDelta } from '../engine/game';
import { earnedTodayOf, gemsForRun } from '../engine/gems';
import { learnerOf, type Kid, type KidGame, type SessionLog } from '../engine/models';
import { SessionRunner, buildPlan, type RunSummary } from '../engine/session';
import { newId, type Repo } from '../data/repo';
import { putQuietly, removeQuietly, replayOutbox } from '../data/outbox';
import { reportFailure } from './failures';

/** Loads the kid's cards, plans a run and returns a runner. Both run screens start here. */
export async function loadRunner(repo: Repo, kid: Kid): Promise<{ runner: SessionRunner; startedAt: number }> {
  const cards = await repo.loadCards(kid.id);
  const now = Date.now();
  const plan = buildPlan({ cards, settings: kid.settings, now, rng: Math.random });
  return { runner: new SessionRunner(plan, cards, Math.random, Date.now, kid.settings), startedAt: now };
}

/**
 * Saves the run: the run goes into the IndexedDB outbox first, then changed cards, then the session log and
 * the game totals in one transaction (applyGameDelta), then it leaves the outbox. Returns null when nothing was
 * answered. A failed write is logged and shown with a Try again button, and the run still ends: `saved` says
 * whether the totals reached the server. The run stays in the outbox, so Try again, or the next launch, replays
 * it. A replay is safe to repeat because the stored session log marks the delta as applied.
 * `onSynced` gets the stored game after a retry succeeds.
 */
export async function saveRun(
  repo: Repo,
  kid: Kid,
  runner: SessionRunner,
  startedAt: number,
  onSynced?: (game: KidGame) => void,
): Promise<{ summary: RunSummary; updated: Kid; saved: boolean } | null> {
  const raw = runner.summary();
  if (raw.answered === 0) return null;
  const now = Date.now();
  // The gems come from the parent settings and today's count. The server transaction works them out again from the
  // stored count (gemRun below), so a second device cannot skip the throttle; this number is what the screen shows.
  const learner = learnerOf(kid.settings);
  const gemSettings = { gemSpeed: kid.settings.gemSpeed, gemFullRate: kid.settings.gemFullRate };
  const stats = { correct: raw.correct, graded: raw.graded, bestCombo: raw.bestCombo, newLearned: raw.newLearned };
  const summary = { ...raw, gems: gemsForRun(stats, learner, gemSettings, earnedTodayOf(kid.game, now)) };
  const log: SessionLog = {
    id: newId(),
    startedAt,
    endedAt: now,
    answered: summary.answered,
    graded: summary.graded,
    correct: summary.correct,
    fast: summary.fast,
    newLearned: summary.newLearned,
    medianMs: summary.medianMs,
    xp: summary.xp,
    gems: summary.gems,
    bestCombo: summary.bestCombo,
    missed: summary.missed,
  };
  const delta: GameDelta = { xp: summary.xp, gems: summary.gems, gemRun: { stats, learner, settings: gemSettings }, bestCombo: summary.bestCombo, playedAt: now };

  const cards = runner.changedCards();
  try {
    await repo.saveCards(kid.id, cards);
  } catch (e) {
    reportFailure('Some of this run was not saved.', e, () => repo.saveCards(kid.id, cards));
  }

  await putQuietly({ runId: log.id, kidId: kid.id, sessionLog: log, gameDelta: delta, savedAt: now });
  const write = async (): Promise<KidGame> => {
    const game = await repo.applyGameDelta(kid.id, delta, { session: log });
    await removeQuietly(log.id); // both writes are confirmed
    return game;
  };
  const attempt = async (): Promise<KidGame> => {
    // Try again: replay every run of this kid still in the outbox, then this run (a stored log makes it a no-op).
    await replayOutbox(repo, kid.id, (_id, g) => onSynced?.(g));
    const game = await write();
    onSynced?.(game);
    return game;
  };
  try {
    const game = await write();
    return { summary, updated: { ...kid, game }, saved: true };
  } catch (e) {
    reportFailure('Your gems and XP from this run were not saved.', e, async () => {
      await attempt();
    });
    // Show the totals the run earned, even though the server does not have them yet.
    let shown = kid.game;
    try {
      shown = applyRun(kid.game, summary, now);
    } catch {
      // The delta cannot apply to this copy; keep the old totals on screen.
    }
    return { summary, updated: { ...kid, game: shown }, saved: false };
  }
}
