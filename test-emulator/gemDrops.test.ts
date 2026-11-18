import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { VersionGuard } from '../src/data/versionGate';

// Purchase-backed gem drops. A decrease of game.gems is legal only in the write that also creates exactly one
// purchases doc: its id is game.lastPurchaseId (new), its cost equals the drop, its heroId is the hero added.
// Every name, id and number is made up. RULES_FILE runs the suite against another rules file.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidaaaa';

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
type Db = ReturnType<typeof parentDb>;
const kidRef = (db: Db) => doc(db, `families/${FAM}/kids/${KID}`);
const purchaseRef = (db: Db, id: string) => doc(db, `families/${FAM}/kids/${KID}/purchases/${id}`);

const GAME = { lastPlayedDay: '2026-11-17', xp: 467, gems: 86, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1 };
const kidDoc = (game: Record<string, unknown> = {}) => ({
  id: KID, name: 'Testkid', createdAt: 1, hasPin: true,
  settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
  game: { ...GAME, ...game },
});
const entry = (id: string, heroId: string, cost: number) => ({ id, heroId, cost, at: 1000 });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-gemdrops', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seed(GAME);
});
async function seed(game: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), kidDoc(game));
  });
}

/** A write batch: the kid doc's new game, plus the listed purchases docs. */
function batch(db: Db, game: Record<string, unknown>, entries: Array<ReturnType<typeof entry>> = []) {
  const b = writeBatch(db);
  b.update(kidRef(db), { game: { ...GAME, ...game } });
  for (const e of entries) b.set(purchaseRef(db, e.id), e);
  return b.commit();
}
const buyWizard = (db: Db, over: { game?: Record<string, unknown>; entries?: Array<ReturnType<typeof entry>> } = {}) =>
  batch(db, { gems: 71, heroes: ['knight', 'wizard'], hero: 'wizard', lastPurchaseId: 'p1', ...(over.game ?? {}) }, over.entries ?? [entry('p1', 'wizard', 15)]);

describe('a gem drop with no matching purchase is denied', () => {
  for (const who of ['kid', 'parent'] as const) {
    const db = () => (who === 'kid' ? kidDb() : parentDb());
    it(`${who}: a 1-gem drop with xp unchanged (the stale-write shape)`, async () => {
      await assertFails(batch(db(), { gems: 85 }));
    });
    it(`${who}: a drop of exactly 100 (the old allowance)`, async () => {
      await seed({ gems: 250 });
      await assertFails(batch(db(), { gems: 150 }));
    });
    it(`${who}: a wipe to 0 (a drop of 86, inside the old 100 allowance)`, async () => {
      await assertFails(batch(db(), { gems: 0 }));
    });
    it(`${who}: a stale full-doc copy written back over a later balance`, async () => {
      await seed({ gems: 120, xp: 600 });
      await assertFails(batch(db(), { gems: 86, xp: 600 }));
    });
  }

  it('a drop that sets lastPurchaseId but creates no purchases doc is denied', async () => {
    await assertFails(batch(kidDb(), { gems: 71, heroes: ['knight', 'wizard'], hero: 'wizard', lastPurchaseId: 'p1' }));
  });

  it('a drop that creates a purchases doc but sets no lastPurchaseId is denied', async () => {
    await assertFails(batch(kidDb(), { gems: 71, heroes: ['knight', 'wizard'], hero: 'wizard' }, [entry('p1', 'wizard', 15)]));
  });

  it('a drop that points lastPurchaseId at an older purchases doc is denied', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(purchaseRef(ctx.firestore(), 'old'), entry('old', 'wizard', 15));
      await updateDoc(kidRef(ctx.firestore()), { 'game.lastPurchaseId': 'old', 'game.heroes': ['knight', 'wizard'], 'game.hero': 'wizard' });
    });
    await assertFails(batch(kidDb(), { gems: 86 - 35, heroes: ['knight', 'wizard', 'ranger'], hero: 'ranger', lastPurchaseId: 'old' }, []));
  });

  it('a drop with a lastPurchaseId that is not a plain id (a path) is denied', async () => {
    await assertFails(batch(kidDb(), { gems: 71, heroes: ['knight', 'wizard'], hero: 'wizard', lastPurchaseId: '../x' }, [entry('p1', 'wizard', 15)]));
  });
});

describe('a drop that matches a purchase is allowed', () => {
  it('kid: wizard for 15', async () => {
    await assertSucceeds(buyWizard(kidDb()));
    expect((await getDoc(purchaseRef(parentDb(), 'p1'))).data()).toMatchObject({ heroId: 'wizard', cost: 15 });
  });

  it('parent device playing as the kid: wizard for 15', async () => {
    await assertSucceeds(buyWizard(parentDb()));
  });

  it('a second buy needs a new id: ranger for 35 after wizard', async () => {
    await assertSucceeds(buyWizard(kidDb()));
    await assertSucceeds(batch(kidDb(), { gems: 36, heroes: ['knight', 'wizard', 'ranger'], hero: 'ranger', lastPurchaseId: 'p2' }, [entry('p2', 'ranger', 35)]));
  });

  it('a run (gems and xp up) and an equip still pass, with or without lastPurchaseId carried along', async () => {
    await assertSucceeds(batch(kidDb(), { xp: 500, gems: 95 }));
    await assertSucceeds(batch(kidDb(), { xp: 500, gems: 95, lastPurchaseId: 'p0' }));
  });
});

