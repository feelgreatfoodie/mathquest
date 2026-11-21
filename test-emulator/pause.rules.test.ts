import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Pause is a parental control: settings.pause is written only by the parent account. A kid token (PIN sign-in) cannot set,
// clear or change it, alone or riding along a game write, an inventory write or a vault write. Every name and id is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidpip000001';
const KID2 = 'kidmay000002';
const OTHER_FAM = 'fam-other-uid';

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = (id = KID) => env.authenticatedContext(`kid_${id}`, { role: 'kid', familyUid: FAM, kidId: id }).firestore();
const strangerDb = () => env.authenticatedContext(OTHER_FAM, { email: 'other@example.com', email_verified: true }).firestore();
const noAuthDb = () => env.unauthenticatedContext().firestore();
type Db = ReturnType<typeof parentDb>;
const kidRef = (db: Db, id = KID) => doc(db, `families/${FAM}/kids/${id}`);
const SETTINGS = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
const GAME = { xp: 500, gems: 20, streakDays: 1, lastPlayedDay: '2026-11-17', bestCombo: 9, heroes: ['knight'], hero: 'knight' };
const PAUSE = { on: true, until: 1_900_000_000_000, setAt: new Date('2026-11-18T20:00:00Z') };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-pause', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());

async function seed(pause?: object) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    for (const [id, name] of [[KID, 'Pip'], [KID2, 'May']] as const)
      await setDoc(kidRef(db, id), { id, name, createdAt: 1, hasPin: true, settings: { ...SETTINGS, ...(pause ? { pause } : {}) }, game: GAME });
  });
}
const stored = async (id = KID) => (await getDoc(kidRef(parentDb(), id))).data() as { settings: Record<string, unknown>; game: typeof GAME };

describe('a kid token cannot set a pause', () => {
  beforeEach(() => seed());
  it('as a dotted field', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.pause': { on: true, setAt: serverTimestamp() } }));
  });
  it('as the whole settings map', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { settings: { ...SETTINGS, pause: { on: true, setAt: serverTimestamp() } } }));
  });
  it('riding along a game write', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.pause': { on: true, setAt: serverTimestamp() }, game: { ...GAME, xp: 520 } }));
  });
  it('riding along an inventory write', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.pause': { on: true }, inventory: { items: [] } }));
  });
  it('riding along a vault write', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.pause': { on: true }, vault: { active: 0 } }));
  });
  it('on a sibling kid doc', async () => {
    await assertFails(updateDoc(kidRef(kidDb(), KID2), { 'settings.pause': { on: true } }));
  });
  it('nothing changed in the stored doc', async () => {
    expect((await stored()).settings.pause).toBeUndefined();
  });
});

describe('a kid token cannot clear or shorten a pause', () => {
  beforeEach(() => seed(PAUSE));
  it('deleting the field', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.pause': deleteField() }));
  });
  it('turning it off', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.pause.on': false }));
  });
  it('moving until into the past', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.pause.until': 1 }));
  });
  it('replacing the whole settings map without the pause', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { settings: SETTINGS }));
  });
  it('riding along a game write', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.pause': deleteField(), game: { ...GAME, xp: 520 } }));
  });
  it('a plain game write still saves while paused (a run finishes and saves)', async () => {
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: { ...GAME, xp: 520 } }));
    const d = await stored();
    expect(d.game.xp).toBe(520);
    expect(d.settings.pause).toBeTruthy();
  });
  it('a kid token cannot overwrite the whole doc with set()', async () => {
    await assertFails(setDoc(kidRef(kidDb()), { id: KID, name: 'Pip', createdAt: 1, hasPin: true, settings: SETTINGS, game: GAME }));
  });
  it('the pause is still stored after every refusal', async () => {
    expect((await stored()).settings.pause).toMatchObject({ on: true, until: PAUSE.until });
  });
  it('a kid token can read its own pause, and a sibling doc while gifting is on (the gift picker)', async () => {
    await assertSucceeds(getDoc(kidRef(kidDb())));
    await assertSucceeds(getDoc(kidRef(kidDb(), KID2)));
  });
});

describe('another family or a signed-out client cannot change a pause', () => {
  beforeEach(() => seed(PAUSE));
  it('a stranger parent', async () => {
    await assertFails(updateDoc(kidRef(strangerDb()), { 'settings.pause': deleteField() }));
  });
  it('no sign-in', async () => {
    await assertFails(updateDoc(kidRef(noAuthDb()), { 'settings.pause': deleteField() }));
  });
});

