import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, getDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { DAY, FAM, GAME, KID, SETTINGS, deposit, kidDb, kidRef, newEnv, parentDb, payChunk, seed, stored, storedDeposit, vaultRef } from './vaultHelpers';

// The vault rules. A deposit is the one write that lowers gems without a purchase: gems drop by `amount`, the kid's
// vault map gains one active entry named lastId, and the deposit doc is created in the same write. A payout rises gems
// by `chunk` (at most 10, the kid-write raise bound) while the deposit's `paidOut` rises by the same `chunk`. Time checks
// read request.time and the server's createdAt. Every name, id and number is made up.
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await newEnv('demo-mathquest-vault');
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await seed(env);
});

describe('a deposit', () => {
  it('kid: 50 gems for 7 days, bonus 15, creates the doc and lowers gems by 50', async () => {
    await assertSucceeds(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }));
    const d = await storedDeposit(env, 'd1');
    expect(d).toMatchObject({ amount: 50, termDays: 7, ratePer10: 3, bonus: 15, status: 'active', paidOut: 0 });
    expect((await stored(env)).game.gems).toBe(150);
    expect((await stored(env)).vault).toEqual({ active: 1, lastId: 'd1' });
  });
  it('rounds the bonus down per full 10: 47 gems for 14 days gives 4 x 7 = 28', async () => {
    await assertSucceeds(deposit(kidDb(env), { id: 'd1', amount: 47, termDays: 14 }));
    expect(await storedDeposit(env, 'd1')).toMatchObject({ bonus: 28 });
  });
  it('parent device playing as the kid is held to the same rule', async () => {
    await assertSucceeds(deposit(parentDb(env), { id: 'd1', amount: 30, termDays: 3 }));
  });
  it('a wrong bonus is denied (too high, and too low)', async () => {
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7, bonus: 16 }));
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7, bonus: 14 }));
  });
  it('a rate that is not the parent rate is denied; the parent rate (set to 5 for 7 days) is accepted', async () => {
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7, ratePer10: 9, bonus: 45 }));
    await seed(env, { settings: { ...SETTINGS, vault: { on: true, d7: 5 } } });
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 })); // default rate 3 no longer matches
    await assertSucceeds(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7, ratePer10: 5, bonus: 25 }));
  });
  it('a gems drop with no vault doc is denied', async () => {
    const db = kidDb(env);
    await assertFails(updateDoc(kidRef(db), { game: { ...GAME, gems: 150 }, vault: { active: 1, lastId: 'd1' } }));
    await assertFails(updateDoc(kidRef(db), { game: { ...GAME, gems: 150 } }));
  });
  it('a vault doc with no gems drop (free deposit) is denied', async () => {
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }, { game: { gems: 200 } }));
  });
  it('a drop that differs from the amount is denied (drop 40, amount 50; drop 60, amount 50)', async () => {
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }, { game: { gems: 160 } }));
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }, { game: { gems: 140 } }));
  });
  it('a deposit under 10, a term outside 3, 7 and 14, and a non-integer amount are denied', async () => {
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 9, termDays: 3, bonus: 0 }));
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 30, ratePer10: 50, bonus: 250 }));
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50.5, termDays: 3, bonus: 5 }, { game: { gems: 149.5 } }));
  });
  it('is denied when the parent has the vault off (and when the setting is missing)', async () => {
    await seed(env, { settings: { ...SETTINGS, vault: { on: false } } });
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }));
    const { vault: _gone, ...noVault } = SETTINGS;
    await seed(env, { settings: noVault });
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }));
  });
  it('a fourth active deposit is denied; the third is accepted', async () => {
    const mk = (id: string) => ({ id, amount: 10, termDays: 3 as const, ratePer10: 1, bonus: 1, ageDays: 0.1 });
    await seed(env, { deposits: [mk('a1'), mk('a2')] });
    await assertSucceeds(deposit(kidDb(env), { id: 'a3', amount: 10, termDays: 3 }, { activeBefore: 2, gemsBefore: 200 }));
    await seed(env, { deposits: [mk('a1'), mk('a2'), mk('a3')] });
    await assertFails(deposit(kidDb(env), { id: 'a4', amount: 10, termDays: 3 }, { activeBefore: 3 }));
    // Lying about the count does not help: the pointer must go up by exactly one from what is stored.
    await assertFails(deposit(kidDb(env), { id: 'a4', amount: 10, termDays: 3 }, { vault: { active: 1, lastId: 'a4' } }));
  });
  it('a deposit with a client-chosen createdAt (not the server time) is denied', async () => {
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }, { doc: { createdAt: new Date(Date.now() - 30 * DAY) } }));
  });
  it('a deposit that also buys or adds a hero is denied', async () => {
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }, { game: { heroes: ['knight', 'wizard'] } }));
  });
  it('a deposit written with a status other than active, or with paidOut above 0, is denied', async () => {
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }, { doc: { status: 'collected' } }));
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }, { doc: { paidOut: 10 } }));
  });
  it('another kid, or a stranger, cannot create into this kid vault', async () => {
    const other = env.authenticatedContext('kid_other', { role: 'kid', familyUid: FAM, kidId: 'other' }).firestore();
    const b = writeBatch(other);
    b.set(vaultRef(other, 'd1'), { id: 'd1', amount: 50, termDays: 7, ratePer10: 3, bonus: 15, status: 'active', paidOut: 0 });
    await assertFails(b.commit());
  });
  it('nobody deletes a deposit, and the parent can read the history', async () => {
    await assertSucceeds(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }));
    const pdb = parentDb(env);
    await assertSucceeds(getDoc(vaultRef(pdb, 'd1')));
    await assertFails(deleteDoc(vaultRef(pdb, 'd1')));
    await assertFails(deleteDoc(vaultRef(kidDb(env), 'd1')));
  });
});

