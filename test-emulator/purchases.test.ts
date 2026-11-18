import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { GameDeltaError } from '../src/engine/game';
import type { Kid } from '../src/engine/models';

// Every name, id and number is made up. The purchases log: families/{uid}/kids/{kidId}/purchases/{id}.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidaaaa';
const OTHER = 'kidbbbb';

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const strangerDb = () => env.authenticatedContext('stranger', { email: 'x@example.com', email_verified: true }).firestore();
const kidDb = (kidId = KID) => env.authenticatedContext(`kid_${kidId}`, { role: 'kid', familyUid: FAM, kidId }).firestore();
type Db = ReturnType<typeof parentDb>;
const kidRef = (db: Db, id = KID) => doc(db, `families/${FAM}/kids/${id}`);
const purchases = (db: Db, id = KID) => collection(db, `families/${FAM}/kids/${id}/purchases`);

const storedKid = (id: string, game: Record<string, unknown> = {}) => ({
  id,
  name: 'Testkid',
  createdAt: 1,
  hasPin: true,
  settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
  game: { lastPlayedDay: '2026-11-17', xp: 467, gems: 86, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1, ...game },
});
const entry = (over: Record<string, unknown> = {}) => ({ id: 'p1', heroId: 'wizard', cost: 15, at: 1000, ...over });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(kidRef(db), storedKid(KID));
    await setDoc(kidRef(db, OTHER), storedKid(OTHER));
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
  });
});

/** The raw write a purchase makes: the game change and the log entry in one batch. */
function buyBatch(db: Db, id: string, over: { entry?: Record<string, unknown>; game?: Record<string, unknown>; entryKid?: string; omit?: string } = {}) {
  const b = writeBatch(db);
  b.update(kidRef(db, id), { game: { ...storedKid(id).game, gems: 71, heroes: ['knight', 'wizard'], hero: 'wizard', ...(over.game ?? {}) } });
  const e: Record<string, unknown> = entry(over.entry);
  if (over.omit) delete e[over.omit];
  b.set(doc(purchases(db, over.entryKid ?? id), 'p1'), e);
  return b.commit();
}

describe('purchases rules', () => {
  it('a kid creates an entry for its own kid in the same batch that adds the hero and spends the gems', async () => {
    await assertSucceeds(buyBatch(kidDb(), KID));
    expect((await getDoc(doc(purchases(parentDb()), 'p1'))).data()).toMatchObject({ heroId: 'wizard', cost: 15, at: 1000 });
  });

  it('a kid cannot create an entry alone, with no game change', async () => {
    await assertFails(setDoc(doc(purchases(kidDb()), 'p1'), entry()));
  });

  it("a kid cannot create an entry in another kid's log", async () => {
    // The entry goes to OTHER while the batch also changes this kid's own game.
    await assertFails(buyBatch(kidDb(), KID, { entryKid: OTHER }));
    // The whole purchase aimed at OTHER with this kid's token.
    await assertFails(buyBatch(kidDb(), OTHER));
  });

  it('a kid cannot log a hero the game did not gain', async () => {
    await assertFails(buyBatch(kidDb(), KID, { entry: { heroId: 'robot' } }));
  });

  it('a kid cannot log a cost different from the gems spent', async () => {
    await assertFails(buyBatch(kidDb(), KID, { entry: { cost: 5 } }));
    await assertFails(buyBatch(kidDb(), KID, { entry: { cost: 99 } }));
  });

  it('a kid cannot log a purchase for a hero already owned', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(kidRef(ctx.firestore()), { 'game.heroes': ['knight', 'wizard'], 'game.hero': 'wizard' });
    });
    await assertFails(buyBatch(kidDb(), KID, { game: { heroes: ['knight', 'wizard'] } }));
  });

  it('an entry with an extra or a missing field is refused', async () => {
    await assertFails(buyBatch(kidDb(), KID, { entry: { note: 'free' } }));
    await assertFails(buyBatch(kidDb(), KID, { omit: 'at' }));
  });

  it('nobody updates an entry', async () => {
    await assertSucceeds(buyBatch(kidDb(), KID));
    await assertFails(updateDoc(doc(purchases(kidDb()), 'p1'), { cost: 1 }));
    await assertFails(updateDoc(doc(purchases(parentDb()), 'p1'), { cost: 1 }));
  });

  it('nobody deletes an entry', async () => {
    await assertSucceeds(buyBatch(kidDb(), KID));
    await assertFails(deleteDoc(doc(purchases(kidDb()), 'p1')));
    await assertFails(deleteDoc(doc(purchases(parentDb()), 'p1')));
  });

  it('only the owning parent reads entries: not the kid, not another account, not signed out', async () => {
    await assertSucceeds(buyBatch(kidDb(), KID));
    await assertSucceeds(getDocs(purchases(parentDb())));
    await assertFails(getDocs(purchases(kidDb())));
    await assertFails(getDocs(purchases(strangerDb())));
    await assertFails(getDocs(purchases(env.unauthenticatedContext().firestore())));
  });

  it('a parent device that plays as a kid logs a purchase only with the matching game change', async () => {
    await assertFails(setDoc(doc(purchases(parentDb()), 'p1'), entry()));
    await assertSucceeds(buyBatch(parentDb(), KID));
  });
});

