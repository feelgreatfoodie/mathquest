import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { VersionGuard } from '../src/data/versionGate';
import { availableCards } from '../src/engine/mastery';
import { makeKid } from '../src/engine/newKid';
import { mulberry32 } from '../src/engine/problems';
import { planSession, SessionRunner } from '../src/engine/session';
import { saveRun } from '../src/ui/runShared';

// minVersion is bumped while a run is open (a deploy lands). The run must still save: the server rules are the
// guard, the client never blocks a write on minVersion.
const FAM = 'fam-parent-uid';
const KID = 'kidsavefirst01';
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-save-first', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
afterAll(async () => env.cleanup());

const kid = { ...makeKid('Savekid', 'prereader'), id: KID };
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}`), kid);
  });
});

function playedRun() {
  const cards = {};
  const plan = planSession({ cards, available: availableCards(cards, kid.settings), now: Date.now(), size: 5, maxNew: 5, rng: mulberry32(1) });
  const run = new SessionRunner(plan, cards, mulberry32(2), Date.now, kid.settings);
  let n = 0;
  while (!run.done() && n++ < 40) {
    const e = run.current()!;
    if (e.kind === 'teach') {
      run.acknowledge();
      continue;
    }
    const a = e.problem.answer;
    run.answer(a.kind === 'int' ? { kind: 'int', value: a.value } : { kind: 'int', value: 0 }, 1200);
    run.advance();
  }
  return run;
}

describe('save first', () => {
  it('minVersion bumped during a run: the run still saves', async () => {
    let min = 50; // this build is 100: current when the run starts
    const guard = new VersionGuard(null, { build: 100, maxAgeMs: 0, read: async () => min });
    await guard.refresh();
    expect(guard.stale).toBe(false);
    const db = env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
    const repo = new FirestoreRepo(db, FAM, guard);
    const run = playedRun();
    min = 200; // a deploy lands mid-run
    await guard.refresh();
    expect(guard.stale).toBe(true);
    const saved = (await saveRun(repo, kid, run, Date.now() - 1000))!;
    expect(saved.saved).toBe(true);
    const stored = (await getDoc(doc(db, `families/${FAM}/kids/${KID}`))).data() as { game: { xp: number } };
    expect(stored.game.xp).toBe(run.summary().xp);
    expect((await getDocs(collection(db, `families/${FAM}/kids/${KID}/sessions`))).size).toBe(1);
    expect((await getDocs(collection(db, `families/${FAM}/kids/${KID}/cards`))).size).toBeGreaterThan(0);
  });
});
