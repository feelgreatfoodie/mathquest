import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { FAM, GAME, KID, SETTINGS, deposit, kidDb, kidRef, newEnv, parentDb, payChunk, seed, stored, storedDeposit } from './vaultHelpers';

// vault-followup. (1) A payout is exactly-once and resumable: each chunk raises game.gems and the deposit's paidOut together
// in one write, the deposit stays collecting (or breaking) until paidOut equals the payout, and only the last chunk sets
// collected (or broken). (2) The bonus rate is capped 0 to 10 per 10 gems in the rules, not only in the screen. Every name,
// id and number is made up.
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await newEnv('demo-mathquest-vault-followup');
});
afterAll(async () => env.cleanup());

const D = { id: 'd1', amount: 50, termDays: 7 as const, ratePer10: 3, bonus: 15 };
const repo = () => new FirestoreRepo(kidDb(env), FAM);

/** Pays every chunk, retrying a write the emulator aborted under contention. */
async function drain(r: FirestoreRepo, mode: 'collect' | 'break' = 'collect') {
  let total = 0;
  for (let guard = 0; guard < 60; guard++) {
    try {
      const x = await r.vaultPay(KID, 'd1', mode);
      total += x.paid;
      if (x.done) return total;
    } catch {
      // an aborted transaction: read again and go on
    }
  }
  throw new Error('payout did not finish');
}

