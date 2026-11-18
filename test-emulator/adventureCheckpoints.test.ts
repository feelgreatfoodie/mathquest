import { readFileSync } from 'node:fs';
import { assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { PRESETS, type Kid, type Learner, type SessionLog } from '../src/engine/models';
import { EMPTY_TOTALS, resolveTrip, type TripTotals } from '../src/game/overworld/trip';
import { queueCheckpoint } from '../src/game/overworld/tripWrite';

// Adventure trips checkpoint one session doc under the kid token. The rules are unchanged: a kid already creates and updates
// its own session docs (smallDoc), and the game write is the same one a round makes. Names, ids and numbers are made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidtripaaaa01';
const MIN_VERSION = 1794971970; // the live floor
const OLD_GAME = { xp: 100, gems: 10, streakDays: 1, lastPlayedDay: '2026-11-17', bestCombo: 5, heroes: ['knight'], hero: 'knight' };

let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const kidRef = (db: ReturnType<typeof kidDb>) => doc(db, `families/${FAM}/kids/${KID}`);
const stored = async () => (await getDoc(kidRef(kidDb()))).data() as Kid;
const sessionOf = async (id: string) => (await getDoc(doc(kidDb(), `families/${FAM}/kids/${KID}/sessions/${id}`))).data() as SessionLog | undefined;
const totals = (graded: number, xp: number): TripTotals => ({ ...EMPTY_TOTALS, answered: graded, graded, correct: graded, xp, bestCombo: graded });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-adventure-checkpoints', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());

async function seed(learner: Learner) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, 'config/app'), { minVersion: MIN_VERSION });
    const settings = learner === 'prereader' ? { ...PRESETS.prereader, tracks: { ...PRESETS.prereader.tracks } } : { ...PRESETS.reader, tracks: { ...PRESETS.reader.tracks } };
    await setDoc(kidRef(db as never), { id: KID, name: 'Tripkid', createdAt: 1, hasPin: true, settings, game: OLD_GAME });
  });
}

describe.each<Learner>(['reader', 'prereader'])('Adventure checkpoints under the kid token (%s)', (learner) => {
  beforeEach(() => seed(learner));
  const trip = () => resolveTrip(null, Date.now(), () => 'tripemu000000000001').trip;

  it('a checkpoint creates the trip doc and credits XP; the next one credits only the difference', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const t = trip();
    await queueCheckpoint(repo, KID, t, totals(10, 100), 'meadow');
    expect(await sessionOf(t.tripId)).toMatchObject({ graded: 10, xp: 100, xpCredited: 100, mode: 'overworld', region: 'meadow', finished: false });
    expect((await stored()).game.xp).toBe(OLD_GAME.xp + 100);
    await queueCheckpoint(repo, KID, t, totals(20, 230), 'forest');
    expect(await sessionOf(t.tripId)).toMatchObject({ graded: 20, xpCredited: 230, region: 'forest' });
    expect((await stored()).game.xp).toBe(OLD_GAME.xp + 230);
    expect((await getDocs(collection(kidDb(), `families/${FAM}/kids/${KID}/sessions`))).size).toBe(1);
  });

  it('a repeat of an older checkpoint after a newer one adds nothing and does not shrink the doc', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const t = trip();
    await queueCheckpoint(repo, KID, t, totals(10, 100), 'meadow');
    await queueCheckpoint(repo, KID, t, totals(20, 230), 'meadow');
    // The first checkpoint's outbox entry replays late (a crash before it was removed).
    await repo.applyGameDelta(KID, { xp: 100, bestCombo: 10, playedAt: Date.now() }, { session: { ...(await sessionOf(t.tripId))!, graded: 10, xp: 100, finished: false }, checkpoint: true });
    expect((await stored()).game.xp).toBe(OLD_GAME.xp + 230);
    expect(await sessionOf(t.tripId)).toMatchObject({ graded: 20, xpCredited: 230 });
  });

  it('the campfire closes the trip: finished true once, and a late checkpoint cannot reopen it or add XP', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const t = trip();
    await queueCheckpoint(repo, KID, t, totals(15, 150), 'castle');
    const final = { ...(await sessionOf(t.tripId))!, graded: 30, xp: 320, finished: true, endedBy: 'camp' as const };
    await repo.applyGameDelta(KID, { xp: 320, bestCombo: 30, playedAt: Date.now() }, { session: final, checkpoint: true });
    expect(await sessionOf(t.tripId)).toMatchObject({ graded: 30, finished: true, endedBy: 'camp', xpCredited: 320 });
    expect((await stored()).game.xp).toBe(OLD_GAME.xp + 320);
    await repo.applyGameDelta(KID, { xp: 400, playedAt: Date.now() }, { session: { ...final, finished: false, xp: 400 }, checkpoint: true });
    expect(await sessionOf(t.tripId)).toMatchObject({ finished: true, xpCredited: 320 });
    expect((await stored()).game.xp).toBe(OLD_GAME.xp + 320);
  });

  it('two devices checkpointing the same trip at once credit each XP once', async () => {
    const a = new FirestoreRepo(kidDb(), FAM);
    const b = new FirestoreRepo(kidDb(), FAM);
    const t = trip();
    const t2 = { ...t };
    await Promise.all([queueCheckpoint(a, KID, t, totals(10, 100), 'meadow'), queueCheckpoint(b, KID, t2, totals(10, 100), 'meadow')]);
    expect((await stored()).game.xp).toBe(OLD_GAME.xp + 100);
    expect((await sessionOf(t.tripId))!.xpCredited).toBe(100);
  });

  it('an old-bundle round save (game-only update, its own session log, a card write) is accepted next to the trip doc, at the live minVersion', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const t = trip();
    await queueCheckpoint(repo, KID, t, totals(10, 100), 'meadow');
    const db = kidDb();
    const before = (await stored()).game;
    await assertSucceeds(updateDoc(kidRef(db), { game: { ...before, xp: before.xp + 60, gems: before.gems + 3, bestCombo: before.bestCombo } }));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}/sessions/oldbundlerun01`), { id: 'oldbundlerun01', startedAt: 1, endedAt: 2, answered: 3, graded: 3, correct: 3, fast: 0, newLearned: 0, medianMs: 1, xp: 60, gems: 3, bestCombo: 3, missed: [] }));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}/cards/add10:1+1`), { id: 'add10:1+1', attempts: 1 }));
    expect((await getDoc(doc(db, 'config/app'))).data()).toEqual({ minVersion: MIN_VERSION });
    expect((await getDocs(collection(db, `families/${FAM}/kids/${KID}/sessions`))).size).toBe(2);
    expect((await sessionOf(t.tripId))!.xpCredited).toBe(100);
  });
});
