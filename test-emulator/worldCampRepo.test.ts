import { readFileSync } from 'node:fs';
import { assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { campReducer, fromCampDoc, newCamp, canPlaceAt, type Placed } from '../src/game/overworld/camp';
import { MAPS, REGION_IDS } from '../src/game/overworld/maps';

// FirestoreRepo.saveCamp writes one land's doc under the kid token and loadCamp joins the three. The rules accept every write the app makes,
// for a full camp (a tent and 3 flags in each land). Names and ids are made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidcamprepo01';
let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-camp-repo', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(ctx.firestore(), `families/${FAM}/kids/${KID}`), { id: KID, name: 'Campkid', createdAt: 1, hasPin: true, settings: {}, game: { xp: 0, gems: 0, heroes: ['knight'], hero: 'knight' } });
  });
});

function fullCamp() {
  let c = newCamp(1);
  for (const r of REGION_IDS) {
    const free: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < MAPS[r].h; y++) for (let x = 0; x < MAPS[r].w; x++) if (canPlaceAt(MAPS[r], x, y)) free.push({ x, y });
    const items: Placed[] = [{ region: r, kind: 'tent', ...free[0]! }, ...[5, 10, 15].map((i) => ({ region: r, kind: 'flag' as const, ...free[i]! }))];
    for (const item of items) c = campReducer(c, { t: 'place', item }, 2);
  }
  return c;
}

describe('FirestoreRepo camp', () => {
  it('loadCamp is null before the first save', async () => {
    expect(await new FirestoreRepo(kidDb(), FAM).loadCamp(KID)).toBeNull();
  });
  it('a full camp (12 items) saves as 3 land docs the rules accept, and loads back whole', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const c = fullCamp();
    expect(c.placed).toHaveLength(12);
    for (const r of REGION_IDS) await assertSucceeds(repo.saveCamp(KID, c, r));
    const back = fromCampDoc(await repo.loadCamp(KID), 9);
    expect(back.placed).toHaveLength(12);
    for (const p of c.placed) expect(back.placed).toContainEqual(p);
  });
  it('a land doc holds only that land’s items, and world/main is not written', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    await repo.saveCamp(KID, fullCamp(), 'forest');
    const d = (await getDoc(doc(kidDb(), `families/${FAM}/kids/${KID}/world/camp_forest`))).data() as { placed: Placed[] };
    expect(d.placed).toHaveLength(4);
    expect(d.placed.every((p) => p.region === 'forest')).toBe(true);
    expect((await getDoc(doc(kidDb(), `families/${FAM}/kids/${KID}/world/camp_meadow`))).exists()).toBe(false);
    expect((await getDoc(doc(kidDb(), `families/${FAM}/kids/${KID}/world/main`))).exists()).toBe(false);
  });
});