describe('the parent controls the pause with field-level writes', () => {
  beforeEach(() => seed());
  it('pauses one kid until resumed, with a server stamp', async () => {
    await assertSucceeds(updateDoc(kidRef(parentDb()), { 'settings.pause': { on: true, setAt: serverTimestamp() } }));
    const d = await stored();
    expect(d.settings.pause).toMatchObject({ on: true });
    expect((d.settings.pause as { setAt: unknown }).setAt).toBeTruthy();
    expect(d.settings).toMatchObject(SETTINGS);
    expect(d.game).toEqual(GAME);
  });
  it('pauses one kid for a time: until is an absolute ms', async () => {
    await assertSucceeds(updateDoc(kidRef(parentDb()), { 'settings.pause': { on: true, until: PAUSE.until, setAt: serverTimestamp() } }));
    expect((await stored()).settings.pause).toMatchObject({ until: PAUSE.until });
  });
  it('pauses everyone in one batch, and leaves each kid\'s game alone', async () => {
    const db = parentDb();
    const batch = writeBatch(db);
    for (const id of [KID, KID2]) batch.update(kidRef(db, id), { 'settings.pause': { on: true, setAt: serverTimestamp() } });
    await assertSucceeds(batch.commit());
    for (const id of [KID, KID2]) {
      const d = await stored(id);
      expect(d.settings.pause).toMatchObject({ on: true });
      expect(d.game).toEqual(GAME);
    }
  });
  it('resumes by deleting the field, and the other settings stay', async () => {
    await assertSucceeds(updateDoc(kidRef(parentDb()), { 'settings.pause': { on: true, setAt: serverTimestamp() } }));
    await assertSucceeds(updateDoc(kidRef(parentDb()), { 'settings.pause': deleteField() }));
    const d = await stored();
    expect(d.settings.pause).toBeUndefined();
    expect(d.settings).toMatchObject(SETTINGS);
  });
});

describe('the parent repo: every settings save is field-level and keeps the pause', () => {
  const repo = () => new FirestoreRepo(parentDb(), FAM);
  const OLD_COPY = { ...SETTINGS }; // the settings screen's copy, read before the pause was set

  it('saving another setting while a pause is on keeps the pause (the screen copy has no pause)', async () => {
    await seed(PAUSE);
    await repo().saveKidSettings(KID, { ...OLD_COPY, maxNew: 5 } as never);
    const d = await stored();
    expect(d.settings.maxNew).toBe(5);
    expect(d.settings.pause).toMatchObject({ on: true, until: PAUSE.until });
  });
  it('saving with a stale pause in the copy does not rewrite or clear the stored one', async () => {
    await seed(PAUSE);
    await repo().saveKidSettings(KID, { ...OLD_COPY, maxNew: 6, pause: { on: true, until: 5, setAt: 5 } } as never);
    expect((await stored()).settings.pause).toMatchObject({ until: PAUSE.until });
  });
  it('a pause set after the screen loaded survives a save of a screen that had no pause', async () => {
    await seed();
    await repo().setKidPause([KID], { until: 1_950_000_000_000 });
    await repo().saveKidSettings(KID, { ...OLD_COPY, sessionSize: 12 } as never);
    const d = await stored();
    expect(d.settings.sessionSize).toBe(12);
    expect(d.settings.pause).toMatchObject({ on: true, until: 1_950_000_000_000 });
  });
  it('a setting the screen dropped is deleted, and the rest stays', async () => {
    await seed({ ...PAUSE });
    await env.withSecurityRulesDisabled(async (ctx) => updateDoc(kidRef(ctx.firestore()), { 'settings.groupsUnlocked': { add10: 2 } }));
    const { groupsUnlocked: _g, ...without } = { ...OLD_COPY, groupsUnlocked: { add10: 2 } };
    void _g;
    await repo().saveKidSettings(KID, without as never);
    const d = await stored();
    expect(d.settings.groupsUnlocked).toBeUndefined();
    expect(d.settings.pause).toBeTruthy();
    expect(d.settings).toMatchObject({ learner: 'prereader', sessionSize: 10 });
  });
  it('a removed kid fails the save', async () => {
    await seed();
    await expect(repo().saveKidSettings('kidgone0000', OLD_COPY as never)).rejects.toThrow(/removed/);
  });
  it('setKidPause writes the one field: until, a server stamp, and nothing else in settings', async () => {
    await seed();
    await repo().setKidPause([KID, KID2], { until: 1_950_000_000_000 });
    for (const id of [KID, KID2]) {
      const d = await stored(id);
      expect(d.settings).toMatchObject(SETTINGS);
      expect(d.settings.pause).toMatchObject({ on: true, until: 1_950_000_000_000 });
      expect((d.settings.pause as { setAt: unknown }).setAt).toBeTruthy();
    }
    await repo().setKidPause([KID], null);
    expect((await stored(KID)).settings.pause).toBeUndefined();
    expect((await stored(KID2)).settings.pause).toBeTruthy();
  });
});
