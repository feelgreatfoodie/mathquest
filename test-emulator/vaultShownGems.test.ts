import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { FAM, KID, kidDb, newEnv, seed, stored } from './vaultHelpers';

// 2026-11-26: a pre-reader broke a 10-gem deposit and put 10 back in 1.6 s. The server held 53, the screen showed 63, and the
// shop refused a 60-gem item. The app keeps one live listener on the kid doc (the pause, watchKid). The read after each vault
// write must show what the server stored, not what that listener last saw.
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await newEnv('demo-mathquest-vault-shown');
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await seed(env);
});

describe('the gems a vault write returns', () => {
  it('are the stored gems after a break and a quick deposit, with the pause listener open', async () => {
    const repo = new FirestoreRepo(kidDb(env), FAM);
    let seen = 0;
    const first = new Promise<void>((res) => {
      const off = repo.watchKid(KID, () => {
        seen++;
        res();
      });
      offs.push(off);
    });
    await first;
    const start = (await stored(env)).game.gems;
    await repo.vaultDeposit(KID, 10, 3);
    const dep = (await repo.listVault(KID, 5))[0]!;
    // What the screen shows: the game each transaction returns, and getKid (server first) after it.
    const paid = await repo.vaultPay(KID, dep.id, 'break');
    expect(paid.game.gems).toBe((await stored(env)).game.gems);
    expect((await repo.getKid(KID))!.game.gems).toBe(start);
    const after = await repo.vaultDeposit(KID, 10, 3);
    expect(after.gems).toBe(start - 10);
    expect((await stored(env)).game.gems).toBe(start - 10);
    expect((await repo.getKid(KID))!.game.gems).toBe(start - 10);
    expect(seen).toBeGreaterThan(0);
  });
});
const offs: Array<() => void> = [];
afterAll(() => offs.forEach((f) => f()));
