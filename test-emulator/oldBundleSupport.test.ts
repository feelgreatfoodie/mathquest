import { readFileSync } from 'node:fs';
import { assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CardState } from '../src/engine/models';
import { fadeStep, supportOf } from '../src/engine/support';

// The pre-reader fade keeps supportLevel, supportRun and supportHold on the card doc. The rules are NOT changed: a card doc
// only needs its id to match and fewer than 20 fields. An old bundle (still cached on an iPad) writes the card without the
// three fields. That write must pass, and it resets the card to dots, which is the accepted cost. Names and ids are made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-support-parent';
const KID = 'kidsupportaaaa00001';
let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const path = (id: string) => `families/${FAM}/kids/${KID}/cards/${id}`;

const FSRS = { due: 1, stability: 9, difficulty: 3, elapsed_days: 0, scheduled_days: 9, learning_steps: 0, reps: 4, lapses: 0, state: 2, last_review: 1 };
const newCard = (id: string): CardState => ({
  id, attempts: 6, correct: 6, recentMs: [2100, 1900], lastRating: 3, updatedAt: 5, fsrs: FSRS,
  day: '2026-11-18', dayGraded: 1, lastResults: [true, true], missDay: '2026-11-10', supportLevel: 'numerals', supportRun: 1, supportHold: 0,
});
// What an old bundle writes: the card without the three fields.
const oldWrite = (c: CardState) => {
  const { supportLevel: _l, supportRun: _r, supportHold: _h, ...rest } = c;
  return rest;
};

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-support', firestore: { rules: RULES } });
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

describe('a card doc with the fade fields', () => {
  it('is accepted from a kid token, with every optional field present, and reads back as written', async () => {
    const c = newCard('add:2+3');
    expect(Object.keys(c).length).toBeLessThan(20);
    await assertSucceeds(setDoc(doc(kidDb(), path(c.id)), c));
    const back = (await getDoc(doc(parentDb(), path(c.id)))).data() as CardState;
    expect(back).toMatchObject({ supportLevel: 'numerals', supportRun: 1, supportHold: 0 });
  });

  it('is accepted in a batch, the way saveCards writes it', async () => {
    const db = kidDb();
    const batch = writeBatch(db);
    for (const id of ['add:1+2', 'sub:5-2']) batch.set(doc(db, path(id)), fadeCard(id));
    await assertSucceeds(batch.commit());
  });
});

const fadeCard = (id: string): CardState => ({ ...newCard(id), ...fadeStep(undefined, { correct: true, helped: false, solid: false }) });

describe('an old bundle writes the same card with no fade fields', () => {
  it('is accepted, and the card reads as dots afterwards', async () => {
    const c = newCard('add:2+3');
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path(c.id)), c));
    await assertSucceeds(setDoc(doc(kidDb(), path(c.id)), oldWrite(c)));
    const back = (await getDoc(doc(parentDb(), path(c.id)))).data() as CardState;
    expect(back.supportLevel).toBeUndefined();
    expect(supportOf(back)).toBe('dots');
    expect(back.attempts).toBe(6);
  });

  it('is accepted for a card that never had the fields', async () => {
    const c = oldWrite(newCard('sub:5-2')) as CardState;
    await assertSucceeds(setDoc(doc(kidDb(), path(c.id)), c));
    expect(supportOf((await getDoc(doc(parentDb(), path(c.id)))).data() as CardState)).toBe('dots');
  });
});
