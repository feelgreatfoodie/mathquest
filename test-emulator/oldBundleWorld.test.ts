import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// An old bundle (cached on an iPad) has never heard of the Overworld. For a kid who has a world doc and a parent
// who set settings.modes.overworld, every write the old bundle makes must stay valid and must leave both alone:
// a run (game only), a hero buy, a session log, a card write. A kid still cannot turn the Overworld on for itself.
// Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidaaaa';

let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidRef = (db: ReturnType<typeof kidDb>) => doc(db, `families/${FAM}/kids/${KID}`);

const OLD_GAME = { lastPlayedDay: '2026-11-17', xp: 467, gems: 200, heroes: ['knight', 'wizard'], bestCombo: 16, hero: 'wizard', streakDays: 1 };
const SETTINGS = { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true }, modes: { overworld: true } };
const WORLD = { region: 'forest', x: 4, y: 7, facing: 'down', openedChests: ['mul:2x3'], bossesDefeated: ['meadow'], keys: 1, version: 1, updatedAt: 1000 };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-oldworld', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), { id: KID, name: 'Testkid', createdAt: 1, hasPin: true, settings: SETTINGS, game: OLD_GAME });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}/world/main`), WORLD);
  });
});

const stored = async () => (await getDoc(kidRef(parentDb()))).data() as { settings: typeof SETTINGS; game: { xp: number } };
// Read with the rules off: this file tests what an old bundle may write, so the read must not depend on a world rule.
const storedWorld = async () => {
  let data: unknown;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore(), `families/${FAM}/kids/${KID}/world/main`))).data();
  });
  return data;
};

describe('old bundle and lastMode (world/main with 10 fields)', () => {
  const worldRef = () => doc(kidDb(), `families/${FAM}/kids/${KID}/world/main`);
  it('an old bundle saves its 9-field world over a doc that has lastMode: accepted, and lastMode is gone (the device value then decides)', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `families/${FAM}/kids/${KID}/world/main`), { ...WORLD, lastMode: 'overworld' }));
    await assertSucceeds(setDoc(worldRef(), { ...WORLD, x: 5, updatedAt: 2000 }));
    expect(await storedWorld()).toEqual({ ...WORLD, x: 5, updatedAt: 2000 });
  });
  it('an old bundle reading a 10-field doc ignores lastMode; a run and a hero buy stay accepted next to it', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `families/${FAM}/kids/${KID}/world/main`), { ...WORLD, lastMode: 'dungeon' }));
    await assertSucceeds(getDoc(worldRef()));
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: { ...OLD_GAME, xp: 520, gems: 207, bestCombo: 20 } }));
    expect(await storedWorld()).toEqual({ ...WORLD, lastMode: 'dungeon' });
  });
  it('a new bundle sets lastMode on an existing world with one field; with no world doc the update fails and the device value is used', async () => {
    await assertSucceeds(updateDoc(worldRef(), { lastMode: 'prereader' }));
    expect(await storedWorld()).toEqual({ ...WORLD, lastMode: 'prereader' });
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), `families/${FAM}/kids/${KID}/world/main`)));
    await assertFails(updateDoc(worldRef(), { lastMode: 'dungeon' }));
  });
});

describe('old-shape kid writes with a world doc and modes.overworld set', () => {
  it('a run (game only) is accepted; settings.modes and the world doc are untouched', async () => {
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: { ...OLD_GAME, xp: 520, gems: 207, bestCombo: 20 } }));
    expect((await stored()).settings.modes).toEqual({ overworld: true });
    expect((await stored()).game.xp).toBe(520);
    expect(await storedWorld()).toEqual(WORLD);
  });
  it('a hero buy with its purchases doc is accepted', async () => {
    const db = kidDb();
    const b = writeBatch(db);
    b.update(kidRef(db), { game: { ...OLD_GAME, gems: 165, heroes: ['knight', 'wizard', 'ranger'], hero: 'ranger', lastPurchaseId: 'p2' } });
    b.set(doc(db, `families/${FAM}/kids/${KID}/purchases/p2`), { id: 'p2', heroId: 'ranger', cost: 35, at: 1000 });
    await assertSucceeds(b.commit());
    expect(await storedWorld()).toEqual(WORLD);
  });
  it('a session log and a card write are accepted', async () => {
    const db = kidDb();
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}/sessions/s1`), { id: 's1', startedAt: 1, endedAt: 2, answered: 3 }));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${KID}/cards/mul:2x3`), { id: 'mul:2x3', attempts: 1 }));
  });
  it('a kid still cannot change settings, so it cannot turn the Overworld on or off', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { settings: { ...SETTINGS, modes: { overworld: false } } }));
    await assertFails(updateDoc(kidRef(kidDb()), { game: { ...OLD_GAME, xp: 520 }, settings: { ...SETTINGS, modes: {} } }));
  });
  it('the parent saves settings with modes (a new bundle) and without them (an old bundle), both accepted', async () => {
    const { modes: _m, ...old } = SETTINGS;
    await assertSucceeds(updateDoc(kidRef(parentDb()), { settings: { ...SETTINGS, modes: { overworld: false } } }));
    await assertSucceeds(updateDoc(kidRef(parentDb()), { settings: old }));
  });
});
