import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Settings writes are parent-only. A field-level update (dotted paths) sets settings.groupsUnlocked and
// settings.maxNew without sending the rest of the doc. Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidprereader01';

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
type Db = ReturnType<typeof parentDb>;
const kidRef = (db: Db) => doc(db, `families/${FAM}/kids/${KID}`);
const SETTINGS = { learner: 'prereader', modules: { add10: true, sub10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
const GAME = { xp: 500, gems: 20, streakDays: 1, lastPlayedDay: '2026-11-17', bestCombo: 9, heroes: ['knight'], hero: 'knight' };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-settings', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), { id: KID, name: 'Prekid', createdAt: 1, hasPin: true, settings: SETTINGS, game: GAME });
  });
});
const stored = async () => (await getDoc(kidRef(parentDb()))).data() as { settings: Record<string, unknown>; game: typeof GAME };

describe('settings.groupsUnlocked and settings.maxNew', () => {
  it('a kid token is refused on settings.groupsUnlocked', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.groupsUnlocked': { add10: 2, sub10: 2 } }));
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.groupsUnlocked.add10': 2 }));
  });

  it('a kid token is refused on settings.maxNew', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.maxNew': 12 }));
  });

  it('a kid token is refused when the settings change rides along a run write', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.maxNew': 12, game: { ...GAME, xp: 520, gems: 22 } }));
  });

  it('the parent sets both with one field-level update; the rest of settings and game stay as they were', async () => {
    await assertSucceeds(updateDoc(kidRef(parentDb()), { 'settings.groupsUnlocked': { add10: 2, sub10: 2 }, 'settings.maxNew': 4 }));
    const d = await stored();
    expect(d.settings).toMatchObject({ ...SETTINGS, maxNew: 4, groupsUnlocked: { add10: 2, sub10: 2 } });
    expect(d.game).toEqual(GAME);
  });

  it('the parent sets one module with a nested dotted path', async () => {
    await assertSucceeds(updateDoc(kidRef(parentDb()), { 'settings.groupsUnlocked.add10': 2 }));
    expect((await stored()).settings.groupsUnlocked).toEqual({ add10: 2 });
  });

  it('a kid token still writes its game as before', async () => {
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: { ...GAME, xp: 520, gems: 22 } }));
  });
});
