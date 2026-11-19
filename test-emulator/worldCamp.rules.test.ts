import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// families/{uid}/kids/{kidId}/world/camp: the tent and flags a kid places. Owner-only like world/main. placed is a list of at most 10
// entries (1 tent plus 3 flags in each of 3 lands), each { region, kind, x, y } with whole-number x 0..39 and y 0..29. world/main keeps its
// 10 fields. Every refusal test first makes a good write, so each test also fails on a rules file with no world/camp match. Made-up ids.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-camp-parent';
const OTHER_FAM = 'other-camp-parent';
const KID = 'kidcampaaaa';
const SIB = 'kidcampbbbb';

let env: RulesTestEnvironment;
const kidDb = (kidId = KID, fam = FAM) => env.authenticatedContext(`kid_${kidId}`, { role: 'kid', familyUid: fam, kidId }).firestore();
const parentDb = (uid = FAM) => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
const camp = (db: ReturnType<typeof kidDb>, kidId = KID, fam = FAM) => doc(db, `families/${fam}/kids/${kidId}/world/camp`);
const main = (db: ReturnType<typeof kidDb>, kidId = KID, fam = FAM) => doc(db, `families/${fam}/kids/${kidId}/world/main`);

type Item = { region: string; kind: string; x: unknown; y: unknown };
const tent = (x = 5, y = 5, region = 'meadow'): Item => ({ region, kind: 'tent', x, y });
const flag = (x: unknown, y: unknown, region = 'meadow'): Item => ({ region, kind: 'flag', x, y });
const doc_ = (placed: unknown[], extra: object = {}) => ({ placed, version: 1, updatedAt: 1000, ...extra });
const flags = (n: number, region: string) => Array.from({ length: n }, (_, i) => flag(2 + i, 3, region));

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

describe('world/camp: who may write', () => {
  it('the owner kid creates, reads and updates it', async () => {
    const db = kidDb();
    await assertSucceeds(setDoc(camp(db), doc_([tent(), flag(8, 9)])));
    await assertSucceeds(getDoc(camp(db)));
    await assertSucceeds(updateDoc(camp(db), { placed: [tent(6, 6)], updatedAt: 2000 }));
    expect(((await getDoc(camp(parentDb()))).data() as { placed: Item[] }).placed[0]!.x).toBe(6);
  });
  it('the parent of the family reads and writes it', async () => {
    await assertSucceeds(setDoc(camp(parentDb()), doc_([tent()])));
    await assertSucceeds(getDoc(camp(parentDb())));
    await assertSucceeds(updateDoc(camp(parentDb()), { placed: [], updatedAt: 3000 }));
  });
  it('a sibling’s kid token is refused, for read and write', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([tent()])));
    await assertFails(getDoc(camp(kidDb(SIB))));
    await assertFails(setDoc(camp(kidDb(SIB)), doc_([tent()])));
    await assertFails(setDoc(camp(kidDb(SIB), KID), doc_([tent()])));
  });
  it('another family and an anonymous client are refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([tent()])));
    await assertFails(getDoc(camp(parentDb(OTHER_FAM), KID, FAM)));
    await assertFails(setDoc(camp(parentDb(OTHER_FAM), KID, FAM), doc_([tent()])));
    await assertFails(setDoc(camp(kidDb(KID, OTHER_FAM), KID, FAM), doc_([tent()])));
    await assertFails(getDoc(camp(env.unauthenticatedContext().firestore())));
    await assertFails(setDoc(camp(env.unauthenticatedContext().firestore()), doc_([tent()])));
  });
  it('only the parent deletes it', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([tent()])));
    await assertFails(deleteDoc(camp(kidDb())));
    await assertSucceeds(deleteDoc(camp(parentDb())));
  });
});

