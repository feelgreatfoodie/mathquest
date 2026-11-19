import { readFileSync } from 'node:fs';
import { assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { enabledModes } from '../src/game/modes/registry';
import { newWorld } from '../src/game/overworld/worldState';
import { PRESETS, learnerOf, modesOnOf, type Kid } from '../src/engine/models';
import { loadRunner, saveRun } from '../src/ui/runShared';

// A pre-reader plays Adventure under the kid token. The settings doc has no `modes` field (every doc before this
// change), so Adventure must read as on. The trip writes world/main, the same round save as Picture Run, and the
// firestore.rules are not touched: nothing in them reads the learner. Names and ids are made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidprereader02';
const MIN_VERSION = 1794971970; // the live floor: an old bundle is one that sits at or above it and predates Adventure for pre-readers

let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const kidRef = (db: ReturnType<typeof kidDb>) => doc(db, `families/${FAM}/kids/${KID}`);
const stored = async () => (await getDoc(kidRef(kidDb()))).data() as Kid;
const OLD_GAME = { xp: 100, gems: 10, streakDays: 1, lastPlayedDay: '2026-11-17', bestCombo: 5, heroes: ['knight'], hero: 'knight' };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-prereader-adventure', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, 'config/app'), { minVersion: MIN_VERSION });
    await setDoc(kidRef(db as never), { id: KID, name: 'Prekid', createdAt: 1, hasPin: true, settings: { ...PRESETS.prereader, tracks: { ...PRESETS.prereader.tracks } }, game: OLD_GAME });
  });
});

describe('a pre-reader Adventure trip under the kid token', () => {
  it('the stored pre-reader doc has no modes field and Adventure reads as on, next to Picture Run', async () => {
    const kid = await stored();
    expect(kid.settings.modes).toBeUndefined();
    expect(learnerOf(kid.settings)).toBe('prereader');
    expect(modesOnOf(kid.settings).overworld).toBe(true);
    expect(enabledModes(kid).map((m) => m.name)).toEqual(['Picture Run', 'Adventure', 'Lightning Round']);
  });

  it('saves world/main, then the round: session log, cards, and game xp and gems up', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const kid = await stored();
    await repo.saveWorld(KID, newWorld(Date.now()));
    expect((await getDoc(doc(kidDb(), `families/${FAM}/kids/${KID}/world/main`))).exists()).toBe(true);

    const { runner, startedAt } = await loadRunner(repo, kid);
    const entry = runner.current()!;
    const answer = entry.problem.answer;
    expect(answer.kind).toBe('int');
    expect(entry.problem.choices).toBeTruthy();
    runner.answerEntry(entry.id, answer, 1500, {});
    const out = await saveRun(repo, kid, runner, startedAt);
    expect(out?.saved).toBe(true);

    const after = await stored();
    expect(after.game.xp).toBeGreaterThan(OLD_GAME.xp);
    expect(after.game.gems).toBeGreaterThanOrEqual(OLD_GAME.gems);
    expect((await getDocs(collection(kidDb(), `families/${FAM}/kids/${KID}/sessions`))).size).toBe(1);
    expect((await getDocs(collection(kidDb(), `families/${FAM}/kids/${KID}/cards`))).size).toBeGreaterThan(0);
    // The world doc is still there, and the round did not touch the settings.
    expect((await getDoc(doc(kidDb(), `families/${FAM}/kids/${KID}/world/main`))).exists()).toBe(true);
    expect(after.settings.modes).toBeUndefined();
  });

  it('an old bundle (game-only update, session log, card write) is accepted with a world doc present, at the live minVersion', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `families/${FAM}/kids/${KID}/world/main`), { ...newWorld(1000) }));
    const db = kidDb();
    await assertSucceeds(updateDoc(kidRef(db), { game: { ...OLD_GAME, xp: 160, gems: 14, bestCombo: 8 } }));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}/sessions/s1`), { id: 's1', startedAt: 1, endedAt: 2, answered: 3 }));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}/cards/add10:1+1`), { id: 'add10:1+1', attempts: 1 }));
    expect((await stored()).game.xp).toBe(160);
    expect((await getDoc(doc(db, 'config/app'))).data()).toEqual({ minVersion: MIN_VERSION });
  });
});
