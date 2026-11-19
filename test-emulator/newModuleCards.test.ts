import { readFileSync } from 'node:fs';
import { assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MODULES } from '../src/engine/modules';

// The new pre-reader modules (bonds10, missing10, doubles, add20) add card ids with ":", "+", "_" and "=" in them
// (bond:3, miss:4+_=7, dbl:6, near:6, a20:5+8) and settings.modules keys. The rules are NOT changed: these tests prove
// the existing rules already cover both. Names and ids are made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-newfacts-parent';
const KID = 'kidnewfactsaaaa0001';
let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const path = (id: string) => `families/${FAM}/kids/${KID}/cards/${id}`;
const card = (id: string) => ({ id, attempts: 1, correct: 1, recentMs: [1500], lastRating: 3, updatedAt: 1, supportLevel: 'dots', supportRun: 1, supportHold: 0, fsrs: { due: 1, stability: 1, difficulty: 1, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: 1 } });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-newfacts', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}`), { id: KID, name: 'Testkid', createdAt: 1, hasPin: true, settings: { sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3, learner: 'prereader', modules: { add10: true }, tracks: { facts: false, multidigit: false, fractions: false } }, game: { xp: 0, gems: 0, streakDays: 0, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } });
  });
});

describe('card ids of the new modules', () => {
  it('lets a kid token write and read every card of the four modules, in batches like saveCards', async () => {
    const db = kidDb();
    const ids = ['bonds10', 'missing10', 'doubles', 'add20'].flatMap((m) => MODULES.find((x) => x.id === m)!.cards.map((c) => c.id));
    expect(ids).toHaveLength(11 + 45 + 19 + 30);
    for (let i = 0; i < ids.length; i += 20) {
      const batch = writeBatch(db);
      for (const id of ids.slice(i, i + 20)) batch.set(doc(db, path(id)), card(id));
      await assertSucceeds(batch.commit());
    }
    const back = await assertSucceeds(getDoc(doc(db, path('miss:4+_=7'))));
    expect(back.data()).toMatchObject({ id: 'miss:4+_=7', supportLevel: 'dots' });
  });
});

describe('settings.modules for the new modules', () => {
  it('lets a parent turn bonds10 and missing10 on with a field-level write, and leaves the other settings alone', async () => {
    const ref = doc(parentDb(), `families/${FAM}/kids/${KID}`);
    await assertSucceeds(updateDoc(ref, { 'settings.modules.bonds10': true, 'settings.modules.missing10': true }));
    const s = ((await getDoc(ref)).data() as { settings: Record<string, unknown> }).settings;
    expect(s.modules).toEqual({ add10: true, bonds10: true, missing10: true });
    expect(s.paceMultiplier).toBe(3);
    expect(s.sessionSize).toBe(10);
  });

  it('keeps add20 off until it is written', async () => {
    const s = ((await getDoc(doc(parentDb(), `families/${FAM}/kids/${KID}`))).data() as { settings: { modules: Record<string, boolean> } }).settings;
    expect(s.modules.add20).toBeUndefined();
  });
});
