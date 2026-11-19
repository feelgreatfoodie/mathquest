import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CardState } from '../src/engine/models';

// Lightning Round keeps its delay on the card as lightningDelayMs. firestore.rules checks it when present: a whole number
// from 1000 to 4000. A write from an old bundle has no such field and must still pass. The stored card stays under the
// 20-field limit of smallDoc. Names and ids are made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-lightning-parent';
const KID = 'kidlightningaaaa0001';
let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const path = (id: string) => `families/${FAM}/kids/${KID}/cards/${id}`;

const FSRS = { due: 1, stability: 9, difficulty: 3, elapsed_days: 0, scheduled_days: 9, learning_steps: 0, reps: 4, lapses: 0, state: 2, last_review: 1 };
/** Every field a card can carry, the new one included. */
const fullCard = (id: string, delay?: unknown): CardState => ({
  id, attempts: 6, correct: 6, recentMs: [2100, 1900], lastRating: 3, updatedAt: 5, fsrs: FSRS,
  day: '2026-11-18', dayGraded: 1, lastResults: [true, true], missDay: '2026-11-10', supportLevel: 'numerals', supportRun: 1, supportHold: 0,
  ...(delay === undefined ? {} : { lightningDelayMs: delay as number }),
});
/** What an old bundle writes: no lightningDelayMs. */
const oldWrite = (id: string) => fullCard(id);

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-lightning', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}`), { id: KID, name: 'Testkid', createdAt: 1, hasPin: true, settings: { sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3 }, game: { xp: 0, gems: 0, streakDays: 0, lastPlayedDay: null, bestCombo: 0, heroes: ['knight'], hero: 'knight' } });
  });
});

describe('card lightningDelayMs', () => {
  it('counts 15 stored fields with the new one, under the 20 limit', () => {
    expect(Object.keys(fullCard('mul:3x4', 2500)).length).toBe(15);
    expect(Object.keys(fullCard('mul:3x4', 2500)).length).toBeLessThan(20);
  });

  it('an old-bundle card write without the field passes', async () => {
    await assertSucceeds(setDoc(doc(kidDb(), path('mul:3x4')), oldWrite('mul:3x4')));
    await assertSucceeds(setDoc(doc(parentDb(), path('mul:3x5')), oldWrite('mul:3x5')));
  });

  it('a write with 2500 passes, from a kid token and as a batch the way saveCards writes it', async () => {
    await assertSucceeds(setDoc(doc(kidDb(), path('mul:3x4')), fullCard('mul:3x4', 2500)));
    const db = kidDb();
    const batch = writeBatch(db);
    for (const id of ['mul:6x7', 'mul:7x8']) batch.set(doc(db, path(id)), fullCard(id, 1500));
    await assertSucceeds(batch.commit());
  });

  it('accepts both ends of the range, 1000 and 4000', async () => {
    await assertSucceeds(setDoc(doc(kidDb(), path('mul:1x1')), fullCard('mul:1x1', 1000)));
    await assertSucceeds(setDoc(doc(kidDb(), path('mul:2x2')), fullCard('mul:2x2', 4000)));
  });

  it.each([
    ['500 (under the range)', 500],
    ['999', 999],
    ['4001', 4001],
    ['5000 (over the range)', 5000],
    ['a string', '2500'],
    ['a decimal', 2500.5],
    ['null', null],
    ['a list', [2500]],
  ])('refuses %s from a kid token and from the parent', async (_name, value) => {
    await assertFails(setDoc(doc(kidDb(), path('mul:3x4')), fullCard('mul:3x4', value)));
    await assertFails(setDoc(doc(parentDb(), path('mul:3x4')), fullCard('mul:3x4', value)));
  });

  it('refuses one bad card in a batch, so a whole save is refused', async () => {
    const db = kidDb();
    const batch = writeBatch(db);
    batch.set(doc(db, path('mul:6x7')), fullCard('mul:6x7', 2000));
    batch.set(doc(db, path('mul:7x8')), fullCard('mul:7x8', 5000));
    await assertFails(batch.commit());
  });
});
