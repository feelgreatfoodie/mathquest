import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// UX-1 item 9: the picker avatar (hero and color) is a top-level `avatar` map in the kid doc. The parent sets it on
// add and edit only. A kid token cannot write it (affectedKeys stays hasOnly game / game+inventory, so no rules
// change). An old bundle never writes `avatar`: its saves must stay valid and must leave the avatar as it was.
// Every name, id and number is made up.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidaaaa';

let env: RulesTestEnvironment;
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidRef = (db: ReturnType<typeof kidDb>) => doc(db, `families/${FAM}/kids/${KID}`);

const GAME = { lastPlayedDay: '2026-11-17', xp: 467, gems: 200, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1 };
const SETTINGS = { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } };
const AVATAR = { hero: 'wizard', color: 'blue' };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest-avatar', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    await setDoc(kidRef(db), { id: KID, name: 'Testkid', createdAt: 1, hasPin: true, settings: SETTINGS, game: GAME, avatar: AVATAR });
  });
});

const stored = async () => (await getDoc(kidRef(parentDb()))).data() as { avatar?: unknown; game: { xp: number } };

describe('avatar in the kid doc', () => {
  it('an old-shape kid run (game only, no avatar key) is accepted and leaves the avatar as it was', async () => {
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: { ...GAME, xp: 500, gems: 207 } }));
    const d = await stored();
    expect(d.game.xp).toBe(500);
    expect(d.avatar).toEqual(AVATAR);
  });
  it('an old-shape parent settings save (settings only) is accepted and leaves the avatar as it was', async () => {
    await assertSucceeds(updateDoc(kidRef(parentDb()), { settings: { ...SETTINGS, maxNew: 6 } }));
    expect((await stored()).avatar).toEqual(AVATAR);
  });
  it('the parent can create a kid with an avatar and edit it', async () => {
    await assertSucceeds(setDoc(doc(parentDb(), `families/${FAM}/kids/kidnew`), { id: 'kidnew', name: 'Newkid', createdAt: 2, settings: SETTINGS, game: GAME, avatar: { hero: 'dragon', color: 'green' } }));
    await assertSucceeds(updateDoc(kidRef(parentDb()), { avatar: { hero: 'robot', color: 'red' } }));
    expect((await stored()).avatar).toEqual({ hero: 'robot', color: 'red' });
  });
  it('a kid token cannot change its own avatar, alone or next to a run', async () => {
    await assertFails(updateDoc(kidRef(kidDb()), { avatar: { hero: 'dragon', color: 'green' } }));
    await assertFails(updateDoc(kidRef(kidDb()), { game: { ...GAME, xp: 500 }, avatar: { hero: 'dragon', color: 'green' } }));
    expect((await stored()).avatar).toEqual(AVATAR);
  });
});
