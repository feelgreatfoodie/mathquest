import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { PRESETS, type Kid } from '../src/engine/models';
import { clearFailures, getFailures } from '../src/ui/failures';
import { loadRunner, saveRun } from '../src/ui/runShared';

// 11-18: the pre-reader kid played about 60 minutes and his game read 0/0. Every name, id and number
// below is made up. These tests use only code that already exists on main, so they run there:
//   1. a pre-reader run increases game xp and gems (current bundle: it does);
//   2. the old full-document write from a stale copy, which is how a stale bundle fails;
//   3. a run saves cards and sessions only under its own kidId.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
// The rules as deployed at the time of the incident: no xp or bestCombo guard (#13 came after).
const RULES_BEFORE_13 = readFileSync('test-emulator/fixtures/rules-before-13.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidprereader01';
const SIBLING = 'kidreader02';

let env: RulesTestEnvironment;
let oldEnv: RulesTestEnvironment;
const parentDb = (e = env) => e.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = (id = KID, e = env) => e.authenticatedContext(`kid_${id}`, { role: 'kid', familyUid: FAM, kidId: id }).firestore();
const kidRef = (db: ReturnType<typeof parentDb>, id = KID) => doc(db, `families/${FAM}/kids/${id}`);

/** A pre-reader as the app stores one: the preset settings with add10 and sub10 on. */
const PREREADER_SETTINGS = { ...PREREADER(), modules: { add10: true, sub10: true, facts: false } };
function PREREADER() {
  const p = PRESETS.prereader;
  return { ...p, tracks: { ...p.tracks } };
}
const game = (over: Record<string, unknown> = {}) => ({
  xp: 3801, gems: 56, streakDays: 1, lastPlayedDay: '2026-11-17', bestCombo: 22, heroes: ['knight'], hero: 'knight', ...over,
});
const prereader = (over: Record<string, unknown> = {}) => ({
  id: KID, name: 'Prekid', createdAt: 1, hasPin: true, settings: PREREADER_SETTINGS, game: game(), ...over,
});
const reader = () => ({
  id: SIBLING, name: 'Readkid', createdAt: 2, hasPin: true,
  settings: { ...PRESETS.reader, tracks: { ...PRESETS.reader.tracks } },
  game: game({ xp: 9557, gems: 90 }),
});

async function seed(e: RulesTestEnvironment) {
  await e.clearFirestore();
  await e.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), prereader());
    await setDoc(kidRef(db, SIBLING), reader());
    // The sibling's history: times-table cards and a session. A run by the pre-reader must never touch these.
    await setDoc(doc(db, `families/${FAM}/kids/${SIBLING}/cards/mul:2x3`), { id: 'mul:2x3', attempts: 7 });
    await setDoc(doc(db, `families/${FAM}/kids/${SIBLING}/cards/mul:4x5`), { id: 'mul:4x5', attempts: 2 });
    await setDoc(doc(db, `families/${FAM}/kids/${SIBLING}/sessions/s-old`), { id: 's-old', xp: 100 });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest', firestore: { rules: RULES } });
  oldEnv = await initializeTestEnvironment({ projectId: 'demo-mathquest-before13', firestore: { rules: RULES_BEFORE_13 } });
});
afterAll(async () => {
  await env.cleanup();
  await oldEnv.cleanup();
});
beforeEach(async () => {
  clearFailures();
  await seed(env);
  await seed(oldEnv);
});

const storedGame = async () => ((await getDoc(kidRef(parentDb()))).data() as Kid).game;
const dump = async (kidId: string, col: 'cards' | 'sessions') => {
  const snap = await getDocs(collection(parentDb(), `families/${FAM}/kids/${kidId}/${col}`));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id));
};

/** Answers every question of a real planned run correctly, through the same loadRunner and saveRun the screens use. */
async function playRun(repo: FirestoreRepo, kid: Kid) {
  const { runner, startedAt } = await loadRunner(repo, kid);
  while (!runner.done()) {
    const e = runner.current()!;
    if (e.kind === 'teach') runner.acknowledge();
    else {
      const a = e.problem.answer;
      runner.answer(a, 1500);
      runner.advance();
    }
  }
  return { runner, startedAt, saved: await saveRun(repo, kid, runner, startedAt) };
}

describe('a pre-reader run on the current build', () => {
  it('a pre-reader run increases game xp and gems', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const kid = (await repo.getKid(KID))!;
    const before = await storedGame();
    const { saved } = await playRun(repo, kid);
    expect(saved).not.toBeNull();
    expect(saved!.saved).toBe(true);
    expect(saved!.summary.xp).toBeGreaterThan(0);
    expect(saved!.summary.gems).toBeGreaterThan(0);
    const after = await storedGame();
    expect(after.xp).toBe(before.xp + saved!.summary.xp);
    expect(after.gems).toBe(before.gems + saved!.summary.gems);
    expect(after.xp).toBeGreaterThan(before.xp);
    expect(after.gems).toBeGreaterThan(before.gems);
    expect(getFailures()).toHaveLength(0);
  });

  it('a pre-reader run on a kid whose game is all zero still writes game (the restored case)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(kidRef(ctx.firestore()), prereader({ game: game({ xp: 0, gems: 0, bestCombo: 0, streakDays: 0, lastPlayedDay: null }) })));
    const repo = new FirestoreRepo(kidDb(), FAM);
    const { saved } = await playRun(repo, (await repo.getKid(KID))!);
    const after = await storedGame();
    expect(after.xp).toBe(saved!.summary.xp);
    expect(after.gems).toBe(saved!.summary.gems);
    expect(after.xp).toBeGreaterThan(0);
  });
});

