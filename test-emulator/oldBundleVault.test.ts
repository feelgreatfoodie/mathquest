import { assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { GAME, KID, FAM, kidDb, kidRef, newEnv, seed, stored, storedDeposit } from './vaultHelpers';

// Old-shape guard, written first. A bundle cached on an iPad from before the vault writes `game` and nothing else. Vault
// state lives outside `game` (the kid doc's `vault` map and the vault/ subcollection), so that write stays valid for a
// kid who has a vault, and it leaves the vault as it was. Every name, id and number is made up.
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await newEnv('demo-mathquest-vault-old');
});
afterAll(async () => env.cleanup());

const DEPOSITS = [
  { id: 'd1', amount: 50, termDays: 7 as const, ratePer10: 3, bonus: 15, ageDays: 2 },
  { id: 'd2', amount: 30, termDays: 3 as const, ratePer10: 1, bonus: 3, ageDays: 1 },
];
beforeEach(async () => {
  await seed(env, { deposits: DEPOSITS, game: { ...GAME, gems: 120 } });
});

describe('a pre-vault bundle writes game for a kid with a vault', () => {
  it('a run write (game only, no vault key) is accepted and the vault map and both deposits are unchanged', async () => {
    const before = await stored(env);
    await assertSucceeds(updateDoc(kidRef(kidDb(env)), { game: { ...GAME, gems: 127, xp: 520, bestCombo: 20 } }));
    const after = await stored(env);
    expect(after.game.gems).toBe(127);
    expect(after.vault).toEqual(before.vault);
    expect(await storedDeposit(env, 'd1')).toMatchObject({ amount: 50, status: 'active', paidOut: 0 });
    expect(await storedDeposit(env, 'd2')).toMatchObject({ amount: 30, status: 'active', paidOut: 0 });
  });
  it('a hero equip write through the repo (game only) is accepted and the vault is unchanged', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(kidRef(ctx.firestore()), { game: { ...GAME, gems: 120, heroes: ['knight', 'wizard'] } });
    });
    const before = await stored(env);
    const repo = new FirestoreRepo(kidDb(env), FAM);
    await assertSucceeds(repo.applyGameDelta(KID, { equip: 'wizard' }));
    const after = await stored(env);
    expect(after.game.hero).toBe('wizard');
    expect(after.vault).toEqual(before.vault);
  });
  it('a new-bundle run write through the repo leaves the vault map as it was', async () => {
    const before = await stored(env);
    const repo = new FirestoreRepo(kidDb(env), FAM);
    await assertSucceeds(repo.applyGameDelta(KID, { xp: 60, gems: 5, bestCombo: 9, playedAt: Date.now() }));
    const after = await stored(env);
    expect(after.game.xp).toBe(527);
    expect(after.vault).toEqual(before.vault);
  });
});