describe('world/camp: the shape', () => {
  it('3 flags in one land pass, a 4th is refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_(flags(3, 'forest'))));
    await assertFails(setDoc(camp(kidDb()), doc_(flags(4, 'forest'))));
    await assertFails(setDoc(camp(parentDb()), doc_(flags(4, 'meadow'))));
  });
  it('3 flags in each of the 3 lands plus 1 tent (10 entries) pass, an 11th is refused', async () => {
    const full = [tent(), ...flags(3, 'castle'), ...flags(3, 'forest'), ...flags(3, 'meadow')];
    expect(full).toHaveLength(10);
    await assertSucceeds(setDoc(camp(kidDb()), doc_(full)));
    await assertFails(setDoc(camp(kidDb()), doc_([...full, flag(20, 20)])));
  });
  it('flags out of region order, or a tent after slot 0, are refused (the one order the app writes)', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([tent(), flag(1, 1, 'castle'), flag(2, 2, 'meadow')])));
    await assertFails(setDoc(camp(kidDb()), doc_([flag(2, 2, 'meadow'), flag(1, 1, 'castle')])));
    await assertFails(setDoc(camp(kidDb()), doc_([flag(1, 1, 'castle'), tent()])));
  });
  it('a 4th flag is refused wherever the tent sits in the list', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([tent(), ...flags(3, 'castle'), ...flags(3, 'meadow')])));
    await assertFails(setDoc(camp(kidDb()), doc_([tent(), ...flags(3, 'castle'), ...flags(4, 'meadow')])));
    await assertFails(setDoc(camp(kidDb()), doc_([...flags(4, 'castle')])));
    await assertFails(setDoc(camp(kidDb()), doc_([tent(), ...flags(4, 'castle')])));
  });
  it('a 2nd tent is refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([tent(1, 1)])));
    await assertFails(setDoc(camp(kidDb()), doc_([tent(1, 1), tent(2, 2, 'forest')])));
  });
  it('an out-of-bounds x or y is refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([flag(39, 29)])));
    await assertFails(setDoc(camp(kidDb()), doc_([flag(40, 3)])));
    await assertFails(setDoc(camp(kidDb()), doc_([flag(3, 30)])));
    await assertFails(setDoc(camp(kidDb()), doc_([flag(-1, 3)])));
    await assertFails(setDoc(camp(kidDb()), doc_([flag(3, -1)])));
  });
  it('a non-int x or y is refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([flag(3, 4)])));
    await assertFails(setDoc(camp(kidDb()), doc_([flag(3.5, 4)])));
    await assertFails(setDoc(camp(kidDb()), doc_([flag(3, 4.5)])));
    await assertFails(setDoc(camp(kidDb()), doc_([flag('3', 4)])));
    await assertFails(setDoc(camp(kidDb()), doc_([flag(3, null)])));
  });
  it('an unknown region or kind, a missing or extra entry field, and a non-list placed are refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([flag(3, 4)])));
    await assertFails(setDoc(camp(kidDb()), doc_([{ region: 'moon', kind: 'flag', x: 1, y: 1 }])));
    await assertFails(setDoc(camp(kidDb()), doc_([{ region: 'meadow', kind: 'castle', x: 1, y: 1 }])));
    await assertFails(setDoc(camp(kidDb()), doc_([{ region: 'meadow', kind: 'flag', x: 1 }])));
    await assertFails(setDoc(camp(kidDb()), doc_([{ ...flag(1, 1), color: 'red' }])));
    await assertFails(setDoc(camp(kidDb()), doc_(['flag'])));
    await assertFails(setDoc(camp(kidDb()), doc_({ 0: flag(1, 1) } as never)));
  });
  it('an extra or missing doc field, or a wrong version, is refused', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([])));
    await assertFails(setDoc(camp(kidDb()), doc_([], { gems: 50 })));
    await assertFails(setDoc(camp(kidDb()), { placed: [], version: 1 }));
    await assertFails(setDoc(camp(kidDb()), { version: 1, updatedAt: 1 }));
    await assertFails(setDoc(camp(kidDb()), doc_([], { version: 2 })));
  });
  it('no other doc id under world takes a write', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([])));
    await assertFails(setDoc(doc(kidDb(), `families/${FAM}/kids/${KID}/world/tent`), doc_([])));
  });
});

describe('world/main is unchanged', () => {
  it('an old-bundle world/main write passes, and the doc keeps its 10 fields', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([tent()])));
    expect(Object.keys(WORLD)).toHaveLength(10);
    await assertSucceeds(setDoc(main(kidDb()), WORLD));
    const { lastMode: _m, ...old } = WORLD;
    expect(Object.keys(old)).toHaveLength(9);
    await assertSucceeds(setDoc(main(kidDb()), old));
    expect(Object.keys((await getDoc(main(parentDb()))).data()!)).toHaveLength(9);
  });
  it('world/main refuses a placed field, so the camp cannot ride on it', async () => {
    await assertSucceeds(setDoc(camp(kidDb()), doc_([tent()])));
    await assertFails(setDoc(main(kidDb()), { ...WORLD, placed: [tent()] }));
    await assertFails(updateDoc(main(kidDb()), { placed: [tent()] }));
  });
  it('a camp write leaves world/main as it was', async () => {
    await assertSucceeds(setDoc(main(kidDb()), WORLD));
    await assertSucceeds(setDoc(camp(kidDb()), doc_([tent()])));
    expect((await getDoc(main(kidDb()))).data()).toEqual(WORLD);
  });
});
