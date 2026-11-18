import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { dayKey, type GameDelta } from '../src/engine/game';
import type { SessionLog } from '../src/engine/models';

// Gem economy. A kid run raises gems by at most 10 (kidRaiseOk), xp by at most 2000. The throttle (full, half,
// quarter by gems earned today) lives in game.gemsEarnedToday and game.gemsDay, updated by applyGameDelta in the
// same transaction as the run, so two devices share one count. Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidreader01';
const NOW = Date.now();
const TODAY = dayKey(NOW);

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
type Db = ReturnType<typeof parentDb>;
const kidRef = (db: Db) => doc(db, `families/${FAM}/kids/${KID}`);

const GAME = { xp: 5000, gems: 100, streakDays: 3, lastPlayedDay: '2026-11-16', bestCombo: 12, heroes: ['knight', 'wizard'], hero: 'wizard' };
const KID_DOC = {
  id: KID, name: 'Readkid', createdAt: 1, hasPin: true,
  settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
  game: GAME,
};

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-gemeconomy', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), KID_DOC);
  });
});
const stored = async () => (await getDoc(kidRef(parentDb()))).data() as { game: Record<string, unknown> };
const write = (db: Db, over: Record<string, unknown>) => updateDoc(kidRef(db), { game: { ...GAME, ...over } });

describe('rules: a kid run raises gems by at most 10', () => {
  it('+10 gems and +504 xp passes; +11 is refused', async () => {
    await assertSucceeds(write(kidDb(), { xp: GAME.xp + 504, gems: GAME.gems + 10 }));
    await assertFails(write(kidDb(), { gems: GAME.gems + 11 }));
  });

  it('the old +50 bound no longer passes: +11, +50 and +51 are refused', async () => {
    for (const up of [11, 50, 51]) await assertFails(write(kidDb(), { gems: GAME.gems + up }));
  });

  it('there is no cap-remaining check: +10 passes with gemsEarnedToday at 25, 60 or 500', async () => {
    for (const earned of [25, 60, 500]) {
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(kidRef(ctx.firestore()), { ...KID_DOC, game: { ...GAME, gemsEarnedToday: earned, gemsDay: TODAY } }));
      await assertSucceeds(write(kidDb(), { gems: GAME.gems + 10, gemsEarnedToday: earned + 10, gemsDay: TODAY }));
    }
  });

  it('xp is still bounded: +2000 passes, +2001 is refused', async () => {
    await assertFails(write(kidDb(), { xp: GAME.xp + 2001 })); // a refused write changes nothing
    await assertSucceeds(write(kidDb(), { xp: GAME.xp + 2000 }));
  });

  it('a kid doc with game {} takes the starter hero and a 10-gem run in one write; 11 is refused', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(kidRef(ctx.firestore()), { ...KID_DOC, game: {} }));
    await assertFails(updateDoc(kidRef(kidDb()), { game: { xp: 50, gems: 11, heroes: ['knight'], hero: 'knight' } }));
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: { xp: 50, gems: 10, heroes: ['knight'], hero: 'knight' } }));
  });

  it('a parent write is not bounded by the run rule (the parent branch is unchanged)', async () => {
    await assertSucceeds(write(parentDb(), { gems: GAME.gems + 50 }));
  });
});

describe('rules: purchase-backed drops and prices are unchanged', () => {
  const buy = (db: Db, over: Record<string, unknown> = {}, cost = 35) => {
    const b = writeBatch(db);
    b.update(kidRef(db), { game: { ...GAME, gems: GAME.gems - cost, heroes: [...GAME.heroes, 'ranger'], hero: 'ranger', lastPurchaseId: 'p1', ...over } });
    b.set(doc(db, `families/${FAM}/kids/${KID}/purchases/p1`), { id: 'p1', heroId: 'ranger', cost, at: 1 });
    return b.commit();
  };

  it('a buy at the catalog price passes', async () => {
    await assertSucceeds(buy(kidDb()));
  });

  it('a buy at the wrong price is refused', async () => {
    await assertFails(buy(kidDb(), { gems: GAME.gems - 34 }, 35));
  });

  it('a drop with no purchase doc is refused, and a 10-gem raise does not make it legal', async () => {
    await assertFails(write(kidDb(), { gems: GAME.gems - 1 }));
    await assertFails(write(kidDb(), { gems: GAME.gems - 40 }));
  });
});

