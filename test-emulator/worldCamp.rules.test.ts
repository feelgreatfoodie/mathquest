import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The camp: one doc per land, families/{uid}/kids/{kidId}/world/camp_meadow, camp_forest and camp_castle. Owner-only like world/main. placed is a
// list of at most 4 entries (at most 1 tent and 3 flags), each { region, kind, x, y }: region is the land of the doc, x a whole number 0..39, y
// 0..29. world/main keeps its 10 fields. Every refusal test first makes a good write, so each test also fails on a rules file with no camp match.
// A single doc of 12 entries is past the 1000-expression limit (7 fit), which is why the camp is one doc per land. Made-up ids.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-camp-parent';
const OTHER_FAM = 'other-camp-parent';
const KID = 'kidcampaaaa';
const SIB = 'kidcampbbbb';

let env: RulesTestEnvironment;
const kidDb = (kidId = KID, fam = FAM) => env.authenticatedContext(`kid_${kidId}`, { role: 'kid', familyUid: fam, kidId }).firestore();
const parentDb = (uid = FAM) => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
const camp = (db: ReturnType<typeof kidDb>, land = 'meadow', kidId = KID, fam = FAM) => doc(db, `families/${fam}/kids/${kidId}/world/camp_${land}`);
const main = (db: ReturnType<typeof kidDb>, kidId = KID, fam = FAM) => doc(db, `families/${fam}/kids/${kidId}/world/main`);

type Item = Record<string, unknown>;
const tent = (x: unknown = 5, y: unknown = 5, region = 'meadow'): Item => ({ region, kind: 'tent', x, y });
const flag = (x: unknown, y: unknown, region = 'meadow'): Item => ({ region, kind: 'flag', x, y });
const docOf = (placed: unknown, extra: object = {}) => ({ placed, version: 1, updatedAt: 1000, ...extra });
const flags = (n: number, region = 'meadow') => Array.from({ length: n }, (_, i) => flag(2 + i, 3, region));

const WORLD = { region: 'meadow', x: 4, y: 7, facing: 'down', openedChests: ['#3'], bossesDefeated: [] as string[], keys: 0, version: 1, updatedAt: 1000, lastMode: 'overworld' };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-camp', firestore: { rules: RULES } });
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

describe('camp docs: who may write', () => {
  it('the owner kid creates, reads and updates the doc of each land', async () => {
    const db = kidDb();
    for (const land of ['meadow', 'forest', 'castle']) {
      await assertSucceeds(setDoc(camp(db, land), docOf([tent(5, 5, land), flag(8, 9, land)])));
      await assertSucceeds(getDoc(camp(db, land)));
    }
    await assertSucceeds(updateDoc(camp(db), { placed: [tent(6, 6)], updatedAt: 2000 }));
    expect(((await getDoc(camp(parentDb()))).data() as { placed: Item[] }).placed[0]!.x).toBe(6);
  });
  it('the parent of the family reads and writes it', async () => {
    await assertSucceeds(setDoc(camp(parentDb()), docOf([tent()])));
    await assertSucceeds(getDoc(camp(parentDb())));
    await assertSucceeds(updateDoc(camp(parentDb()), { placed: [], updatedAt: 3000 }));
  });
  it('a sibling’s kid token is refused, for read and write', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([tent()])));
    await assertFails(getDoc(camp(kidDb(SIB))));
    await assertFails(setDoc(camp(kidDb(SIB)), docOf([tent()])));
    await assertFails(setDoc(camp(kidDb(SIB), 'meadow', KID), docOf([tent()])));
  });
  it('another family and an anonymous client are refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([tent()])));
    await assertFails(getDoc(camp(parentDb(OTHER_FAM), 'meadow', KID, FAM)));
    await assertFails(setDoc(camp(parentDb(OTHER_FAM), 'meadow', KID, FAM), docOf([tent()])));
    await assertFails(setDoc(camp(kidDb(KID, OTHER_FAM), 'meadow', KID, FAM), docOf([tent()])));
    await assertFails(getDoc(camp(env.unauthenticatedContext().firestore())));
    await assertFails(setDoc(camp(env.unauthenticatedContext().firestore()), docOf([tent()])));
  });
  it('only the parent deletes it', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([tent()])));
    await assertFails(deleteDoc(camp(kidDb())));
    await assertSucceeds(deleteDoc(camp(parentDb())));
  });
  it('only the 3 land ids take a camp write', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([])));
    for (const id of ['camp', 'camp_moon', 'camp_Meadow', 'tent', 'camp_meadow2'])
      await assertFails(setDoc(doc(kidDb(), `families/${FAM}/kids/${KID}/world/${id}`), docOf([])));
  });
});