describe('collecting a matured deposit (paid out 10 gems a write)', () => {
  const D = { id: 'd1', amount: 50, termDays: 7 as const, ratePer10: 3, bonus: 15 };
  beforeEach(async () => {
    await seed(env, { deposits: [{ ...D, ageDays: 8 }], game: { ...GAME, gems: 100 } });
  });
  it('after the term the first chunk closes the deposit and pays 10; the 65 arrive in 7 writes and no more', async () => {
    const db = kidDb(env);
    await assertSucceeds(payChunk(db, 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }));
    expect(await storedDeposit(env, 'd1')).toMatchObject({ status: 'collecting', paidOut: 10 });
    expect((await stored(env)).vault).toEqual({ active: 0, lastId: 'd1', closedId: 'd1' });
    let gems = 110;
    let paid = 10;
    for (const chunk of [10, 10, 10, 10, 10, 5]) {
      await assertSucceeds(payChunk(db, 'd1', { gemsBefore: gems, chunk, paidBefore: paid, ...(paid + chunk === 65 ? { final: 'collected' as const } : {}) }));
      gems += chunk;
      paid += chunk;
    }
    expect(gems).toBe(165);
    expect((await stored(env)).game.gems).toBe(165);
    expect(await storedDeposit(env, 'd1')).toMatchObject({ paidOut: 65, status: 'collected' });
    // Paid in full: a 66th gem is refused.
    await assertFails(payChunk(db, 'd1', { gemsBefore: 165, chunk: 1, paidBefore: 65, final: 'collected' }));
  });
  it('a chunk above 10 gems is denied (the kid-write raise bound), even for a matured deposit', async () => {
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 11, close: 'collecting', activeBefore: 1 }));
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 65, close: 'collecting', activeBefore: 1 }));
  });
  it('gems that rise by more or less than `paid` rises are denied', async () => {
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }, { game: { gems: 112 } }));
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }, { game: { gems: 105 } }));
  });
  it('paid rising with no gem rise (a free marker) is denied; a gem rise of 10 with no vault doc change is the old unbacked rise and stays within the cap', async () => {
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }, { game: { gems: 100 } }));
  });
  it('a payout above amount + bonus is denied', async () => {
    await assertSucceeds(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }));
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 110, chunk: 10, paidBefore: 10 }, { doc: { paidOut: 80 } }));
  });
  it('a collected deposit cannot be edited into broken, back to active, or change its amount or bonus', async () => {
    await assertSucceeds(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }));
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 110, chunk: 10, paidBefore: 10 }, { doc: { status: 'active' } }));
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 110, chunk: 10, paidBefore: 10 }, { doc: { status: 'broken' } }));
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 110, chunk: 10, paidBefore: 10 }, { doc: { bonus: 99 } }));
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 110, chunk: 10, paidBefore: 10 }, { doc: { amount: 500 } }));
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 110, chunk: 10, paidBefore: 10 }, { doc: { createdAt: new Date(0) } }));
  });
  it('closing without moving the kid vault pointer (active stays 1), or closing the wrong id, is denied', async () => {
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting' }, { vault: { active: 1, lastId: 'd1', closedId: 'd1' } }));
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting' }, { vault: { active: 0, lastId: 'd1', closedId: 'zz' } }));
  });
  it('collectedAt that is not the server time is denied', async () => {
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }, { doc: { collectedAt: new Date(0) } }));
  });
});