describe('two clients, one kid, the same day: the tier follows the shared count', () => {
  // One run at base 9 (27 of 30 correct, combo 8). Full rate 9, half rate 4, quarter rate 2.
  const stats = { correct: 27, graded: 30, bestCombo: 8, newLearned: 0 };
  const run = (id: string, playedAt = NOW): { delta: GameDelta; session: SessionLog } => ({
    delta: { xp: 100, gemRun: { stats, learner: 'reader', settings: {} }, bestCombo: 8, playedAt },
    session: { id, startedAt: playedAt - 60_000, endedAt: playedAt, answered: 30, graded: 30, correct: 27, fast: 10, newLearned: 0, medianMs: 3000, xp: 100, gems: 9, bestCombo: 8, missed: [] },
  });

  it('device A earns 27, then device B (which never saw A) earns at half rate from the stored count', async () => {
    const a = new FirestoreRepo(kidDb(), FAM);
    const b = new FirestoreRepo(env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore(), FAM);
    for (const id of ['a1', 'a2', 'a3']) {
      const r = run(id);
      await a.applyGameDelta(KID, r.delta, { session: r.session });
    }
    expect((await stored()).game).toMatchObject({ gems: 127, gemsEarnedToday: 27, gemsDay: TODAY });
    const r = run('b1');
    const after = await b.applyGameDelta(KID, r.delta, { session: r.session });
    expect(after.gems).toBe(131); // half rate: 4, not 9
    expect(after.gemsEarnedToday).toBe(31);
  });

  it('alternating devices walk the tiers in order: 9, 9, 9, then 4s, then 2s; the stored session logs hold what each run earned', async () => {
    const clients = [new FirestoreRepo(kidDb(), FAM), new FirestoreRepo(kidDb(), FAM)];
    const got: number[] = [];
    for (let i = 0; i < 12; i++) {
      const before = ((await stored()).game.gems as number);
      const r = run(`r${i}`);
      const g = await clients[i % 2]!.applyGameDelta(KID, r.delta, { session: r.session });
      got.push(g.gems - before);
    }
    expect(got).toEqual([9, 9, 9, 4, 4, 4, 4, 4, 4, 2, 2, 2]);
    expect((await stored()).game).toMatchObject({ gems: 157, gemsEarnedToday: 57 });
    const log = (await getDoc(doc(parentDb(), `families/${FAM}/kids/${KID}/sessions/r3`))).data() as SessionLog;
    expect(log.gems).toBe(4); // the log holds the gems the transaction awarded, not the screen's estimate
  });

  it('a replayed run (same session id) adds nothing a second time', async () => {
    const a = new FirestoreRepo(kidDb(), FAM);
    const r = run('same');
    await a.applyGameDelta(KID, r.delta, { session: r.session });
    await a.applyGameDelta(KID, r.delta, { session: r.session });
    expect((await stored()).game).toMatchObject({ gems: 109, gemsEarnedToday: 9 });
  });

  it('the next day starts at full rate again, and a purchase never lowers the earned count', async () => {
    const a = new FirestoreRepo(kidDb(), FAM);
    for (const id of ['d1', 'd2', 'd3', 'd4']) await a.applyGameDelta(KID, run(id).delta, { session: run(id).session });
    const g = await a.applyGameDelta(KID, { purchase: 'ranger' });
    expect(g.gemsEarnedToday).toBe(31);
    const tomorrow = await a.applyGameDelta(KID, run('t1', NOW + 86_400_000).delta, { session: run('t1', NOW + 86_400_000).session });
    expect(tomorrow.gemsEarnedToday).toBe(9);
    expect(tomorrow.gemsDay).toBe(dayKey(NOW + 86_400_000));
  });

  it('no clawback: a run on a kid who owns every hero and 300 gems only adds gems', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(kidRef(ctx.firestore()), { ...KID_DOC, game: { ...GAME, gems: 300, heroes: ['knight', 'wizard', 'ranger', 'robot', 'dragon'], hero: 'dragon', gemsEarnedToday: 400, gemsDay: TODAY } }));
    const a = new FirestoreRepo(kidDb(), FAM);
    const r = run('late');
    const g = await a.applyGameDelta(KID, r.delta, { session: r.session });
    expect(g.gems).toBe(302); // quarter rate: 2
    expect(g.heroes).toEqual(['knight', 'wizard', 'ranger', 'robot', 'dragon']);
  });
});
