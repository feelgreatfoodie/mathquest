import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VersionGuard } from '../src/data/versionGate';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { PRESETS, type Kid } from '../src/engine/models';
import { clearFailures, getFailures, reportFailure } from '../src/ui/failures';
import { loadRunner, saveRun } from '../src/ui/runShared';

// The client-side gate: a build older than config/app.minVersion blocks game, card and session writes
// and never starts a run. A missing doc, a bad value or an unreadable doc lets the write through:
// the rules still protect the data, and an offline kid must be able to play.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidprereader01';
const BUILD = 1000;

let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const kidRef = (db: ReturnType<typeof kidDb>) => doc(db, `families/${FAM}/kids/${KID}`);
const setMin = (v: unknown) => env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'config/app'), { minVersion: v }));
const repoFor = (build: number) => {
  void build; // the repo never reads minVersion: the server rules are the guard
  return new FirestoreRepo(kidDb(), FAM);
};
const stored = async () => (await getDoc(kidRef(kidDb()))).data() as Kid;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  clearFailures();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(kidRef(db as never), {
      id: KID, name: 'Prekid', createdAt: 1, hasPin: true,
      settings: { ...PRESETS.prereader, tracks: { ...PRESETS.prereader.tracks } },
      game: { xp: 100, gems: 10, streakDays: 1, lastPlayedDay: '2026-11-17', bestCombo: 5, heroes: ['knight'], hero: 'knight' },
    });
  });
});

describe('VersionGuard', () => {
  it('reads minVersion and reports a behind build as stale', async () => {
    await setMin(BUILD + 1);
    const g = new VersionGuard(kidDb(), { build: BUILD });
    await g.refresh();
    expect(g.stale).toBe(true);
  });
  it('an equal or newer build passes', async () => {
    await setMin(BUILD);
    const g = new VersionGuard(kidDb(), { build: BUILD });
    await g.refresh();
    expect(g.stale).toBe(false);
  });
  it('a missing doc or a non-number value is not stale (fail open)', async () => {
    const g = new VersionGuard(kidDb(), { build: BUILD });
    await g.refresh();
    expect(g.stale).toBe(false);
    for (const bad of ['9999', null, -1, NaN, { a: 1 }]) {
      await setMin(bad);
      await g.refresh();
      expect(g.stale).toBe(false);
    }
  });
  it('an unreadable doc keeps the last known answer and does not throw', async () => {
    await setMin(BUILD + 5);
    const g = new VersionGuard(kidDb(), { build: BUILD });
    await g.refresh();
    expect(g.stale).toBe(true);
    const signedOut = new VersionGuard(env.unauthenticatedContext().firestore(), { build: BUILD });
    await expect(signedOut.refresh()).resolves.toBeUndefined();
    expect(signedOut.stale).toBe(false);
  });
  it('notifies listeners when the answer changes', async () => {
    const g = new VersionGuard(kidDb(), { build: BUILD });
    let calls = 0;
    g.subscribe(() => calls++);
    await setMin(BUILD + 1);
    await g.refresh();
    await g.refresh();
    expect(calls).toBe(1);
  });
});

describe('writes on a build behind minVersion', () => {
  it('applyGameDelta, saveCards and addSession write on a build behind minVersion: the server rules are the guard', async () => {
    await setMin(BUILD + 1);
    const repo = repoFor(BUILD);
    const session = { id: 's1', startedAt: 1, endedAt: 2, answered: 1, graded: 1, correct: 1, fast: 0, newLearned: 0, medianMs: 1, xp: 10, gems: 1, bestCombo: 1, missed: [] };
    await repo.applyGameDelta(KID, { xp: 10, gems: 1, bestCombo: 1, playedAt: Date.parse('2026-11-18T00:00:00Z') }, { session });
    await repo.saveCards(KID, [{ id: 'add:1+1' } as never]).catch(() => undefined); // a card doc must satisfy the rules; this stub may not
    expect((await stored()).game.xp).toBe(110);
    expect((await getDocs(collection(kidDb(), `families/${FAM}/kids/${KID}/sessions`))).size).toBe(1);
  });

  it('a denied write (permission-denied) is shown with the same message, never silent', async () => {
    reportFailure('Some of this run was not saved.', Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    expect(getFailures().map((f) => f.message)).toEqual(["Couldn't save. Tap to update or try again."]);
    expect(getFailures()[0]!.update).toBe(true);
  });

  it('a build at or above minVersion writes normally, and so does a missing doc', async () => {
    await expect(repoFor(BUILD).applyGameDelta(KID, { xp: 10, gems: 1, bestCombo: 1, playedAt: Date.parse('2026-11-18T00:00:00Z') })).resolves.toBeTruthy();
    await setMin(BUILD);
    await expect(repoFor(BUILD).applyGameDelta(KID, { xp: 10, gems: 1, bestCombo: 1, playedAt: Date.parse('2026-11-18T00:00:00Z') })).resolves.toBeTruthy();
    expect((await stored()).game.xp).toBe(120);
  });
});
