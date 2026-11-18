import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { outbox, replayOutbox } from '../src/data/outbox';
import type { GameDelta } from '../src/engine/game';
import type { SessionLog } from '../src/engine/models';

// A run finished by a bundle older than the gem-economy build carries an absolute delta.gems (11 to 12 on a
// 50-question run) and no gemRun. The rules refuse a raise above 10, so the replay must clamp it to 10.
// Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidlegacy01';
const NOW = Date.now();
const GAME = { xp: 5000, gems: 100, streakDays: 3, lastPlayedDay: '2026-11-16', bestCombo: 12, heroes: ['knight', 'wizard'], hero: 'wizard' };
const KID_DOC = {
  id: KID, name: 'Legacykid', createdAt: 1, hasPin: true,
  settings: { sessionSize: 50, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
  game: GAME,
};

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-legacyrun', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await outbox.clear();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}`), KID_DOC);
  });
});

const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const stored = async () => ((await getDoc(doc(parentDb(), `families/${FAM}/kids/${KID}`))).data() as { game: { gems: number; xp: number; heroes: string[] } }).game;

function legacy(id: string, gems: number): { delta: GameDelta; session: SessionLog } {
  return {
    delta: { xp: 150, gems, bestCombo: 12, playedAt: NOW } as GameDelta, // no gemRun: written by the old bundle
    session: { id, startedAt: NOW - 60_000, endedAt: NOW, answered: 50, graded: 50, correct: 48, fast: 20, newLearned: 0, medianMs: 3000, xp: 150, gems, bestCombo: 12, missed: [] },
  };
}
async function keep(id: string, gems: number) {
  const r = legacy(id, gems);
  await outbox.put({ runId: id, kidId: KID, sessionLog: r.session, gameDelta: r.delta, savedAt: NOW });
}

describe('legacy outbox entries (no gemRun)', () => {
  it('+12 gems replays once and saves +10', async () => {
    await keep('old12', 12);
    const repo = new FirestoreRepo(kidDb(), FAM);
    expect(await replayOutbox(repo)).toEqual({ replayed: 1 });
    expect((await stored()).gems).toBe(110);
    expect((await stored()).xp).toBe(5150);
    expect(await outbox.list()).toHaveLength(0);
  });

  it('+11 saves +10, and the stored session log holds the 10 awarded', async () => {
    await keep('old11', 11);
    await replayOutbox(new FirestoreRepo(kidDb(), FAM));
    expect((await stored()).gems).toBe(110);
    const log = (await getDoc(doc(parentDb(), `families/${FAM}/kids/${KID}/sessions/old11`))).data() as SessionLog;
    expect(log.gems).toBe(10);
  });

  it('the same entry replayed twice changes the game once', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const r = legacy('twice', 12);
    await repo.applyGameDelta(KID, r.delta, { session: r.session });
    await repo.applyGameDelta(KID, r.delta, { session: r.session });
    expect(await stored()).toMatchObject({ gems: 110, xp: 5150 });
  });

  it('a +8 entry saves +8', async () => {
    await keep('old8', 8);
    await replayOutbox(new FirestoreRepo(kidDb(), FAM));
    expect((await stored()).gems).toBe(108);
  });

  it('a purchase delta is unchanged: the price comes off, nothing is clamped', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const g = await repo.applyGameDelta(KID, { purchase: 'ranger' });
    expect(g.heroes).toContain('ranger');
    expect(g.gems).toBeLessThan(100);
    expect((await stored()).gems).toBe(g.gems);
  });
});
