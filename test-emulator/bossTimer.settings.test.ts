import { readFileSync } from 'node:fs';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';

// settings.bossTimer and settings.bossTimerPre are parent settings. The parent screen saves them through saveKidSettings
// (field-level), so a pause set from another phone since the screen loaded survives (#49). A kid token cannot write them.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidwren00001';
let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const kidRef = (db: ReturnType<typeof parentDb>) => doc(db, `families/${FAM}/kids/${KID}`);
const SETTINGS = { learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false }, sessionSize: 10, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3 };
const GAME = { xp: 500, gems: 20, streakDays: 1, lastPlayedDay: '2026-11-17', bestCombo: 9, heroes: ['knight'], hero: 'knight' };
const PAUSE = { on: true, until: 1_900_000_000_000, setAt: new Date('2026-11-18T20:00:00Z') };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-bosstimer', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), { id: KID, name: 'Wren', createdAt: 1, hasPin: true, settings: { ...SETTINGS, pause: PAUSE }, game: GAME });
  });
});
const stored = async () => (await getDoc(kidRef(parentDb()))).data() as { settings: Record<string, unknown> };

describe('boss timer settings', () => {
  it('the parent screen saves both fields from a copy with no pause, and the stored pause stays', async () => {
    await new FirestoreRepo(parentDb(), FAM).saveKidSettings(KID, { ...SETTINGS, bossTimer: 'harder', bossTimerPre: true } as never);
    const d = await stored();
    expect(d.settings).toMatchObject({ bossTimer: 'harder', bossTimerPre: true, sessionSize: 10 });
    expect(d.settings.pause).toMatchObject({ on: true, until: PAUSE.until });
  });
  it('a kid token cannot set either field', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.bossTimer': 'easier' }));
    await assertFails(updateDoc(kidRef(kidDb()), { 'settings.bossTimerPre': true }));
  });
});
