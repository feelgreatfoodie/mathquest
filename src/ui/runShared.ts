import { applyRun } from '../engine/game';
import { availableCards } from '../engine/mastery';
import { learnerOf, type Kid, type SessionLog } from '../engine/models';
import { moduleOfCard } from '../engine/modules';
import { SessionRunner, planSession, type RunSummary } from '../engine/session';
import { newId, type Repo } from '../data/repo';

/** Loads the kid's cards, plans a run and returns a runner. Both run screens start here. */
export async function loadRunner(repo: Repo, kid: Kid): Promise<{ runner: SessionRunner; startedAt: number }> {
  const cards = await repo.loadCards(kid.id);
  const now = Date.now();
  // A pre-reader only gets picture modules: a keypad question has nothing they could read.
  const available = availableCards(cards, kid.settings).filter(
    (c) => learnerOf(kid.settings) !== 'prereader' || moduleOfCard(c.id)?.input === 'choices',
  );
  const plan = planSession({
    cards,
    available,
    now,
    size: kid.settings.sessionSize,
    maxNew: kid.settings.maxNew,
    rng: Math.random,
  });
  return { runner: new SessionRunner(plan, cards, Math.random, Date.now, kid.settings), startedAt: now };
}

/**
 * Saves the run: changed cards, the session log, and the kid doc with the new game totals.
 * Returns null when nothing was answered. A failed save is logged and retried from the offline cache.
 */
export async function saveRun(repo: Repo, kid: Kid, runner: SessionRunner, startedAt: number): Promise<{ summary: RunSummary; updated: Kid } | null> {
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
  const updated: Kid = { ...kid, game: applyRun(kid.game, summary, now) };
  try {
    await repo.saveCards(kid.id, runner.changedCards());
    await repo.addSession(kid.id, log);
    await repo.saveKid(updated);
  } catch (e) {
    console.error('Saving the run failed; it will retry from the offline cache.', e);
  }
  return { summary, updated };
}
