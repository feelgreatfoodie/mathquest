import { readFileSync } from 'node:fs';
import { assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { GameDeltaError, dayKey } from '../src/engine/game';
import { tipDelta } from '../src/game/shop/shopTip';
import { makeKid } from '../src/engine/newKid';

// Shop math tips through the real repo against the real rules. The cap of 3 a day is enforced inside applyGameDelta
// against the stored game, so a stale screen or a second device cannot pass it. No rules change: the new game fields
// ride in `game`, which a kid may write. Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidreader01';
const NOW = Date.now();
const TODAY = dayKey(NOW);

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
type Db = ReturnType<typeof parentDb>;
const kidRef = (db: Db) => doc(db, `families/${FAM}/kids/${KID}`);

const GAME = { xp: 5000, gems: 100, streakDays: 3, lastPlayedDay: '2026-11-16', bestCombo: 12, heroes: ['knight', 'wizard'], hero: 'wizard' };
const KID_DOC = {
  id: KID, name: 'Readkid', createdAt: 1, hasPin: true,
  settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true }, shop2: true, shopMath: true },
  game: GAME,
};

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-shoptips', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), KID_DOC);
  });
});
const stored = async () => (await getDoc(kidRef(parentDb()))).data() as { game: Record<string, unknown> };
const kid = { ...makeKid('Readkid'), id: KID };
const tip = (at = NOW) => tipDelta(kid, at);

describe('shop tips through the repo and the rules', () => {
  it('three tips pay 1 gem each and the 4th is refused with gems unmoved', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    for (let i = 1; i <= 3; i++) await repo.applyGameDelta(KID, tip(NOW + i));
    expect((await stored()).game).toMatchObject({ gems: 103, shopTipsToday: 3, shopTipsDay: TODAY });
    await expect(repo.applyGameDelta(KID, tip(NOW + 9))).rejects.toBeInstanceOf(GameDeltaError);
    expect((await stored()).game).toMatchObject({ gems: 103, shopTipsToday: 3 });
  });

  it('a second device that never saw the first three tips is refused too', async () => {
    const a = new FirestoreRepo(kidDb(), FAM);
    const b = new FirestoreRepo(kidDb(), FAM);
    for (let i = 1; i <= 3; i++) await a.applyGameDelta(KID, tip(NOW + i));
    await expect(b.applyGameDelta(KID, tip(NOW + 9))).rejects.toBeInstanceOf(GameDeltaError);
    expect((await stored()).game.gems).toBe(103);
  });

  it('the count starts again the next day', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    for (let i = 1; i <= 3; i++) await repo.applyGameDelta(KID, tip(NOW + i));
    await repo.applyGameDelta(KID, tip(NOW + 86_400_000));
    expect((await stored()).game).toMatchObject({ gems: 104, shopTipsToday: 1, shopTipsDay: dayKey(NOW + 86_400_000) });
  });

  it('a tip marker with no gem grant never writes', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    await expect(repo.applyGameDelta(KID, { shopTip: true, playedAt: NOW })).rejects.toBeInstanceOf(GameDeltaError);
    await expect(repo.applyGameDelta(KID, { shopTip: true, gems: 5, playedAt: NOW })).rejects.toBeInstanceOf(GameDeltaError);
    expect((await stored()).game).toMatchObject({ gems: 100 });
    expect((await stored()).game.shopTipsToday).toBeUndefined();
  });

  it('an old bundle round save (game written without the new fields) still passes the rules', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    await repo.applyGameDelta(KID, tip(NOW));
    // The old bundle writes the whole game map back, without shopTipsToday or shopTipsDay.
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: { ...GAME, gems: 105, xp: GAME.xp + 100 } }));
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: { ...GAME, gems: 105, xp: GAME.xp + 100, shopTipsToday: 1, shopTipsDay: TODAY } }));
  });
});