describe('camp docs: the list', () => {
  it('passes with 0, 1, 2, 3 and 4 entries (3 flags and a tent), in every land', async () => {
    for (const land of ['meadow', 'forest', 'castle']) {
      const lists = [[], [tent(5, 5, land)], [flag(1, 1, land), flag(2, 2, land)], flags(3, land), [...flags(3, land), tent(9, 9, land)]];
      for (const l of lists) await assertSucceeds(setDoc(camp(kidDb(), land), docOf(l)));
    }
  });
  it('the 4 entries may come in any order (the tent first, in the middle or last)', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([tent(9, 9), ...flags(3)])));
    await assertSucceeds(setDoc(camp(kidDb()), docOf([flag(1, 1), tent(9, 9), flag(2, 2), flag(3, 3)])));
    await assertSucceeds(setDoc(camp(kidDb()), docOf([...flags(3), tent(9, 9)])));
  });
  it('a 4th flag in a land is refused, with or without a tent in the list', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf(flags(3))));
    await assertFails(setDoc(camp(kidDb()), docOf(flags(4))));
    await assertFails(setDoc(camp(parentDb()), docOf(flags(4, 'meadow'))));
    await assertFails(setDoc(camp(kidDb(), 'forest'), docOf(flags(4, 'forest'))));
    await assertFails(setDoc(camp(kidDb()), docOf(flags(5))));
  });
  it('a 2nd tent in a land is refused, and 3 tents in 3 lands pass', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([tent(1, 1)])));
    await assertFails(setDoc(camp(kidDb()), docOf([tent(1, 1), tent(2, 2)])));
    await assertFails(setDoc(camp(kidDb()), docOf([tent(1, 1), flag(3, 3), tent(2, 2)])));
    for (const land of ['meadow', 'forest', 'castle']) await assertSucceeds(setDoc(camp(kidDb(), land), docOf([tent(4, 4, land)])));
  });
  it('an entry of another land is refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb(), 'forest'), docOf([flag(1, 1, 'forest')])));
    await assertFails(setDoc(camp(kidDb(), 'forest'), docOf([flag(1, 1, 'meadow')])));
    await assertFails(setDoc(camp(kidDb(), 'meadow'), docOf([flag(1, 1), flag(2, 2, 'castle')])));
    await assertFails(setDoc(camp(kidDb(), 'castle'), docOf([flag(1, 1, 'moon')])));
  });
  it('a 5th entry is refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([...flags(3), tent(9, 9)])));
    await assertFails(setDoc(camp(kidDb()), docOf([...flags(3), tent(9, 9), flag(7, 7)])));
  });
  it('an out-of-bounds x or y is refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([flag(39, 29)])));
    await assertFails(setDoc(camp(kidDb()), docOf([flag(40, 3)])));
    await assertFails(setDoc(camp(kidDb()), docOf([flag(3, 30)])));
    await assertFails(setDoc(camp(kidDb()), docOf([flag(-1, 3)])));
    await assertFails(setDoc(camp(kidDb()), docOf([flag(3, -1)])));
    await assertFails(setDoc(camp(kidDb()), docOf([flag(1, 1), flag(2, 2), flag(3, 4), flag(100, 3)])));
  });
  it('a non-int x or y is refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([flag(3, 4)])));
    await assertFails(setDoc(camp(kidDb()), docOf([flag(3.5, 4)])));
    await assertFails(setDoc(camp(kidDb()), docOf([flag(3, 4.5)])));
    await assertFails(setDoc(camp(kidDb()), docOf([flag('3', 4)])));
    await assertFails(setDoc(camp(kidDb()), docOf([flag(3, null)])));
  });
  it('a tent with no region is refused, as is any entry with a missing, extra or wrong-typed field', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([tent()])));
    await assertFails(setDoc(camp(kidDb()), docOf([{ kind: 'tent', x: 5, y: 5 }])));
    await assertFails(setDoc(camp(kidDb()), docOf([flag(1, 1), { kind: 'tent', x: 5, y: 5 }])));
    await assertFails(setDoc(camp(kidDb()), docOf([flag(1, 1), flag(2, 2), { kind: 'tent', x: 5, y: 5 }])));
    await assertFails(setDoc(camp(kidDb()), docOf([{ region: 'meadow', x: 1, y: 1 }])));
    await assertFails(setDoc(camp(kidDb()), docOf([{ region: 'meadow', kind: 'flag', x: 1 }])));
    await assertFails(setDoc(camp(kidDb()), docOf([{ ...flag(1, 1), color: 'red' }])));
    await assertFails(setDoc(camp(kidDb()), docOf([{ region: 'meadow', kind: 'banner', x: 1, y: 1 }])));
    await assertFails(setDoc(camp(kidDb()), docOf(['flag'])));
    await assertFails(setDoc(camp(kidDb()), docOf([null])));
  });
  it('placed that is not a list, or is missing, is refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([])));
    await assertFails(setDoc(camp(kidDb()), docOf({ 0: flag(1, 1) })));
    await assertFails(setDoc(camp(kidDb()), docOf('flag')));
    await assertFails(setDoc(camp(kidDb()), { version: 1, updatedAt: 1 }));
  });
  it('an extra or missing doc field, or a wrong version, is refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([])));
    await assertFails(setDoc(camp(kidDb()), docOf([], { gems: 50 })));
    await assertFails(setDoc(camp(kidDb()), { placed: [], version: 1 }));
    await assertFails(setDoc(camp(kidDb()), docOf([], { version: 2 })));
    await assertFails(setDoc(camp(kidDb()), docOf([], { updatedAt: 'now' })));
  });
});

describe('world/main is unchanged', () => {
  it('an old-bundle world/main write passes, and the doc keeps its 10 fields', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([tent()])));
    expect(Object.keys(WORLD)).toHaveLength(10);
    await assertSucceeds(setDoc(main(kidDb()), WORLD));
    const { lastMode: _m, ...old } = WORLD;
    expect(Object.keys(old)).toHaveLength(9);
    await assertSucceeds(setDoc(main(kidDb()), old));
    expect(Object.keys((await getDoc(main(parentDb()))).data()!)).toHaveLength(9);
  });
  it('world/main refuses a placed field, so the camp cannot ride on it', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), docOf([tent()])));
    await assertFails(setDoc(main(kidDb()), { ...WORLD, placed: [tent()] }));
    await assertFails(updateDoc(main(kidDb()), { placed: [tent()] }));
  });
  it('a camp write leaves world/main as it was', async () => {
    await assertSucceeds(setDoc(main(kidDb()), WORLD));
    await assertSucceeds(setDoc(camp(kidDb()), docOf([tent()])));
    expect((await getDoc(main(kidDb()))).data()).toEqual(WORLD);
  });
});
