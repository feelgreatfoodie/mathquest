import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ISO follow-up bpkdBjn5 (from the #56 panel): the parent's settings write carries settings.lightningFloorMs. When present it is a whole
// number from 1000 to 4000. A write without it passes. Each refusal test first makes a good write, so it also fails on a rules file with
// no check. Names and ids are made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-floor-parent';
const KID = 'kidflooraaaa0001';
let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidRef = () => doc(parentDb(), `families/${FAM}/kids/${KID}`);

const SETTINGS = { sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 };
const KIDDOC = { id: KID, name: 'Testkid', createdAt: 1, hasPin: true, settings: SETTINGS, game: { xp: 0, gems: 0, streakDays: 0, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } };
const withFloor = (v?: unknown) => ({ ...KIDDOC, settings: v === undefined ? SETTINGS : { ...SETTINGS, lightningFloorMs: v } });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-floor', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}`), KIDDOC);
  });
});

describe('settings.lightningFloorMs on the parent write', () => {
  it('a write without the field passes', async () => {
    await assertSucceeds(setDoc(kidRef(), withFloor()));
  });
  it('2000 passes, and the bounds 1000 and 4000 pass', async () => {
    await assertSucceeds(setDoc(kidRef(), withFloor(2000)));
    await assertSucceeds(setDoc(kidRef(), withFloor(1000)));
    await assertSucceeds(setDoc(kidRef(), withFloor(4000)));
  });
  it('500 is refused', async () => {
    await assertSucceeds(setDoc(kidRef(), withFloor(2000)));
    await assertFails(setDoc(kidRef(), withFloor(500)));
  });
  it('5000 is refused', async () => {
    await assertSucceeds(setDoc(kidRef(), withFloor(2000)));
    await assertFails(setDoc(kidRef(), withFloor(5000)));
  });
  it('a string is refused', async () => {
    await assertSucceeds(setDoc(kidRef(), withFloor(2000)));
    await assertFails(setDoc(kidRef(), withFloor('2000')));
  });
  it('a fraction is refused', async () => {
    await assertSucceeds(setDoc(kidRef(), withFloor(2000)));
    await assertFails(setDoc(kidRef(), withFloor(2000.5)));
  });
  it('the dotted-path update the Parent screen sends follows the same range', async () => {
    await assertSucceeds(updateDoc(kidRef(), { 'settings.lightningFloorMs': 2500 }));
    await assertFails(updateDoc(kidRef(), { 'settings.lightningFloorMs': 999 }));
    await assertFails(updateDoc(kidRef(), { 'settings.lightningFloorMs': 4001 }));
  });
  it('a create with a bad value is refused', async () => {
    await env.withSecurityRulesDisabled((ctx) => import('firebase/firestore').then(({ deleteDoc }) => deleteDoc(doc(ctx.firestore(), `families/${FAM}/kids/${KID}`))));
    await assertFails(setDoc(kidRef(), withFloor(9000)));
    await assertSucceeds(setDoc(kidRef(), withFloor(3000)));
  });
});
