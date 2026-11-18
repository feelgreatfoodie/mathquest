import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { disableNetwork, doc, enableNetwork, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { VersionGuard } from '../src/data/versionGate';

// A stale copy of a kid doc, queued as a full-document write while offline and flushed on reconnect. Every
// name, id and number is made up. The loss this models was one stale full-doc write over a kid's totals.
// persistentLocalCache needs IndexedDB, which Node has not. The SDK queues an offline write in memory with the
// same flush-on-reconnect path, and the rules see the same request, so the queue is modelled with
// disableNetwork / enableNetwork. RULES_FILE runs the suite against another rules file.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const RULES_BEFORE_13 = readFileSync('test-emulator/fixtures/rules-before-13.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidflush01';

let env: RulesTestEnvironment;
let oldEnv: RulesTestEnvironment;
type Db = ReturnType<RulesTestEnvironment['authenticatedContext']> extends infer C ? (C extends { firestore(): infer F } ? F : never) : never;
const parentDb = (e: RulesTestEnvironment) => e.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = (e: RulesTestEnvironment) => e.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const kidRef = (db: Db) => doc(db, `families/${FAM}/kids/${KID}`);

const SETTINGS = { sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: false, multidigit: false, fractions: false }, learner: 'prereader', modules: { add10: true } };
const game = (over: Record<string, unknown> = {}) => ({ xp: 3801, gems: 56, streakDays: 1, lastPlayedDay: '2026-11-17', bestCombo: 22, heroes: ['knight'], hero: 'knight', ...over });
const kidDoc = (g: Record<string, unknown>) => ({ id: KID, name: 'Prekid', createdAt: 1, hasPin: true, settings: SETTINGS, game: g });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest', firestore: { rules: RULES } });
  oldEnv = await initializeTestEnvironment({ projectId: 'demo-mathquest-flush-before13', firestore: { rules: RULES_BEFORE_13 } });
});
afterAll(async () => {
  await env.cleanup();
  await oldEnv.cleanup();
});

async function seed(e: RulesTestEnvironment) {
  await e.clearFirestore();
  await e.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), kidDoc(game()));
  });
}
beforeEach(async () => {
  await seed(env);
  await seed(oldEnv);
});

async function storedGame(e: RulesTestEnvironment) {
  let out: { xp: number; gems: number } | undefined;
  await e.withSecurityRulesDisabled(async (ctx) => {
    out = ((await getDoc(kidRef(ctx.firestore()))).data() as { game: { xp: number; gems: number } }).game;
  });
  return out!;
}

/**
 * B reads the kid (its "older copy"). A, a current build, finishes a run. B goes offline, queues a full-doc
 * setDoc of the older copy, reconnects and flushes. Returns how B's write ended and what the server holds.
 */
async function flushStaleCopy(e: RulesTestEnvironment, who: 'kid' | 'parent', stale: Record<string, unknown>) {
  const b = who === 'kid' ? kidDb(e) : parentDb(e);
  expect(((await getDoc(kidRef(b))).data() as { game: { xp: number } }).game.xp).toBe(3801);
  const a = new FirestoreRepo(kidDb(e), FAM, new VersionGuard(null, { build: 100 }));
  await a.applyGameDelta(KID, { xp: 60, gems: 6, bestCombo: 22, playedAt: Date.parse('2026-11-18T01:00:00Z') });
  expect(await storedGame(e)).toMatchObject({ xp: 3861, gems: 62 });
  await disableNetwork(b);
  const queued = setDoc(kidRef(b), kidDoc(game(stale)));
  const outcome = queued.then(() => 'accepted', (err: { code?: string }) => err.code ?? 'error');
  await new Promise((r) => setTimeout(r, 150)); // still queued: offline, no answer yet
  await enableNetwork(b);
  return { outcome: await outcome, server: await storedGame(e) };
}

describe('an offline queued full-doc write of a stale kid copy, flushed on reconnect', () => {
  it('is refused for a kid token, and the doc keeps the run (stale copy xp 0, gems 0)', async () => {
    const r = await flushStaleCopy(env, 'kid', { xp: 0, gems: 0 });
    expect(r.outcome).toBe('permission-denied');
    expect(r.server).toMatchObject({ xp: 3861, gems: 62 });
  });

  it('is refused for a kid token holding the exact older copy (xp 3801, gems 56)', async () => {
    const r = await flushStaleCopy(env, 'kid', { xp: 3801, gems: 56 });
    expect(r.outcome).toBe('permission-denied');
    expect(r.server).toMatchObject({ xp: 3861, gems: 62 });
  });

  it('is refused for a parent device too (stale copy xp 0, gems 0)', async () => {
    const r = await flushStaleCopy(env, 'parent', { xp: 0, gems: 0 });
    expect(r.outcome).toBe('permission-denied');
    expect(r.server).toMatchObject({ xp: 3861, gems: 62 });
  });

  it('control: the rules before #13 accepted the same flush, and the doc read 0 xp and 0 gems', async () => {
    const r = await flushStaleCopy(oldEnv, 'kid', { xp: 0, gems: 0 });
    expect(r.outcome).toBe('accepted');
    expect(r.server).toMatchObject({ xp: 0, gems: 0 });
  });
});
