import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { VersionGuard } from '../src/data/versionGate';
import { StaleBuildError } from '../src/version';
import type { SessionLog } from '../src/engine/models';

// Launch write ordering: with the minVersion check still pending, a game, card or session write must not
// reach Firestore. Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidlaunch01';

let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const kidPath = `families/${FAM}/kids/${KID}`;
const session = (id: string): SessionLog => ({ id, startedAt: 1, endedAt: 2, answered: 1, graded: 1, correct: 1, fast: 1, newLearned: 0, medianMs: 1000, xp: 20, gems: 2, bestCombo: 1, missed: [] });
const card = { id: 'add:1+1', attempts: 1 } as never;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-launch', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, kidPath), {
      id: KID, name: 'Launchkid', createdAt: 1, hasPin: true,
      settings: { sessionSize: 10, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: false, multidigit: false, fractions: false } },
      game: { xp: 100, gems: 10, streakDays: 1, lastPlayedDay: '2026-11-17', bestCombo: 3, heroes: ['knight'], hero: 'knight' },
    });
  });
});

/** What the server holds, read with the rules off. */
async function serverState() {
  let out: { xp: number; sessions: number; cards: number } | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    out = {
      xp: ((await getDoc(doc(db, kidPath))).data() as { game: { xp: number } }).game.xp,
      sessions: (await getDocs(collection(db, `${kidPath}/sessions`))).size,
      cards: (await getDocs(collection(db, `${kidPath}/cards`))).size,
    };
  });
  return out!;
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs the three writers a run uses while minVersion is unread, then releases the read. */
async function launchWrites(which: Array<'applyGameDelta' | 'saveCards' | 'addSession'>) {
  const events: string[] = [];
  let release!: (v: unknown) => void;
  const guard = new VersionGuard(null, {
    build: 100,
    read: () => {
      events.push('guard:read-start');
      return new Promise((res) => (release = res)).then((v) => {
        events.push('guard:resolved');
        return v;
      });
    },
  });
  const repo = new FirestoreRepo(kidDb(), FAM, guard);
  const fire: Record<string, () => Promise<void>> = {
    applyGameDelta: () => repo.applyGameDelta(KID, { xp: 20, gems: 2, playedAt: 1 }, { session: session('s1') }).then(() => void events.push('write:applyGameDelta')),
    saveCards: () => repo.saveCards(KID, [card]).then(() => void events.push('write:saveCards')),
    addSession: () => repo.addSession(KID, session('s2')).then(() => void events.push('write:addSession')),
  };
  const writes = which.map((w) => fire[w]!());
  await pause(500);
  const before = { events: [...events], server: await serverState() };
  release(50); // minVersion 50, this build is 100: not stale
  await Promise.all(writes);
  return { before, events, server: await serverState() };
}

describe('launch write ordering against the minVersion gate', () => {
  for (const w of ['applyGameDelta', 'saveCards', 'addSession'] as const) {
    it(`${w} on its own: nothing is written until the check resolves, then it lands`, async () => {
      const r = await launchWrites([w]);
      expect(r.before.events).toEqual(['guard:read-start']);
      expect(r.before.server).toEqual({ xp: 100, sessions: 0, cards: 0 });
      expect(r.events.indexOf('guard:resolved')).toBeLessThan(r.events.findIndex((e) => e.startsWith('write:')));
      expect(r.server).not.toEqual({ xp: 100, sessions: 0, cards: 0 });
    });
  }

  // KNOWN GAP (src/data/versionGate.ts, check()): refresh() stamps lastTry before its read returns, so a second
  // writer that calls check() while the first read is still in flight sees a fresh lastTry, skips the read and
  // writes at once. Only the first caller waits. This test states the wanted behaviour and is marked as failing;
  // it turns red when the gap is fixed, which is the signal to drop `.fails`.
  it.fails('three writers fired together: none writes before the one check resolves', async () => {
    const r = await launchWrites(['applyGameDelta', 'saveCards', 'addSession']);
    expect(r.before.events.some((e) => e.startsWith('write:'))).toBe(false);
    expect(r.before.server).toEqual({ xp: 100, sessions: 0, cards: 0 });
  });

  it('a stale build (minVersion above this build) writes nothing at all', async () => {
    const guard = new VersionGuard(null, { build: 100, read: async () => 200 });
    const repo = new FirestoreRepo(kidDb(), FAM, guard);
    await expect(repo.applyGameDelta(KID, { xp: 20 }, { session: session('s1') })).rejects.toBeInstanceOf(StaleBuildError);
    await expect(repo.saveCards(KID, [card])).rejects.toBeInstanceOf(StaleBuildError);
    await expect(repo.addSession(KID, session('s2'))).rejects.toBeInstanceOf(StaleBuildError);
    expect(await serverState()).toEqual({ xp: 100, sessions: 0, cards: 0 });
  });

  it('an unreadable minVersion fails open after the timeout: the write waits for it, then lands', async () => {
    const guard = new VersionGuard(null, { build: 100, timeoutMs: 300, read: () => new Promise(() => {}) });
    const repo = new FirestoreRepo(kidDb(), FAM, guard);
    const done = repo.addSession(KID, session('s3'));
    await pause(150);
    expect((await serverState()).sessions).toBe(0); // still waiting on the check
    await done;
    expect((await serverState()).sessions).toBe(1);
  });
});