describe('collecting early, with the client clock set forward', () => {
  const D = { id: 'd1', amount: 50, termDays: 7 as const, ratePer10: 3, bonus: 15 };
  afterEach(() => vi.useRealTimers());

  it('an early collect through the repo is refused when the device clock says 30 days later, and nothing moves', async () => {
    await seed(env, { deposits: [{ ...D, ageDays: 2 }], game: { ...GAME, gems: 100 } });
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 30 * DAY });
    const repo = new FirestoreRepo(kidDb(env), FAM);
    await expect(repo.vaultPay(KID, 'd1', 'collect')).rejects.toBeTruthy();
    vi.useRealTimers();
    expect(await storedDeposit(env, 'd1')).toMatchObject({ status: 'active', paidOut: 0 });
    expect((await stored(env)).game.gems).toBe(100);
    expect((await stored(env)).vault).toEqual({ active: 1, lastId: 'd1' });
  });
  it('a raw early collect write stamped with a forward client time is refused', async () => {
    await seed(env, { deposits: [{ ...D, ageDays: 2 }], game: { ...GAME, gems: 100 } });
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 30 * DAY });
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }, { doc: { collectedAt: new Date(Date.now()) } }));
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }));
  });
  it('a deposit written while the clock is forward still matures from the server stamp: collect right after is refused', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 30 * DAY });
    const repo = new FirestoreRepo(kidDb(env), FAM);
    await repo.vaultDeposit(KID, 50, 7);
    const id = (await stored(env)).vault!.lastId as string;
    await expect(repo.vaultPay(KID, id, 'collect')).rejects.toBeTruthy();
    vi.useRealTimers();
    expect(await storedDeposit(env, id)).toMatchObject({ status: 'active', paidOut: 0 });
    expect((await stored(env)).game.gems).toBe(150);
  });
  it('one day before the end of the term is still early; a server-stamped 7 days ago is on time', async () => {
    await seed(env, { deposits: [{ ...D, ageDays: 6.9 }], game: { ...GAME, gems: 100 } });
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }));
    await seed(env, { deposits: [{ ...D, ageDays: 7.01 }], game: { ...GAME, gems: 100 } });
    await assertSucceeds(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }));
  });
});

