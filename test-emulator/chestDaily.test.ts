import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { dayKey } from '../src/engine/game';

// A chest pays at most once per local day, across trips and devices, through the real repo and the real rules. No rules change:
// chestsOpened and chestsDay ride in `game`, which a kid may write, and the +10 gems cap still holds. Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidchestday01';
const NOW = Date.now();
const NEXT = NOW + 24 * 3600 * 1000;
const SPOT = 'meadow:17,5';
const settings = { gemSpeed: 1, gemFullRate: 25 };

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const kidRef = (db: ReturnType<typeof parentDb>) => doc(db, `families/${FAM}/kids/${KID}`);
const GAME = { xp: 5, gems: 100, streakDays: 3, lastPlayedDay: '2026-11-16', bestCombo: 12, heroes: ['knight'], hero: 'knight' };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-chestday', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), { id: KID, name: 'Testkid', createdAt: 1, hasPin: true, settings: { sessionSize: 30, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 1, tracks: { facts: true, multidigit: false, fractions: false } }, game: GAME });
  });
});
const stored = async () => (await getDoc(kidRef(parentDb()))).data() as { game: Record<string, unknown> };
const grant = (spot: string, at: number) => ({ gemGrant: { base: 2, learner: 'reader' as const, settings, spot }, playedAt: at });

describe('a chest pays once a day', () => {
  it('two devices open the same chest: the first pays 2, the second pays 0, and the day list holds the spot', async () => {
    const a = new FirestoreRepo(kidDb(), FAM);
    const b = new FirestoreRepo(kidDb(), FAM);
    await a.applyGameDelta(KID, grant(SPOT, NOW));
    await b.applyGameDelta(KID, grant(SPOT, NOW + 5));
    expect((await stored()).game).toMatchObject({ gems: 102, gemsEarnedToday: 2, chestsOpened: [SPOT], chestsDay: dayKey(NOW) });
  });
  it('the next local day pays the same spot again and the list restarts', async () => {
    const a = new FirestoreRepo(kidDb(), FAM);
    await a.applyGameDelta(KID, grant(SPOT, NOW));
    await a.applyGameDelta(KID, grant(SPOT, NEXT));
    expect((await stored()).game).toMatchObject({ gems: 104, chestsOpened: [SPOT], chestsDay: dayKey(NEXT) });
  });
});
