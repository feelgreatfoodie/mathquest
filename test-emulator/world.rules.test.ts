import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// families/{uid}/kids/{kidId}/world/main: the Overworld save. Owner-only: the kid token for its own kidId and the
// parent of the family. A sibling's token, another family's parent and an anonymous client are refused. The doc has
// under 20 fields and openedChests holds at most 500 card ids. Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const OTHER_FAM = 'other-parent-uid';
const KID = 'kidaaaa';
const SIB = 'kidbbbb';

let env: RulesTestEnvironment;
const kidDb = (kidId = KID, fam = FAM) => env.authenticatedContext(`kid_${kidId}`, { role: 'kid', familyUid: fam, kidId }).firestore();
const parentDb = (uid = FAM) => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
const world = (db: ReturnType<typeof kidDb>, kidId = KID, fam = FAM, id = 'main') => doc(db, `families/${fam}/kids/${kidId}/world/${id}`);

const WORLD = { region: 'meadow', x: 4, y: 7, facing: 'down', openedChests: ['mul:2x3'], bossesDefeated: [] as string[], keys: 0, version: 1, updatedAt: 1000 };
const chests = (n: number) => Array.from({ length: n }, (_, i) => `mul:${i}x${i}`);

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-world', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const uid of [FAM, OTHER_FAM]) {
      await setDoc(doc(db, `families/${uid}`), { pinHash: 'x', createdAt: 1 });
      await setDoc(doc(db, `parents/${uid}`), { email: `${uid}@example.com`, createdAt: 1 });
    }
    for (const k of [KID, SIB]) {
      await setDoc(doc(db, `families/${FAM}/kids/${k}`), {
        id: k, name: `Kid ${k}`, createdAt: 1, hasPin: true,
        settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
        game: { lastPlayedDay: '2026-11-17', xp: 467, gems: 200, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1 },
      });
    }
  });
});

describe('world/main: who may write', () => {
  it('the kid token for its own kidId creates, reads and updates it', async () => {
    const db = kidDb();
    await assertSucceeds(setDoc(world(db), WORLD));
    await assertSucceeds(getDoc(world(db)));
    await assertSucceeds(updateDoc(world(db), { x: 5, updatedAt: 2000 }));
    expect(((await getDoc(world(parentDb()))).data() as { x: number }).x).toBe(5);
  });
  it('the parent of the family reads and writes it', async () => {
    await assertSucceeds(setDoc(world(parentDb()), WORLD));
    await assertSucceeds(getDoc(world(parentDb())));
    await assertSucceeds(updateDoc(world(parentDb()), { keys: 1 }));
  });
  it('a sibling’s kid token is refused, for read and write', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(world(ctx.firestore() as never), WORLD));
    await assertFails(getDoc(world(kidDb(SIB))));
    await assertFails(setDoc(world(kidDb(SIB)), WORLD));
    await assertFails(updateDoc(world(kidDb(SIB)), { x: 9 }));
  });
  it('a kid token that names another family is refused', async () => {
    await assertFails(setDoc(world(kidDb(KID, OTHER_FAM)), WORLD));
    await assertFails(getDoc(world(kidDb(KID, OTHER_FAM))));
  });
  it('another family’s parent and an anonymous client are refused', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(world(ctx.firestore() as never), WORLD));
    await assertFails(getDoc(world(parentDb(OTHER_FAM))));
    await assertFails(setDoc(world(parentDb(OTHER_FAM)), WORLD));
    await assertFails(getDoc(world(env.unauthenticatedContext().firestore())));
    await assertFails(setDoc(world(env.unauthenticatedContext().firestore()), WORLD));
  });
  it('a kid token of the same id in the wrong role is refused', async () => {
    const db = env.authenticatedContext('x', { role: 'parent', familyUid: FAM, kidId: KID }).firestore();
    await assertFails(setDoc(world(db), WORLD));
  });
  it('only the doc id main exists; another id is refused for the kid and the parent', async () => {
    await assertFails(setDoc(world(kidDb(), KID, FAM, 'other'), WORLD));
    await assertFails(setDoc(world(parentDb(), KID, FAM, 'other'), WORLD));
  });
  it('a kid cannot delete it; the parent can', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(world(ctx.firestore() as never), WORLD));
    await assertFails(deleteDoc(world(kidDb())));
    await assertSucceeds(deleteDoc(world(parentDb())));
  });
});

describe('world/main: what it may hold', () => {
  it('openedChests: 500 is accepted, 501 is refused', async () => {
    await assertSucceeds(setDoc(world(kidDb()), { ...WORLD, openedChests: chests(500) }));
    await assertFails(setDoc(world(kidDb()), { ...WORLD, openedChests: chests(501) }));
    await assertFails(updateDoc(world(kidDb()), { openedChests: chests(501) }));
    await assertFails(setDoc(world(parentDb()), { ...WORLD, openedChests: chests(501) }));
  });
  it('under 20 fields: 19 are accepted by count, 20 are refused', async () => {
    const pad = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, i]));
    await assertFails(setDoc(world(kidDb()), { ...WORLD, ...pad(12) })); // 20 fields
    await assertFails(setDoc(world(kidDb()), { ...WORLD, extra: 1 })); // an unknown field, even under 20
  });
  it('rejects a region that does not exist, a negative key count, junk types and a chest list that is not strings', async () => {
    await assertFails(setDoc(world(kidDb()), { ...WORLD, region: 'moon' }));
    await assertFails(setDoc(world(kidDb()), { ...WORLD, keys: -1 }));
    await assertFails(setDoc(world(kidDb()), { ...WORLD, keys: 'a' }));
    await assertFails(setDoc(world(kidDb()), { ...WORLD, openedChests: 'mul:2x3' }));
    await assertFails(setDoc(world(kidDb()), { ...WORLD, bossesDefeated: chests(40) }));
    await assertFails(setDoc(world(kidDb()), { ...WORLD, facing: 'sideways' }));
  });
  it('a kid write of the world touches no kid doc: the kid doc is unchanged', async () => {
    const before = (await getDoc(doc(parentDb(), `families/${FAM}/kids/${KID}`))).data();
    await assertSucceeds(setDoc(world(kidDb()), WORLD));
    expect((await getDoc(doc(parentDb(), `families/${FAM}/kids/${KID}`))).data()).toEqual(before);
  });
});

describe('the 1000-expression cap: worst case', () => {
  it('a full world (500 chests, 3 bosses, 9 fields) is accepted as a kid token and as the parent', async () => {
    const full = { ...WORLD, openedChests: chests(500), bossesDefeated: ['meadow', 'forest', 'castle'], keys: 3 };
    await assertSucceeds(setDoc(world(kidDb()), full));
    await assertSucceeds(updateDoc(world(kidDb()), { x: 6, openedChests: chests(500).reverse() }));
    await assertSucceeds(setDoc(world(parentDb()), full));
  });
  it('a run write (game only) still passes for a kid whose world is full', async () => {
    await assertSucceeds(setDoc(world(kidDb()), { ...WORLD, openedChests: chests(500) }));
    const ref = doc(kidDb(), `families/${FAM}/kids/${KID}`);
    await assertSucceeds(updateDoc(ref, { game: { lastPlayedDay: '2026-11-18', xp: 500, gems: 207, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 2 } }));
  });
});
