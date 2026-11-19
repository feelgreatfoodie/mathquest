import { readFileSync } from 'node:fs';
import { assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addChest, lifetimeChests } from '../src/engine/chestLedger';
import { fromDoc, newWorld, toDoc, worldReducer } from '../src/game/overworld/worldState';

// Chests every trip changes no rule. The per-trip chest state lives on the device with the trip, and the lifetime count is one
// "#<n>" marker inside openedChests, which the rules already take (a list of at most 500). At the live minVersion an older
// bundle still writes its own 9-field world doc. Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidchests00001';
const MIN_VERSION = 1794971970;

let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const worldRef = () => doc(kidDb(), `families/${FAM}/kids/${KID}/world/main`);
const storedWorld = async () => {
  let data: unknown;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore(), `families/${FAM}/kids/${KID}/world/main`))).data();
  });
  return data;
};

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-chests', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, 'config/app'), { minVersion: MIN_VERSION });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}`), { id: KID, name: 'Testkid', createdAt: 1, hasPin: true, settings: { sessionSize: 30, maxNew: 4, factGroupsUnlocked: 1, paceMultiplier: 1, tracks: { facts: true, multidigit: false, fractions: false }, modes: { overworld: true } }, game: { lastPlayedDay: '2026-11-17', xp: 1, gems: 5, heroes: ['knight'], bestCombo: 1, hero: 'knight', streakDays: 1 } });
  });
});

describe('chest ledger and keys at minVersion 1794971970', () => {
  it('a new bundle saves a world with the "#n" marker, a key and the old card ids: accepted unchanged', async () => {
    let w = { ...newWorld(1000), openedChests: ['mul:6x7'] };
    w = worldReducer(worldReducer(w, { t: 'chest' }), { t: 'key' }, 2000);
    await assertSucceeds(setDoc(worldRef(), toDoc(w)));
    expect(await storedWorld()).toEqual(toDoc(w));
    expect(lifetimeChests((await storedWorld() as { openedChests: string[] }).openedChests)).toBe(2);
  });
  it('an older bundle writes its 9-field world over a doc with the marker: accepted, and the count is not paid twice', async () => {
    const w = worldReducer({ ...newWorld(1000), openedChests: [] }, { t: 'chest' }, 1500);
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `families/${FAM}/kids/${KID}/world/main`), toDoc(w)));
    // The older bundle read the doc (marker and all), moved the hero and appended a card id when it opened a chest.
    const old = { ...toDoc(w), x: 9, y: 9, openedChests: [...w.openedChests, 'mul:6x8'], updatedAt: 3000 };
    await assertSucceeds(setDoc(worldRef(), old));
    const back = fromDoc(await storedWorld(), 4000);
    expect(back.openedChests).toEqual(['#1', 'mul:6x8']);
    // Counting what is stored never adds a chest: reading it twice gives the same number.
    expect(lifetimeChests(back.openedChests)).toBe(2);
    expect(lifetimeChests(fromDoc(await storedWorld(), 5000).openedChests)).toBe(2);
  });
  it('a full list of 500 old card ids plus one more chest still fits: the oldest ids fold into the marker', async () => {
    const full = Array.from({ length: 500 }, (_, i) => `c${i}`);
    const w = { ...newWorld(1000), openedChests: addChest(full) };
    expect(w.openedChests.length).toBeLessThanOrEqual(500);
    await assertSucceeds(setDoc(worldRef(), toDoc(w)));
    await assertSucceeds(updateDoc(worldRef(), { openedChests: addChest(w.openedChests), keys: 1 }));
    expect(lifetimeChests((await storedWorld() as { openedChests: string[] }).openedChests)).toBe(502);
  });
});