describe('purchase cost is bound to the hero catalog price', () => {
  const rich = async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(kidRef(ctx.firestore()), { 'game.gems': 200 });
    });
  };
  const buyFor = (heroId: string, cost: number) =>
    buyBatch(kidDb(), KID, { game: { gems: 200 - cost, heroes: ['knight', heroId], hero: heroId }, entry: { heroId, cost } });

  it('a below-price buy is refused: dragon (100) for 1 gem', async () => {
    await rich();
    await assertFails(buyFor('dragon', 1));
  });

  it('a below-price buy is refused for every hero, one gem short', async () => {
    await rich();
    for (const [id, price] of [['wizard', 15], ['ranger', 35], ['robot', 60], ['dragon', 100]] as const) await assertFails(buyFor(id, price - 1));
  });

  it('an above-price buy is refused too: wizard for 20 gems', async () => {
    await rich();
    await assertFails(buyFor('wizard', 20));
  });

  it('an unknown heroId is refused, even at a plausible cost', async () => {
    await rich();
    await assertFails(buyFor('ghost', 15));
  });

  it('a buy at the catalog price still passes, for every purchasable hero', async () => {
    await rich();
    await assertSucceeds(buyFor('dragon', 100));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(kidRef(ctx.firestore()), { 'game.gems': 200, 'game.heroes': ['knight'], 'game.hero': 'knight' });
    });
    for (const [id, price] of [['wizard', 15], ['ranger', 35], ['robot', 60]] as const) {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(kidRef(ctx.firestore()), { 'game.gems': 200, 'game.heroes': ['knight'], 'game.hero': 'knight' });
      });
      const db = kidDb();
      const b = writeBatch(db);
      b.update(kidRef(db), { game: { ...storedKid(KID).game, gems: 200 - price, heroes: ['knight', id], hero: id } });
      b.set(doc(purchases(db), `p-${id}`), { id: `p-${id}`, heroId: id, cost: price, at: 1 });
      await assertSucceeds(b.commit());
    }
  });
});

describe('a kid token cannot add a hero on the kid doc except at the catalog price', () => {
  const grow = (db: Db, over: Record<string, unknown>) => updateDoc(kidRef(db), { game: { ...storedKid(KID).game, ...over } });

  it('a free dragon (gems unchanged) is refused', async () => {
    await assertFails(grow(kidDb(), { heroes: ['knight', 'dragon'], hero: 'dragon' }));
  });

  it('a dragon for 1 gem is refused', async () => {
    await assertFails(grow(kidDb(), { gems: 85, heroes: ['knight', 'dragon'], hero: 'dragon' }));
  });

  it('two heroes at once are refused, even when the gems drop by both prices', async () => {
    await assertFails(grow(kidDb(), { gems: 86 - 15 - 35, heroes: ['knight', 'wizard', 'ranger'], hero: 'ranger' }));
  });

  it('an unknown hero is refused, even at a plausible price', async () => {
    await assertFails(grow(kidDb(), { gems: 71, heroes: ['knight', 'ghost'], hero: 'ghost' }));
  });

  it('a hero added while gems also rise is refused', async () => {
    await assertFails(grow(kidDb(), { gems: 90, heroes: ['knight', 'wizard'], hero: 'wizard' }));
  });

  it('a buy at the catalog price passes on the kid doc, for each hero', async () => {
    await assertSucceeds(grow(kidDb(), { gems: 71, heroes: ['knight', 'wizard'], hero: 'wizard' }));
    for (const [id, price] of [['ranger', 35], ['robot', 60]] as const) {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(kidRef(ctx.firestore()), { 'game.gems': 200, 'game.heroes': ['knight'], 'game.hero': 'knight' });
      });
      await assertSucceeds(grow(kidDb(), { gems: 200 - price, heroes: ['knight', id], hero: id }));
    }
  });

  it('a run (xp and gems up) and an equip still pass for a kid', async () => {
    await assertSucceeds(grow(kidDb(), { xp: 500, gems: 95 }));
    await assertSucceeds(grow(kidDb(), { xp: 500, gems: 95, hero: 'knight' }));
  });

  it('the parent path is unchanged: a parent can still write a hero change without a price check', async () => {
    await assertSucceeds(grow(parentDb(), { gems: 86, heroes: ['knight', 'dragon'], hero: 'dragon' }));
  });
});

