import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import type { SessionLog } from '../src/engine/models';

// A game, card or session write never waits for the minVersion check and never fails on it. Every name, id and
// number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidlaunch01';

let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const kidPath = `families/${FAM}/kids/${KID}`;
const session = (id: string): SessionLog => ({ id, startedAt: 1, endedAt: 2, answered: 1, graded: 1, correct: 1, fast: 1, newLearned: 0, medianMs: 1000, xp: 20, gems: 2, bestCombo: 1, missed: [] });
const card = { id: 'add:1+1', attempts: 1 } as never;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-launch', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, kidPath), {
      id: KID, name: 'Launchkid', createdAt: 1, hasPin: true,
      settings: { sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: false, multidigit: false, fractions: false } },
      game: { xp: 100, gems: 10, streakDays: 1, lastPlayedDay: '2026-11-17', bestCombo: 3, heroes: ['knight'], hero: 'knight' },
    });
  });
});

/** What the server holds, read with the rules off. */
async function serverState() {
  let out: { xp: number; sessions: number; cards: number } | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    out = {
      xp: ((await getDoc(doc(db, kidPath))).data() as { game: { xp: number } }).game.xp,
      sessions: (await getDocs(collection(db, `${kidPath}/sessions`))).size,
      cards: (await getDocs(collection(db, `${kidPath}/cards`))).size,
    };
  });
  return out!;
}
describe('writes do not depend on minVersion', () => {
  it('the three writers a run uses land at once', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    await Promise.all([
      repo.applyGameDelta(KID, { xp: 20, gems: 2, playedAt: 1 }, { session: session('s1') }),
      repo.saveCards(KID, [card]).catch(() => undefined), // the stub card may fail the card rules; it must not wait on minVersion
      repo.addSession(KID, session('s2')),
    ]);
    const s = await serverState();
    expect(s.xp).toBe(120);
    expect(s.sessions).toBe(2);
  });

  it('a stale build (minVersion above this build) still writes: the update prompt waits for the summary', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'config/app'), { minVersion: 4_000_000_000 }));
    const repo = new FirestoreRepo(kidDb(), FAM);
    await repo.applyGameDelta(KID, { xp: 20 }, { session: session('s1') });
    await repo.addSession(KID, session('s2'));
    const s = await serverState();
    expect(s.xp).toBe(120);
    expect(s.sessions).toBe(2);
  });
});