describe('the old full-document write from a stale copy (a stale bundle)', () => {
  /** What a bundle from before #11 wrote: the whole kid doc, from its in-memory copy. */
  const oldFullWrite = (db: ReturnType<typeof parentDb>, copy: Record<string, unknown>) => setDoc(kidRef(db), copy);

  it('a kid-token full write is denied once a parent changed settings after the copy was loaded', async () => {
    // The kid screen holds a copy from before the parent turned sub10 on.
    const staleKidCopy = prereader({ settings: { ...PREREADER_SETTINGS, modules: { add10: true, facts: false } }, game: game({ xp: 3801 }) });
    const finished = { ...staleKidCopy, game: { ...staleKidCopy.game, xp: 3801 + 247, gems: 56 + 5 } };
    await assertFails(oldFullWrite(kidDb(), finished)); // affectedKeys = settings + game, the kid rule allows game only
    expect((await storedGame()).xp).toBe(3801); // the run's xp never landed; old code swallowed the error
  });

  it('the same kid-token write passes when the copy settings match, so the first denial is the first settings change', async () => {
    const copy = prereader();
    await assertSucceeds(oldFullWrite(kidDb(), { ...copy, game: { ...copy.game, xp: 3801 + 247, gems: 61 } }));
    expect((await storedGame()).xp).toBe(4048);
  });

  it('a parent full write from a copy made at kid creation resets game to zero on the rules deployed at the time', async () => {
    const creationCopy = prereader({ game: game({ xp: 0, gems: 0, bestCombo: 0, streakDays: 0, lastPlayedDay: null }) });
    await assertSucceeds(oldFullWrite(parentDb(oldEnv), creationCopy)); // gems 56 to 0 is a drop under 100, and no xp guard existed
    const g = ((await getDoc(kidRef(parentDb(oldEnv)))).data() as Kid).game;
    expect(g).toMatchObject({ xp: 0, gems: 0, bestCombo: 0, streakDays: 0, lastPlayedDay: null });
  });

  it('the same parent write is denied on the current rules and the totals stay', async () => {
    const creationCopy = prereader({ game: game({ xp: 0, gems: 0, bestCombo: 0, streakDays: 0, lastPlayedDay: null }) });
    await assertFails(oldFullWrite(parentDb(), creationCopy));
    expect(await storedGame()).toMatchObject({ xp: 3801, gems: 56 });
  });
});

describe('isolation: a run saves only under its own kidId', () => {
  it('a pre-reader run writes cards and one session under the pre-reader and nothing under the sibling', async () => {
    const siblingBefore = { cards: await dump(SIBLING, 'cards'), sessions: await dump(SIBLING, 'sessions'), game: ((await getDoc(kidRef(parentDb(), SIBLING))).data() as Kid).game };
    const repo = new FirestoreRepo(kidDb(), FAM);
    const { saved } = await playRun(repo, (await repo.getKid(KID))!);
    expect(saved!.saved).toBe(true);
    const mine = await dump(KID, 'cards');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c) => !c.id.startsWith('mul:'))).toBe(true); // add10 and sub10 only
    expect((await dump(KID, 'sessions')).length).toBe(1);
    expect(await dump(SIBLING, 'cards')).toEqual(siblingBefore.cards);
    expect(await dump(SIBLING, 'sessions')).toEqual(siblingBefore.sessions);
    expect(((await getDoc(kidRef(parentDb(), SIBLING))).data() as Kid).game).toEqual(siblingBefore.game);
  });

  it('a kid token cannot write cards, sessions or game under another kidId', async () => {
    const db = kidDb();
    await assertFails(setDoc(doc(db, `families/${FAM}/kids/${SIBLING}/cards/add:1+1`), { id: 'add:1+1' }));
    await assertFails(setDoc(doc(db, `families/${FAM}/kids/${SIBLING}/sessions/x`), { id: 'x' }));
    await assertFails(setDoc(kidRef(db, SIBLING), { ...reader(), game: game({ xp: 9999 }) }));
  });

  it('the repo for one kid never addresses another: saveCards with a foreign card id still lands under the caller kidId', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    await repo.saveCards(KID, [{ id: 'add:2+3' } as never]);
    expect((await dump(KID, 'cards')).map((c) => c.id)).toContain('add:2+3');
    expect((await dump(SIBLING, 'cards')).map((c) => c.id)).not.toContain('add:2+3');
  });
});