describe('a collect is exactly-once and resumable', () => {
  beforeEach(async () => {
    await seed(env, { deposits: [{ ...D, ageDays: 8 }], game: { ...GAME, gems: 100 } });
  });
  it('an interrupt after chunk 3 of 7 leaves collecting, paidOut 30 and gems +30; a fresh client resumes and the total is exactly 65', async () => {
    const first = repo();
    for (let i = 0; i < 3; i++) expect((await first.vaultPay(KID, 'd1', 'collect')).paid).toBe(10);
    expect(await storedDeposit(env, 'd1')).toMatchObject({ status: 'collecting', paidOut: 30 });
    expect((await stored(env)).game.gems).toBe(130);
    expect((await stored(env)).vault).toEqual({ active: 0, lastId: 'd1', closedId: 'd1' });
    // The app closed here. A new client opens, finds a collecting deposit and finishes it. It asks for `break`: an
    // in-progress collect ignores the mode and pays what it still owes.
    const second = repo();
    const rest = await drain(second, 'break');
    expect(rest).toBe(35);
    expect(await storedDeposit(env, 'd1')).toMatchObject({ status: 'collected', paidOut: 65 });
    expect((await stored(env)).game.gems).toBe(165);
  });
  it('the status stays collecting until the chunk that makes paidOut equal amount + bonus', async () => {
    const r = repo();
    let last = await r.vaultPay(KID, 'd1', 'collect');
    for (let i = 1; i < 6; i++) {
      expect((await storedDeposit(env, 'd1'))!.status).toBe('collecting');
      last = await r.vaultPay(KID, 'd1', 'collect');
    }
    expect(last.done).toBe(false);
    expect(await storedDeposit(env, 'd1')).toMatchObject({ status: 'collecting', paidOut: 60 });
    expect((await r.vaultPay(KID, 'd1', 'collect')).done).toBe(true);
    expect(await storedDeposit(env, 'd1')).toMatchObject({ status: 'collected', paidOut: 65 });
  });
  it('two clients collecting at the same time pay amount + bonus exactly: gems +65, paidOut 65, one collected deposit', async () => {
    const totals = await Promise.all([drain(repo()), drain(repo())]);
    expect(totals[0]! + totals[1]!).toBe(65);
    expect(await storedDeposit(env, 'd1')).toMatchObject({ status: 'collected', paidOut: 65 });
    expect((await stored(env)).game.gems).toBe(165);
    expect((await stored(env)).vault).toEqual({ active: 0, lastId: 'd1', closedId: 'd1' });
  });
  it('a double tap on a one-chunk break pays once', async () => {
    await seed(env, { deposits: [{ id: 'd1', amount: 10, termDays: 3, ratePer10: 1, bonus: 1, ageDays: 1 }], game: { ...GAME, gems: 100 } });
    const r = repo();
    const res = await Promise.allSettled([r.vaultPay(KID, 'd1', 'break'), r.vaultPay(KID, 'd1', 'break')]);
    expect(res.filter((x) => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(await storedDeposit(env, 'd1')).toMatchObject({ status: 'broken', paidOut: 10 });
    expect((await stored(env)).game.gems).toBe(110);
    expect((await stored(env)).vault).toMatchObject({ active: 0 });
  });
  it('a stale write that repeats a chunk already paid (paidOut 10 again after 20) is denied', async () => {
    const db = kidDb(env);
    await assertSucceeds(payChunk(db, 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }));
    await assertSucceeds(payChunk(db, 'd1', { gemsBefore: 110, chunk: 10, paidBefore: 10 }));
    // A second client still holding paidOut 10 and gems 110 writes the same chunk again.
    await assertFails(payChunk(db, 'd1', { gemsBefore: 110, chunk: 10, paidBefore: 10 }));
    expect(await storedDeposit(env, 'd1')).toMatchObject({ paidOut: 20 });
    expect((await stored(env)).game.gems).toBe(120);
  });
});

describe('the status machine in the rules', () => {
  it('collected needs paidOut equal to amount + bonus, and collecting needs less than that', async () => {
    await seed(env, { deposits: [{ ...D, ageDays: 8 }], game: { ...GAME, gems: 100 } });
    const db = kidDb(env);
    await assertFails(payChunk(db, 'd1', { gemsBefore: 100, chunk: 10, close: 'collected', activeBefore: 1 })); // 10 of 65
    await assertSucceeds(payChunk(db, 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }));
    await assertFails(payChunk(db, 'd1', { gemsBefore: 110, chunk: 10, paidBefore: 10, final: 'collected' })); // 20 of 65
    await assertFails(payChunk(db, 'd1', { gemsBefore: 110, chunk: 10, paidBefore: 10 }, { doc: { status: 'broken' } }));
  });
  it('the last chunk must set collected: paidOut at the payout with status still collecting is denied', async () => {
    await seed(env, { deposits: [{ ...D, status: 'collecting', paidOut: 55, ageDays: 8 }], game: { ...GAME, gems: 100 }, vault: { active: 0, lastId: 'd1', closedId: 'd1' } });
    const db = kidDb(env);
    await assertFails(payChunk(db, 'd1', { gemsBefore: 100, chunk: 10, paidBefore: 55 })); // 65 reached, still collecting
    await assertSucceeds(payChunk(db, 'd1', { gemsBefore: 100, chunk: 10, paidBefore: 55, final: 'collected' }));
  });
  it('a collect before the term is denied for every chunk, including one that is also the whole payout', async () => {
    await seed(env, { deposits: [{ ...D, ageDays: 2 }], game: { ...GAME, gems: 100 } });
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }));
    await seed(env, { deposits: [{ id: 'd1', amount: 10, termDays: 3, ratePer10: 0, bonus: 0, ageDays: 1 }], game: { ...GAME, gems: 100 } });
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collected', activeBefore: 1 }));
  });
  it('the principal cannot be drawn early and the bonus later: breaking cannot switch to collecting, collecting cannot switch to breaking', async () => {
    await seed(env, { deposits: [{ ...D, status: 'breaking', paidOut: 30, ageDays: 8 }], game: { ...GAME, gems: 100 }, vault: { active: 0, lastId: 'd1', closedId: 'd1' } });
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, paidBefore: 30 }, { doc: { status: 'collecting' } }));
    await seed(env, { deposits: [{ ...D, status: 'collecting', paidOut: 30, ageDays: 8 }], game: { ...GAME, gems: 100 }, vault: { active: 0, lastId: 'd1', closedId: 'd1' } });
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, paidBefore: 30 }, { doc: { status: 'breaking' } }));
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, paidBefore: 30 }, { doc: { status: 'active' } }));
  });
  it('a collected or broken deposit takes no more writes', async () => {
    await seed(env, { deposits: [{ ...D, status: 'collected', paidOut: 65, ageDays: 8 }], game: { ...GAME, gems: 100 }, vault: { active: 0, lastId: 'd1', closedId: 'd1' } });
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 1, paidBefore: 65 }));
  });
  it('a break that is the whole payout in one chunk (10 gems) goes active to broken in one write', async () => {
    await seed(env, { deposits: [{ id: 'd1', amount: 10, termDays: 3, ratePer10: 1, bonus: 1, ageDays: 1 }], game: { ...GAME, gems: 100 } });
    await assertSucceeds(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'broken', activeBefore: 1 }));
  });
});