describe('purchases through the repo', () => {
  it('a kid purchase writes the game and one log entry in one transaction', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const game = await repo.applyGameDelta(KID, { purchase: 'wizard' });
    expect(game).toMatchObject({ gems: 71, heroes: ['knight', 'wizard'], hero: 'wizard' });
    const log = await new FirestoreRepo(parentDb(), FAM).listPurchases(KID, 20);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ heroId: 'wizard', cost: 15 });
    expect(Math.abs(log[0]!.at - Date.now())).toBeLessThan(60_000);
  });

  it('a refused purchase (too few gems) changes nothing and logs nothing', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(kidRef(ctx.firestore()), { 'game.gems': 3 });
    });
    const repo = new FirestoreRepo(kidDb(), FAM);
    await expect(repo.applyGameDelta(KID, { purchase: 'wizard' })).rejects.toBeInstanceOf(GameDeltaError);
    expect(await new FirestoreRepo(parentDb(), FAM).listPurchases(KID, 20)).toEqual([]);
  });

  it('a double confirm buys once: one call fails and one entry stays', async () => {
    const repo = new FirestoreRepo(kidDb(), FAM);
    const results = await Promise.allSettled([repo.applyGameDelta(KID, { purchase: 'wizard' }), repo.applyGameDelta(KID, { purchase: 'wizard' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await new FirestoreRepo(parentDb(), FAM).listPurchases(KID, 20)).toHaveLength(1);
    expect(((await getDoc(kidRef(parentDb()))).data() as Kid).game.gems).toBe(71);
  });

  it('listPurchases returns the newest first, at most the limit, from the exact path', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(kidRef(ctx.firestore()), { 'game.gems': 500 });
      for (let i = 0; i < 5; i++) await setDoc(doc(purchases(ctx.firestore()), `old${i}`), { id: `old${i}`, heroId: 'wizard', cost: 15, at: 100 + i });
      await setDoc(doc(purchases(ctx.firestore(), OTHER), 'theirs'), { id: 'theirs', heroId: 'robot', cost: 60, at: 99999 });
    });
    await new FirestoreRepo(kidDb(), FAM).applyGameDelta(KID, { purchase: 'robot' });
    const log = await new FirestoreRepo(parentDb(), FAM).listPurchases(KID, 3);
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ heroId: 'robot' });
    expect(log[1]!.at).toBeGreaterThan(log[2]!.at);
    expect(log.some((l) => l.id === 'theirs')).toBe(false);
  });
});

describe('live kid doc', () => {
  it('the parent sees a run finished on a second client without a reload, and stops after unsubscribe', async () => {
    const parent = new FirestoreRepo(parentDb(), FAM);
    const seen: number[] = [];
    let first!: () => void;
    const gotFirst = new Promise<void>((r) => (first = r));
    const off = parent.watchKid(KID, (k) => {
      if (!k) return;
      seen.push(k.game.xp);
      first();
    });
    await gotFirst;
    expect(seen[0]).toBe(467);
    await new FirestoreRepo(kidDb(), FAM).applyGameDelta(KID, { xp: 120, gems: 7, bestCombo: 3, playedAt: Date.now() });
    const deadline = Date.now() + 10_000;
    while (seen.at(-1) !== 587 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    off();
    expect(seen.at(-1)).toBe(587);
    const n = seen.length;
    await new FirestoreRepo(kidDb(), FAM).applyGameDelta(KID, { xp: 1 });
    await new Promise((r) => setTimeout(r, 400));
    expect(seen.length).toBe(n);
  });
});
