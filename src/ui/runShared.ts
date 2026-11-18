import { applyRun, type GameDelta } from '../engine/game';
import { earnedTodayOf, gemsForRun } from '../engine/gems';
import { learnerOf, type CardMap, type Kid, type KidGame, type SessionLog, type SessionMode } from '../engine/models';
import { addRun, tripLog, type TripTotals } from '../game/overworld/trip';
import { SessionRunner, buildPlan, type RunSummary } from '../engine/session';
import { newId, type Repo } from '../data/repo';
import { noteDenied, putQuietly, removeQuietly, replayOutbox } from '../data/outbox';
import { isSaveDenied } from '../version';
import { reportFailure } from './failures';

/** Loads the kid's cards, plans a run and returns a runner. Both run screens start here. */
export async function loadRunner(repo: Repo, kid: Kid): Promise<{ runner: SessionRunner; startedAt: number; cards: CardMap }> {
  const cards = await repo.loadCards(kid.id);
  const now = Date.now();
  const plan = buildPlan({ cards, settings: kid.settings, now, rng: Math.random });
  return { runner: new SessionRunner(plan, cards, Math.random, Date.now, kid.settings), startedAt: now, cards };
}

/**
 * Saves the run: the run goes into the IndexedDB outbox first, then changed cards, then the session log and
 * the game totals in one transaction (applyGameDelta), then it leaves the outbox. Returns null when nothing was
 * answered. A failed write is logged and shown with a Try again button, and the run still ends: `saved` says
 * whether the totals reached the server. The run stays in the outbox, so Try again, or the next launch, replays
 * it. A replay is safe to repeat because the stored session log marks the delta as applied.
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

/** What a run screen adds to saveRun: the mode tag for the log, and for an Adventure trip its identity and the totals before this open. */
export interface SaveExtra {
  mode: SessionMode;
  trip?: { id: string; startedAt: number; seq: number; base: TripTotals; region: string };
}

export async function saveRun(
  repo: Repo,
  kid: Kid,
  runner: SessionRunner,
  startedAt: number,
  onSynced?: (game: KidGame) => void,
  extra?: SaveExtra,
): Promise<{ summary: RunSummary; updated: Kid; saved: boolean; info: RunInfo } | null> {
  const run = runner.summary();
  const trip = extra?.trip;
  // An Adventure trip closes with its cumulative totals: what earlier opens of the trip already checkpointed plus this open's runner.
  const t = trip ? addRun(trip.base, run) : null;
  const raw: RunSummary = t ? { ...run, answered: t.answered, graded: t.graded, correct: t.correct, fast: t.fast, newLearned: t.newLearned, xp: t.xp, bestCombo: t.bestCombo, medianMs: t.medianMs, missed: t.missed } : run;
  if (raw.answered === 0) return null;
  const now = Date.now();
  // The gems come from the parent settings and today's count. The server transaction works them out again from the
  // stored count (gemRun below), so a second device cannot skip the throttle; this number is what the screen shows.
  const learner = learnerOf(kid.settings);
  const gemSettings = { gemSpeed: kid.settings.gemSpeed, gemFullRate: kid.settings.gemFullRate };
  const stats = { correct: raw.correct, graded: raw.graded, bestCombo: raw.bestCombo, newLearned: raw.newLearned };
  const summary = { ...raw, gems: gemsForRun(stats, learner, gemSettings, earnedTodayOf(kid.game, now)) };
  const mode: SessionMode = extra?.mode ?? (learner === 'prereader' ? 'prereader' : 'dungeon');
  const log: SessionLog = trip && t ? { ...tripLog({ tripId: trip.id, startedAt: trip.startedAt }, t, now, trip.region, 'camp'), gems: summary.gems } : {
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
    mode,
  };
  const runId = trip ? `${trip.id}:${trip.seq}` : log.id;
  const delta: GameDelta = { xp: summary.xp, gems: summary.gems, gemRun: { stats, learner, settings: gemSettings }, bestCombo: summary.bestCombo, playedAt: now };

  const cards = runner.changedCards();
  try {
    await repo.saveCards(kid.id, cards);
  } catch (e) {
    reportFailure('Some of this run was not saved.', e, () => repo.saveCards(kid.id, cards));
  }

  await putQuietly({ runId, kidId: kid.id, sessionLog: log, gameDelta: delta, savedAt: now, ...(trip ? { checkpoint: true } : {}) });
  const write = async (): Promise<KidGame> => {
    let game: KidGame;
    try {
      game = await repo.applyGameDelta(kid.id, delta, { session: log, ...(trip ? { checkpoint: true } : {}) });
    } catch (e) {
      if (isSaveDenied(e)) await noteDenied(runId); // the third refusal parks the run on replay
      throw e;
    }
    await removeQuietly(runId); // both writes are confirmed
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
