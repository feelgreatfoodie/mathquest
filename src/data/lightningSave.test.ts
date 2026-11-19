import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRepo } from './localRepo';
import { outbox, replayOutbox } from './outbox';
import { makeKid } from '../engine/newKid';
import { LightningRound, buildDeck, lightningGrantBase } from '../engine/lightning';
import { mulberry32 } from '../engine/problems';
import { newCardState } from '../engine/scheduler';
import { dayKey } from '../engine/game';
import { sessionModeOf, type CardMap, type Kid } from '../engine/models';
import { fillLine, runLabel } from '../engine/runLabel';
import { FACT_CARDS } from '../engine/modules/legacy';
import { saveLightning } from '../game/modes/lightningWrite';
import { clearFailures } from '../ui/failures';
import { saveRun } from '../ui/runShared';
import { SessionRunner, type PlanItem } from '../engine/session';

// Lightning saves through the Adventure checkpoint path (save-first outbox, one growing session doc). Fails on main: lightningWrite.ts does not exist there.

function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

const ids = FACT_CARDS.map((c) => c.id);
const NOW = Date.now();
function weak(id: string): ReturnType<typeof newCardState> {
  const c = newCardState(id, NOW - 3_600_000);
  return { ...c, attempts: 6, correct: 3, recentMs: [5200, 4800], lastRating: 1, fsrs: { ...c.fsrs, state: 1, reps: 3, lapses: 1, stability: 1, last_review: NOW - 3_600_000, due: NOW }, day: dayKey(NOW), dayGraded: 2, lastResults: [true, false], missDay: dayKey(NOW) };
}
function known(id: string) {
  const c = newCardState(id, NOW - 86_400_000);
  return { ...c, attempts: 12, correct: 12, recentMs: [700, 800, 650], lastRating: 3, fsrs: { ...c.fsrs, state: 2, reps: 5, stability: 20, last_review: NOW - 86_400_000, due: NOW + 9 * 86_400_000 } };
}
const cards = (): CardMap => {
  const m: CardMap = {};
  ids.slice(0, 10).forEach((id) => (m[id] = weak(id)));
  ids.slice(10, 60).forEach((id) => (m[id] = known(id)));
  return m;
};

function play(kid: Kid, n: number, seed = 1): LightningRound {
  const c = cards();
  const deck = buildDeck({ cards: c, sessions: [], settings: { ...kid.settings, factGroupsUnlocked: 5 }, now: NOW, rng: mulberry32(seed) });
  const round = new LightningRound(deck, c, kid.settings, mulberry32(seed + 1), Date.now);
  for (let i = 0; i < n && round.current(); i++) {
    const card = round.current()!;
    round.show();
    round.answer({ kind: 'int', value: (card.problem.answer as { value: number }).value }, 700);
    round.advance();
  }
  return round;
}

