import { applyRun, type GameDelta } from '../engine/game';
import type { Kid, KidGame, SessionLog } from '../engine/models';
import { SessionRunner, buildPlan, type RunSummary } from '../engine/session';
import { newId, type Repo } from '../data/repo';
import { reportFailure } from './failures';

/** Loads the kid's cards, plans a run and returns a runner. Both run screens start here. */
export async function loadRunner(repo: Repo, kid: Kid): Promise<{ runner: SessionRunner; startedAt: number }> {
  const cards = await repo.loadCards(kid.id);
  const now = Date.now();
  const plan = buildPlan({ cards, settings: kid.settings, now, rng: Math.random });
  return { runner: new SessionRunner(plan, cards, Math.random, Date.now, kid.settings), startedAt: now };
}

/**
 * Saves the run: changed cards, then the session log and the game totals in one transaction
 * (applyGameDelta). Returns null when nothing was answered. A failed write is logged and shown with a
 * Try again button, and the run still ends: `saved` says whether the totals reached the server. The
 * retry is safe to repeat because the stored session log marks the delta as applied.
 * `onSynced` gets the stored game after a retry succeeds.
 */
/** What the summary screen needs besides the summary and the kid. */
export interface RunInfo {
  /** The totals reached the server. When false, show no totals: `retry` tries the write again. */
  saved: boolean;
  /** The game before this run, so the screen can count up from the old totals. */
  before: KidGame;
  /** Facts first answered correctly this run. */
  newIds: string[];
  /** Present only when `saved` is false. Resolves with the stored game; rejects when the write fails again. */
  retry?: () => Promise<KidGame>;
}

export async function saveRun(
  repo: Repo,
  kid: Kid,
  runner: SessionRunner,
  startedAt: number,
  onSynced?: (game: KidGame) => void,
): Promise<{ summary: RunSummary; updated: Kid; saved: boolean; info: RunInfo } | null> {
  const summary = runner.summary();
  if (summary.answered === 0) return null;
  const now = Date.now();
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
  const delta: GameDelta = { xp: summary.xp, gems: summary.gems, bestCombo: summary.bestCombo, playedAt: now };

  const cards = runner.changedCards();
  try {
    await repo.saveCards(kid.id, cards);
  } catch (e) {
    reportFailure('Some of this run was not saved.', e, () => repo.saveCards(kid.id, cards));
  }

  const attempt = async (): Promise<KidGame> => {
    const game = await repo.applyGameDelta(kid.id, delta, { session: log });
    onSynced?.(game);
    return game;
  };
  try {
    const game = await attempt();
    return { summary, updated: { ...kid, game }, saved: true, info: { saved: true, before: kid.game, newIds: runner.newlyLearned() } };
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
    return { summary, updated: { ...kid, game: shown }, saved: false, info: { saved: false, before: kid.game, newIds: runner.newlyLearned(), retry: attempt } };
  }
}
