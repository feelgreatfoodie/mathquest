import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { cardLevel } from '../src/engine/mastery';
import { normalizeKid, type Kid } from '../src/engine/models';
import { makeKid } from '../src/engine/newKid';
import { SessionRunner, planSession } from '../src/engine/session';
import { availableCards } from '../src/engine/mastery';
import { mulberry32 } from '../src/engine/problems';
import { addCards, subCards } from '../src/engine/modules/early';

// Names, ids and addresses are made up. RULES_FILE lets the suite run against another rules file.
// The rules are NOT changed for modules: these tests prove the existing rules already cover them.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-modules-parent';
const KID = 'kidmodulesaaaa000001';
const parentCtx = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true });
const kidCtx = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID });

let env: RulesTestEnvironment;
let stored: Kid;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  // A pre-reader doc exactly as the app writes it for a new Pre-reader player.
  stored = { ...makeKid('Pip', 'prereader'), id: KID, hasPin: true };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}`), stored);
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
  });
});

const cardPath = (id: string) => `families/${FAM}/kids/${KID}/cards/${id}`;
const card = (id: string) => ({ id, attempts: 1, correct: 1, recentMs: [1200], lastRating: 3, updatedAt: 1, fsrs: { due: 1, stability: 1, difficulty: 1, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: 1 } });

describe('card ids with + and - (add:a+b, sub:a-b)', () => {
  it('lets a kid token write and read every add10 and sub10 card, doc id equal to the id field', async () => {
    const db = kidCtx().firestore();
    for (const c of [...addCards, ...subCards]) {
      await assertSucceeds(setDoc(doc(db, cardPath(c.id)), card(c.id)));
    }
    const snap = await assertSucceeds(getDoc(doc(db, cardPath('add:2+3'))));
    expect(snap.data()?.id).toBe('add:2+3');
    expect((await getDoc(doc(db, cardPath('sub:10-10')))).exists()).toBe(true);
  });

  it('still refuses a card whose doc id differs from its id field', async () => {
    const db = kidCtx().firestore();
    await assertFails(setDoc(doc(db, cardPath('add:2+3')), card('add:3+2')));
  });

  it('keeps a kid out of another kid’s add10 cards', async () => {
    const db = env.authenticatedContext('kid_other', { role: 'kid', familyUid: FAM, kidId: 'kidotherbbbb' }).firestore();
    await assertFails(setDoc(doc(db, cardPath('add:2+3')), card('add:2+3')));
  });
});

describe('parent settings fields', () => {
  it('lets a parent write settings.learner and settings.modules', async () => {
    const db = parentCtx().firestore();
    const ref = doc(db, `families/${FAM}/kids/${KID}`);
    await assertSucceeds(updateDoc(ref, { 'settings.learner': 'reader' }));
    await assertSucceeds(updateDoc(ref, { 'settings.modules': { add10: true, sub10: true, facts: false } }));
    await assertSucceeds(setDoc(ref, { ...stored, settings: { ...stored.settings, learner: 'prereader', modules: { add10: true, sub10: true } } }));
    expect(((await getDoc(ref)).data() as Kid).settings.modules).toEqual({ add10: true, sub10: true });
  });

  it('refuses a kid token changing settings.learner or settings.modules', async () => {
    const db = kidCtx().firestore();
    const ref = doc(db, `families/${FAM}/kids/${KID}`);
    await assertFails(updateDoc(ref, { 'settings.learner': 'reader' }));
    await assertFails(updateDoc(ref, { 'settings.modules': { add10: false, facts: true } }));
  });
});

describe('smallDoc: every doc stays under 20 top-level fields', () => {
  it('a new Pre-reader kid doc has well under 20 top-level fields, and the settings fields are nested', () => {
    const k = makeKid('Zed', 'prereader');
    expect(Object.keys(k).length).toBeLessThan(20);
    expect(Object.keys(k)).toEqual(['id', 'name', 'createdAt', 'settings', 'game']);
    expect(Object.keys(k.settings).length).toBeLessThan(20);
    expect(Object.keys(stored).length).toBeLessThan(20);
  });

  it('a parent can create the Pre-reader kid doc, and a kid doc with 20 top-level fields is still refused', async () => {
    const db = parentCtx().firestore();
    const k = makeKid('Zed', 'prereader');
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/${k.id}`), k));
    const wide = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`x${i}`, i]));
    await assertFails(setDoc(doc(db, `families/${FAM}/kids/${k.id}`), { ...k, ...wide }));
  });
});

describe('a whole pre-reader run, written by the kid token through the real repo', () => {
  it('loads cards, plays 10 questions, and saves cards, the session and the kid doc', async () => {
    const db = kidCtx().firestore() as unknown as Firestore;
    const repo = new FirestoreRepo(db, FAM);

    // The kid doc round-trips through normalizeKid without touching settings: a run may only change `game`.
    const read = (await repo.getKid(KID))!;
    expect(read.settings).toEqual(stored.settings);
    expect(normalizeKid(stored).settings).toEqual(stored.settings);

    const cards = await repo.loadCards(KID);
    const plan = planSession({ cards, available: availableCards(cards, read.settings), now: Date.now(), size: 10, maxNew: 4, rng: mulberry32(4) });
    expect(plan).toHaveLength(10);
    const run = new SessionRunner(plan, cards, mulberry32(5), Date.now, read.settings);
    let n = 0;
    while (!run.done() && n++ < 40) {
      const e = run.current()!;
      if (e.kind === 'teach') { run.acknowledge(); continue; }
      const ans = e.problem.answer.kind === 'int' ? e.problem.answer.value : 0;
      const fb = run.answer({ kind: 'int', value: n === 2 ? ans + 1 : ans }, 2500);
      await assertSucceeds(repo.saveCards(KID, [run.getCard(e.cardId)!]));
      void fb;
      run.advance();
    }
    const s = run.summary();
    await assertSucceeds(repo.saveCards(KID, run.changedCards()));
    await assertSucceeds(repo.addSession(KID, { id: 'run1', startedAt: 1, endedAt: 2, answered: s.answered, graded: s.graded, correct: s.correct, fast: s.fast, newLearned: s.newLearned, medianMs: s.medianMs, xp: s.xp, gems: s.gems, bestCombo: s.bestCombo, missed: s.missed }));
    // The run's game write is a field-level update of `game` only (affectedKeys must be only ['game']).
    const game = await assertSucceeds(repo.applyGameDelta(KID, { xp: s.xp, gems: s.gems, bestCombo: s.bestCombo, playedAt: Date.parse('2026-11-17T12:00:00Z') }));
    expect(game.xp).toBe(read.game.xp + s.xp);
    const updated: Kid = { ...read, game };

    const back = await repo.loadCards(KID);
    expect(Object.keys(back).every((id) => /^add:\d\+\d$/.test(id))).toBe(true);
    expect(Object.keys(back).length).toBeGreaterThanOrEqual(10);
    expect(cardLevel(back[Object.keys(back)[0]!], 3500, 3)).toBeGreaterThanOrEqual(0);

    // And a changed settings block in the same write is refused, so the check above is not vacuous.
    await assertFails(setDoc(doc(db, `families/${FAM}/kids/${KID}`), { ...updated, settings: { ...updated.settings, learner: 'reader' } }));
  });
});