describe('Lightning Round saves', () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    installStorage();
    clearFailures();
    await outbox.clear();
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  it('a checkpoint credits XP once, a replay changes nothing, and the close adds one gemGrant of at most 3 gems', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', 'reader');
    await repo.createKid(kid);
    const round = play(kid, 25);
    const mid = await saveLightning(repo, kid, round, { close: false, left: true });
    expect(mid.game!.xp).toBe(round.xp);
    expect(mid.game!.gems).toBe(0);
    const again = await saveLightning(repo, kid, round, { close: false, left: true });
    expect(again.game!.xp).toBe(round.xp);
    const end = await saveLightning(repo, kid, round, { close: true });
    expect(end.game!.xp).toBe(round.xp);
    expect(end.game!.gems).toBeGreaterThanOrEqual(1);
    expect(end.game!.gems).toBeLessThanOrEqual(3);
    // a repeat of the close, as a replay would send it, pays nothing more
    const replay = await saveLightning(repo, kid, round, { close: true });
    expect(replay.game!.gems).toBe(end.game!.gems);
    expect(replay.game!.xp).toBe(round.xp);
    const logs = await repo.listSessions(kid.id, 10);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ mode: 'lightning', finished: true, id: round.id });
    expect(logs[0]!.endedBy).toBeUndefined();
    expect(logs[0]!.gems).toBe(end.game!.gems);
    expect(runLabel(logs[0]!, 'reader')).toEqual({ mode: 'lightning', text: 'Lightning Round' });
    expect(sessionModeOf(logs[0]!, 'reader')).toBe('lightning');
    expect(await outbox.list(kid.id)).toEqual([]);
  });

  it('a checkpoint written as the page goes away survives: a refused write stays in the outbox and the next launch credits it', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', 'reader');
    await repo.createKid(kid);
    const round = play(kid, 12);
    const offline = Object.create(repo) as LocalRepo;
    offline.applyGameDelta = () => Promise.reject(new Error('offline'));
    const lost = await saveLightning(offline, kid, round, { close: false, left: true });
    expect(lost.game).toBeNull();
    const kept = await outbox.list(kid.id);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ checkpoint: true, kidId: kid.id });
    expect(kept[0]!.sessionLog).toMatchObject({ mode: 'lightning', endedBy: 'left', finished: false });
    expect((await repo.getKid(kid.id))!.game.xp).toBe(0);
    // the next launch replays it
    const { replayed } = await replayOutbox(repo, kid.id);
    expect(replayed).toBe(1);
    expect((await repo.getKid(kid.id))!.game.xp).toBe(round.xp);
    const logs = await repo.listSessions(kid.id, 5);
    expect(logs[0]).toMatchObject({ mode: 'lightning', endedBy: 'left', finished: false, xp: round.xp });
    // the cards were saved before the delta, with their delays
    const stored = await repo.loadCards(kid.id);
    expect(Object.values(stored).some((c) => typeof c.lightningDelayMs === 'number')).toBe(true);
  });

  it('a gem grant reaches the stored game once even when the close is replayed from the outbox after the write landed', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', 'reader');
    await repo.createKid(kid);
    const round = play(kid, 45);
    const end = await saveLightning(repo, kid, round, { close: true });
    const gems = end.game!.gems;
    expect(lightningGrantBase(round.result().hits, 1)).toBe(3);
    expect(gems).toBeLessThanOrEqual(3);
    // put the same close back, as if removeQuietly had failed, and replay it
    const log = (await repo.listSessions(kid.id, 1))[0]!;
    await outbox.put({ runId: `${round.id}:99`, kidId: kid.id, sessionLog: { ...log, finished: true }, gameDelta: { xp: round.xp, playedAt: Date.now(), gemGrant: { base: 3, learner: 'reader', settings: {} } }, checkpoint: true, savedAt: Date.now() });
    await replayOutbox(repo, kid.id);
    expect((await repo.getKid(kid.id))!.game.gems).toBe(gems);
  });

  it('does not double count with fill-credit or a Dungeon run: its own log, no practiceCorrect, every answer once', async () => {
    const repo = new LocalRepo();
    const kid = makeKid('Testkid', 'reader');
    await repo.createKid(kid);
    const round = play(kid, 30);
    const r = round.result();
    const lightning = await saveLightning(repo, kid, round, { close: true });
    // a Dungeon run of 6 fill answers on the same kid afterwards
    const plan: PlanItem[] = Array.from({ length: 6 }, (_, i) => ({ cardId: ids[i]!, isNew: false, fill: true }));
    const run = new SessionRunner(plan, {}, mulberry32(3), Date.now, kid.settings);
    while (!run.done()) {
      const e = run.current()!;
      run.answer({ kind: 'int', value: (e.problem.answer as { value: number }).value }, 1200);
      run.advance();
    }
    const dungeon = (await saveRun(repo, { ...kid, game: lightning.game! }, run, Date.now(), undefined, { mode: 'dungeon' }))!;
    const logs = await repo.listSessions(kid.id, 10);
    expect(logs).toHaveLength(2);
    const l = logs.find((x) => x.mode === 'lightning')!;
    const d = logs.find((x) => x.mode === 'dungeon')!;
    expect(l.answered).toBe(r.answered);
    expect(l.graded).toBe(l.answered);
    expect(l.practiceCorrect).toBeUndefined();
    expect(fillLine(l)).toBeNull();
    // the Dungeon log holds only its own 6 answers, none of the Lightning ones
    expect(d.answered).toBe(6);
    expect(d.correct).toBe(6);
    // XP is the sum of the two runs, each counted once
    expect(dungeon.updated.game.xp).toBe(r.xp + run.summary().xp);
    // the Dungeon run's gem stats carry no Lightning answer
    expect(dungeon.summary.practiceCorrect).toBeUndefined();
  });
});
