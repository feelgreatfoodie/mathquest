import { readFileSync } from 'node:fs';
import { assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// An old bundle (still cached on an iPad) writes `game` with no items, no equipped and no goal, and no inventory key.
// For a kid who owns shop items, that save must be accepted and must leave the kid's items as they were. Old
// bundles never touch the item fields, so the items live outside `game`. Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidaaaa';

let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidRef = (db: ReturnType<typeof kidDb>) => doc(db, `families/${FAM}/kids/${KID}`);

const OLD_GAME = { lastPlayedDay: '2026-11-17', xp: 467, gems: 200, heroes: ['knight', 'wizard'], bestCombo: 16, hero: 'wizard', streakDays: 1 };
const ITEMS = ['w-bow', 'g-helm'];
const EQUIPPED = { weapon: 'w-bow' };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-oldbundle', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    // The kid owns two items. The items sit in the shape of the head under test: the commit before the rework kept
    // them in game.items, the reworked head keeps them in the top-level inventory. Both are seeded so one test file
    // runs on both heads. On the reworked head a stray game.items is ignored.
    await setDoc(kidRef(db), {
      id: KID, name: 'Testkid', createdAt: 1, hasPin: true,
      settings: { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } },
      game: { ...OLD_GAME, items: ITEMS, equipped: EQUIPPED },
      inventory: { items: ITEMS, equipped: EQUIPPED },
    });
  });
});

const itemsOf = async () => {
  const d = (await getDoc(kidRef(parentDb()))).data() as { inventory?: { items?: string[]; equipped?: unknown } };
  return d.inventory;
};

describe('an old-shape game write from a kid who owns items', () => {
  it('is accepted (a run: xp and gems up, no items, no equipped, no inventory key) and the items are unchanged', async () => {
    const db = kidDb();
    await assertSucceeds(updateDoc(kidRef(db), { game: { ...OLD_GAME, xp: 500, gems: 207 } }));
    expect(await itemsOf()).toEqual({ items: ITEMS, equipped: EQUIPPED });
  });
  it('is accepted as a game-only update, and the saved game has the new xp', async () => {
    const db = kidDb();
    await assertSucceeds(updateDoc(kidRef(db), { game: { ...OLD_GAME, xp: 520, gems: 205, bestCombo: 20 } }));
    const d = (await getDoc(kidRef(parentDb()))).data() as { game: { xp: number } };
    expect(d.game.xp).toBe(520);
    expect(await itemsOf()).toEqual({ items: ITEMS, equipped: EQUIPPED });
  });
  it('is accepted when the same write buys a hero (the old path), and the items are unchanged', async () => {
    const db = kidDb();
    const b2 = writeBatch(db);
    b2.update(kidRef(db), { game: { ...OLD_GAME, gems: 165, heroes: ['knight', 'wizard', 'ranger'], hero: 'ranger', lastPurchaseId: 'p2' } });
    b2.set(doc(db, `families/${FAM}/kids/${KID}/purchases/p2`), { id: 'p2', heroId: 'ranger', cost: 35, at: 1000 });
    await assertSucceeds(b2.commit());
    expect(await itemsOf()).toEqual({ items: ITEMS, equipped: EQUIPPED });
  });
});