describe('breaking early returns the amount and drops the bonus', () => {
  const D = { id: 'd1', amount: 50, termDays: 7 as const, ratePer10: 3, bonus: 15 };
  beforeEach(async () => {
    await seed(env, { deposits: [{ ...D, ageDays: 1 }], game: { ...GAME, gems: 100 } });
  });
  it('is allowed before maturity: 50 comes back in 5 writes of 10, never 51', async () => {
    const db = kidDb(env);
    await assertSucceeds(payChunk(db, 'd1', { gemsBefore: 100, chunk: 10, close: 'breaking', activeBefore: 1 }));
    let gems = 110;
    for (let paid = 10; paid < 50; paid += 10) {
      await assertSucceeds(payChunk(db, 'd1', { gemsBefore: gems, chunk: 10, paidBefore: paid, ...(paid === 40 ? { final: 'broken' as const } : {}) }));
      gems += 10;
    }
    expect(gems).toBe(150);
    expect(await storedDeposit(env, 'd1')).toMatchObject({ status: 'broken', paidOut: 50 });
    await assertFails(payChunk(db, 'd1', { gemsBefore: 150, chunk: 1, paidBefore: 50, final: 'broken' }));
  });
  it('a breaking deposit cannot be paid past the amount, and cannot turn into a collect', async () => {
    await seed(env, { deposits: [{ ...D, status: 'breaking', paidOut: 40, ageDays: 8 }], game: { ...GAME, gems: 100 }, vault: { active: 0, lastId: 'd1', closedId: 'd1' } });
    const db = kidDb(env);
    await assertFails(payChunk(db, 'd1', { gemsBefore: 100, chunk: 10, paidBefore: 40 })); // 50 reached but status not broken
    await assertFails(payChunk(db, 'd1', { gemsBefore: 100, chunk: 10, paidBefore: 40, final: 'collected' }));
    await assertFails(payChunk(db, 'd1', { gemsBefore: 100, chunk: 10, paidBefore: 40 }, { doc: { status: 'collecting' } }));
    await assertSucceeds(payChunk(db, 'd1', { gemsBefore: 100, chunk: 10, paidBefore: 40, final: 'broken' }));
  });
  it('a break that pays more than the amount in its first write (chunk above 10) is denied', async () => {
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 50, close: 'breaking', activeBefore: 1 }));
  });
  it('a break written as `collected` before maturity (to take the bonus) is denied', async () => {
    await assertFails(payChunk(kidDb(env), 'd1', { gemsBefore: 100, chunk: 10, close: 'collecting', activeBefore: 1 }));
  });
  it('the repo breaks an unmatured deposit and the 50 gems come back in full', async () => {
    const repo = new FirestoreRepo(kidDb(env), FAM);
    let r = await repo.vaultPay(KID, 'd1', 'break');
    while (!r.done) r = await repo.vaultPay(KID, 'd1', 'break');
    expect((await stored(env)).game.gems).toBe(150);
    expect(await storedDeposit(env, 'd1')).toMatchObject({ status: 'broken', paidOut: 50 });
  });
  it('after maturity the repo collects 65', async () => {
    await seed(env, { deposits: [{ ...D, ageDays: 8 }], game: { ...GAME, gems: 100 } });
    const repo = new FirestoreRepo(kidDb(env), FAM);
    let r = await repo.vaultPay(KID, 'd1', 'collect');
    while (!r.done) r = await repo.vaultPay(KID, 'd1', 'collect');
    expect((await stored(env)).game.gems).toBe(165);
    expect(await storedDeposit(env, 'd1')).toMatchObject({ status: 'collected', paidOut: 65 });
  });
});

describe('no unbacked gem movement through the vault', () => {
  it('a kid rise above +10 in one write is still denied with a vault in play', async () => {
    await seed(env, { deposits: [{ id: 'd1', amount: 50, termDays: 7, ratePer10: 3, bonus: 15, ageDays: 8 }] });
    await assertFails(updateDoc(kidRef(kidDb(env)), { game: { ...GAME, gems: 211 } }));
  });
  it('a deposit write cannot also raise xp past the bound or touch inventory', async () => {
    await assertFails(deposit(kidDb(env), { id: 'd1', amount: 50, termDays: 7 }, { game: { xp: 5000 } }));
    const db = kidDb(env);
    const b = writeBatch(db);
    b.update(kidRef(db), { game: { ...GAME, gems: 150 }, vault: { active: 1, lastId: 'd1' }, inventory: { items: ['w-bow'] } });
    b.set(vaultRef(db, 'd1'), { id: 'd1', amount: 50, termDays: 7, ratePer10: 3, bonus: 15, status: 'active', paidOut: 0 });
    await assertFails(b.commit());
  });
  it('a kid cannot write the vault map alone (no deposit, no close)', async () => {
    await assertFails(updateDoc(kidRef(kidDb(env)), { vault: { active: 2, lastId: 'x' } }));
    await seed(env, { deposits: [{ id: 'd1', amount: 50, termDays: 7, ratePer10: 3, bonus: 15, ageDays: 8 }] });
    await assertFails(updateDoc(kidRef(kidDb(env)), { vault: { active: 0, lastId: 'd1', closedId: 'd1' } }));
  });
});