describe('a purchase whose cost does not equal the drop is denied', () => {
  it('drop 14 with an entry for 15', async () => {
    await assertFails(buyWizard(kidDb(), { game: { gems: 72 } }));
  });
  it('drop 15 with an entry for 14', async () => {
    await assertFails(buyWizard(kidDb(), { entries: [entry('p1', 'wizard', 14)] }));
  });
  it('drop 100 with a wizard entry for 15 (one entry cannot cover a bigger drop)', async () => {
    await assertFails(buyWizard(kidDb(), { game: { gems: 0 } }));
  });
  it('drop 15 for a ranger entry (35): the entry is not at the catalog price of the hero added', async () => {
    await assertFails(batch(kidDb(), { gems: 71, heroes: ['knight', 'ranger'], hero: 'ranger', lastPurchaseId: 'p1' }, [entry('p1', 'ranger', 15)]));
  });
  it('the entry names another hero than the one added', async () => {
    await assertFails(buyWizard(kidDb(), { entries: [entry('p1', 'ranger', 15)] }));
  });
});

describe('exactly one purchases doc per buy', () => {
  it('two valid-looking docs in one buy batch: denied', async () => {
    await assertFails(buyWizard(kidDb(), { entries: [entry('p1', 'wizard', 15), entry('p2', 'wizard', 15)] }));
  });
  it('a second doc for another hero in the same batch: denied', async () => {
    await assertFails(buyWizard(kidDb(), { entries: [entry('p1', 'wizard', 15), entry('p2', 'ranger', 35)] }));
  });
  it('an extra purchases doc with a run write (no drop): denied', async () => {
    await assertFails(batch(kidDb(), { xp: 500 }, [entry('px', 'wizard', 15)]));
  });
  it('an entry whose id is not the kid doc lastPurchaseId: denied', async () => {
    await assertFails(buyWizard(kidDb(), { game: { lastPurchaseId: 'other' } }));
  });
});

describe('game.hero stays inside game.heroes', () => {
  it('a kid sets hero to an unowned hero: denied', async () => {
    await assertFails(batch(kidDb(), { hero: 'wizard' }));
    await assertFails(batch(kidDb(), { hero: 'dragon', xp: 500 }));
  });
  it('a kid sets hero to a made-up id: denied', async () => {
    await assertFails(batch(kidDb(), { hero: 'ghost' }));
  });
  it('a kid equips an owned hero: allowed', async () => {
    await seed({ heroes: ['knight', 'wizard'], hero: 'knight' });
    await assertSucceeds(batch(kidDb(), { heroes: ['knight', 'wizard'], hero: 'wizard' }));
  });
});

describe('the free knight and the parent path', () => {
  it('the knight can be added with a gem rise (a game {} doc filled with its first run)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(kidRef(ctx.firestore()), { ...kidDoc(), game: {} }); });
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: { xp: 10, bestCombo: 2, gems: 1, heroes: ['knight'], hero: 'knight' } }));
  });
  it('the knight added together with a gem drop is denied (a drop needs a purchase, the knight has none)', async () => {
    await seed({ heroes: ['wizard'], hero: 'wizard' });
    await assertFails(batch(kidDb(), { gems: 80, heroes: ['wizard', 'knight'], hero: 'wizard' }));
  });
  it('a parent still raises gems and adds a hero without a drop (no kid bounds, no price check)', async () => {
    await assertSucceeds(batch(parentDb(), { gems: 586, xp: 5000 }));
    await assertSucceeds(batch(parentDb(), { gems: 586, xp: 5000, heroes: ['knight', 'dragon'], hero: 'dragon' }));
  });
});

describe('through the repo', () => {
  it('applyGameDelta purchase writes the game, lastPurchaseId and exactly one purchases doc with that id', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM, new VersionGuard(null, { build: 100 }));
    const game = await repo.applyGameDelta(KID, { purchase: 'wizard' });
    expect(game).toMatchObject({ gems: 71, heroes: ['knight', 'wizard'], hero: 'wizard' });
    const stored = (await getDoc(kidRef(parentDb()))).data() as { game: { lastPurchaseId?: string } };
    const docs = await getDocs(collection(parentDb(), `families/${FAM}/kids/${KID}/purchases`));
    expect(docs.size).toBe(1);
    expect(stored.game.lastPurchaseId).toBe(docs.docs[0]!.id);
    expect(docs.docs[0]!.data()).toMatchObject({ heroId: 'wizard', cost: 15 });
  });

  it('a run, an equip and two purchases in a row all pass through the rules', async () => {
    await seed({ gems: 200 });
    const repo = new FirestoreRepo(kidDb(), FAM, new VersionGuard(null, { build: 100 }));
    await repo.applyGameDelta(KID, { xp: 504, gems: 9, bestCombo: 12, playedAt: Date.now() });
    await repo.applyGameDelta(KID, { purchase: 'wizard' });
    await repo.applyGameDelta(KID, { purchase: 'ranger' });
    await repo.applyGameDelta(KID, { equip: 'knight' });
    const stored = (await getDoc(kidRef(parentDb()))).data() as { game: { gems: number; heroes: string[]; hero: string } };
    expect(stored.game).toMatchObject({ gems: 200 + 9 - 15 - 35, hero: 'knight' });
    expect(stored.game.heroes).toEqual(['knight', 'wizard', 'ranger']);
    expect((await getDocs(collection(parentDb(), `families/${FAM}/kids/${KID}/purchases`))).size).toBe(2);
  });

  it('a double confirm still buys once', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM, new VersionGuard(null, { build: 100 }));
    const r = await Promise.allSettled([repo.applyGameDelta(KID, { purchase: 'wizard' }), repo.applyGameDelta(KID, { purchase: 'wizard' })]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await getDocs(collection(parentDb(), `families/${FAM}/kids/${KID}/purchases`))).size).toBe(1);
  });
});