describe('the bonus rate is capped 0 to 10 in the rules', () => {
  const withRates = (vault: Record<string, unknown>) => ({ ...SETTINGS, vault });
  beforeEach(async () => {
    await seed(env);
  });
  it('a parent write of 10 is accepted, 11 is refused, and the cap holds for each term', async () => {
    const db = parentDb(env);
    await assertSucceeds(updateDoc(kidRef(db), { settings: withRates({ on: true, d3: 10, d7: 10, d14: 10 }) }));
    await assertSucceeds(updateDoc(kidRef(db), { settings: withRates({ on: true, d3: 0 }) }));
    for (const k of ['d3', 'd7', 'd14']) await assertFails(updateDoc(kidRef(db), { settings: withRates({ on: true, [k]: 11 }) }));
  });
  it('a parent write of a negative, fractional, text or unknown vault key is refused', async () => {
    const db = parentDb(env);
    await assertFails(updateDoc(kidRef(db), { settings: withRates({ on: true, d7: -1 }) }));
    await assertFails(updateDoc(kidRef(db), { settings: withRates({ on: true, d7: 2.5 }) }));
    await assertFails(updateDoc(kidRef(db), { settings: withRates({ on: true, d7: '3' }) }));
    await assertFails(updateDoc(kidRef(db), { settings: withRates({ on: true, d30: 3 }) }));
    await assertFails(updateDoc(kidRef(db), { settings: withRates({ on: 'yes' }) }));
  });
  it('a parent write that creates a kid with a rate of 11 is refused', async () => {
    const db = parentDb(env);
    const base = { id: 'kidnew', name: 'Newkid', createdAt: 1, game: GAME };
    await assertFails(setDoc(doc(db, `families/${FAM}/kids/kidnew`), { ...base, settings: withRates({ on: true, d14: 11 }) }));
    await assertSucceeds(setDoc(doc(db, `families/${FAM}/kids/kidnew`), { ...base, settings: withRates({ on: true, d14: 10 }) }));
  });
  it('a deposit whose ratePer10 exceeds 10 is refused even when the stored setting says so (seeded past the rules)', async () => {
    await seed(env, { settings: withRates({ on: true, d7: 11 }) });
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7, ratePer10: 11, bonus: 55 }));
    await seed(env, { settings: withRates({ on: true, d7: 10 }) });
    await assertSucceeds(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7, ratePer10: 10, bonus: 50 }));
  });
  it('the defaults are still 1, 3 and 7, and an old doc with no rates still deposits at them', async () => {
    await assertSucceeds(deposit(kidDb(env), { id: 'd1', amount: 100, termDays: 14 }));
    expect(await storedDeposit(env, 'd1')).toMatchObject({ ratePer10: 7, bonus: 70 });
  });
  it('a kid cannot write settings (the rate cap is parent-only and a kid write of settings is denied)', async () => {
    const db = kidDb(env);
    const b = writeBatch(db);
    b.update(kidRef(db), { settings: withRates({ on: true, d7: 9 }) });
    await assertFails(b.commit());
  });
});
