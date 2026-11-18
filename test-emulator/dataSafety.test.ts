import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreRepo } from '../src/data/firestoreRepo';
import { normalizeKid, type Kid, type KidSettings } from '../src/engine/models';

// Every name, id and number below is made up. RULES_FILE runs the suite against another rules file.
// The scenarios go through the adapters at the bottom. On the data-safety build they call the new
// Repo methods. On main (no such methods) they make the same full-document writes the screens made,
// so the same file shows which scenarios fail on main.
const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
const FAM = 'fam-parent-uid';
const KID = 'kidaaaa';

let env: RulesTestEnvironment;
const parentDb = () => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
const kidDb = () => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
const kidRef = (db: ReturnType<typeof parentDb>) => doc(db, `families/${FAM}/kids/${KID}`);

// The shape of a real stored doc: no `learner`, no `modules`, hasPin set, keys in no particular order.
const STORED_SETTINGS = { sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3, tracks: { facts: true, multidigit: true, fractions: true } };
const storedKid = (over: Record<string, unknown> = {}) => ({
  id: KID,
  name: 'Testkid',
  createdAt: 1,
  hasPin: true,
  settings: STORED_SETTINGS,
  game: { lastPlayedDay: '2026-11-17', xp: 467, gems: 86, heroes: ['knight', 'wizard'], bestCombo: 16, hero: 'wizard', streakDays: 1 },
  ...over,
});

// A drop is legal only in the write that creates its one purchases doc (see test-emulator/gemDrops.test.ts).
const buyBatch = (db: ReturnType<typeof kidDb>, game: Record<string, unknown>, id: string, heroId: string, cost: number) => {
  const b = writeBatch(db);
  b.update(kidRef(db), { game: { ...storedKid().game, ...game, lastPurchaseId: id } });
  b.set(doc(db, `families/${FAM}/kids/${KID}/purchases/${id}`), { id, heroId, cost, at: 1000 });
  return b.commit();
};

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mathquest', firestore: { rules: RULES } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(kidRef(db), storedKid());
    await setDoc(doc(db, `families/${FAM}/kids/${KID}/cards/mul:2x3`), { id: 'mul:2x3', attempts: 3 });
    await setDoc(doc(db, `families/${FAM}/kids/${KID}/sessions/s1`), { id: 's1', xp: 5 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
  });
});

const parentRepo = () => new FirestoreRepo(parentDb(), FAM);
const kidRepo = () => new FirestoreRepo(kidDb(), FAM);
const stored = async () => (await getDoc(kidRef(parentDb()))).data() as Kid;

describe('two clients at once', () => {
  it('a parent settings save after a finished run keeps the run (stale parent copy)', async () => {
    const parent = parentRepo();
    const staleParentCopy = (await parent.getKid(KID))!; // the parent area opens here
    await finishRun(kidRepo(), (await kidRepo().getKid(KID))!, { xp: 100, gems: 9, bestCombo: 20 });
    await saveSettings(parent, staleParentCopy, { ...STORED_SETTINGS, learner: 'prereader' });
    const doc1 = await stored();
    expect(doc1.game.xp).toBe(567);
    expect(doc1.game.gems).toBe(95);
    expect(doc1.game.bestCombo).toBe(20);
    expect(doc1.settings.learner).toBe('prereader');
  });

  it('a run that finishes after the parent changed settings still writes game (stale kid copy)', async () => {
    const kid = kidRepo();
    const staleKidCopy = (await kid.getKid(KID))!; // the kid's screen holds this
    await saveSettings(parentRepo(), (await parentRepo().getKid(KID))!, { ...STORED_SETTINGS, learner: 'prereader' });
    await finishRun(kid, staleKidCopy, { xp: 50, gems: 4, bestCombo: 3 });
    const doc1 = await stored();
    expect(doc1.game.xp).toBe(517);
    expect(doc1.game.gems).toBe(90);
    expect(doc1.settings.learner).toBe('prereader');
  });

  it('setting a PIN flag from a stale parent copy keeps the run', async () => {
    const parent = parentRepo();
    const staleParentCopy = (await parent.getKid(KID))!;
    await finishRun(kidRepo(), (await kidRepo().getKid(KID))!, { xp: 30, gems: 2, bestCombo: 1 });
    await setPinFlag(parent, staleParentCopy);
    const doc1 = await stored();
    expect(doc1.game.xp).toBe(497);
    expect(doc1.game.gems).toBe(88);
    expect(doc1.hasPin).toBe(true);
  });

  it('two devices finish runs from the same starting copy and both runs count', async () => {
    const a = kidRepo();
    const b = kidRepo();
    const copyA = (await a.getKid(KID))!;
    const copyB = (await b.getKid(KID))!;
    await finishRun(a, copyA, { xp: 10, gems: 1, bestCombo: 2 });
    await finishRun(b, copyB, { xp: 20, gems: 2, bestCombo: 3 });
    const doc1 = await stored();
    expect(doc1.game.xp).toBe(497);
    expect(doc1.game.gems).toBe(89);
  });
});

describe('the learner switch', () => {
  it('changes settings only: game, cards and sessions are the same after a round trip', async () => {
    const parent = parentRepo();
    const before = { game: (await stored()).game, cards: await dump('cards'), sessions: await dump('sessions') };
    const copy = (await parent.getKid(KID))!;
    await saveSettings(parent, copy, { ...copy.settings, learner: 'prereader', modules: { add10: true } });
    expect((await stored()).settings.learner).toBe('prereader');
    const copy2 = (await parent.getKid(KID))!;
    await saveSettings(parent, copy2, { ...copy2.settings, learner: 'reader' });
    const after = { game: (await stored()).game, cards: await dump('cards'), sessions: await dump('sessions') };
    expect((await stored()).settings.learner).toBe('reader');
    expect(after).toEqual(before);
  });
});

describe('hero purchase', () => {
  it('two devices buying the same hero: it is bought once and gems drop once', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(kidRef(ctx.firestore()), { game: { ...(storedKid().game), gems: 40, heroes: ['knight'], hero: 'knight' } });
    });
    const a = kidRepo();
    const b = kidRepo();
    const copyA = (await a.getKid(KID))!;
    const copyB = (await b.getKid(KID))!;
    const results = await Promise.allSettled([buy(a, copyA, 'wizard'), buy(b, copyB, 'wizard')]);
    const doc1 = await stored();
    expect(doc1.game.gems).toBe(25);
    expect(doc1.game.heroes.filter((h) => h === 'wizard')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('a purchase and a finishing run both count', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(kidRef(ctx.firestore()), { game: { ...(storedKid().game), gems: 40, heroes: ['knight'], hero: 'knight' } });
    });
    const shop = kidRepo();
    const runner = kidRepo();
    const shopCopy = (await shop.getKid(KID))!;
    const runCopy = (await runner.getKid(KID))!;
    await finishRun(runner, runCopy, { xp: 60, gems: 6, bestCombo: 5 });
    await buy(shop, shopCopy, 'wizard');
    const doc1 = await stored();
    expect(doc1.game.gems).toBe(31); // 40 + 6 - 15
    expect(doc1.game.xp).toBe(527);
    expect(doc1.game.heroes).toContain('wizard');
  });
});

describe('gems drop guard in the rules', () => {
  const withGame = (g: Record<string, unknown>) => ({ ...storedKid().game, ...g });
  const setGems = async (gems: number) =>
    env.withSecurityRulesDisabled(async (ctx) => updateDoc(kidRef(ctx.firestore()), { game: withGame({ gems }) }));

  it('denies a kid or a parent write that drops gems by more than the dearest hero without a new hero', async () => {
    await setGems(250);
    await assertFails(updateDoc(kidRef(kidDb()), { game: withGame({ gems: 10 }) }));
    await assertFails(updateDoc(kidRef(parentDb()), { game: withGame({ gems: 10 }) }));
    await assertFails(updateDoc(kidRef(kidDb()), { game: withGame({ gems: 149 }) })); // a drop of 101
    await assertFails(updateDoc(kidRef(kidDb()), { game: {} }));
  });

  it('denies a drop of exactly 100, and a drop that grows the hero list, without a purchases doc', async () => {
    await setGems(250);
    await assertFails(updateDoc(kidRef(kidDb()), { game: withGame({ gems: 150 }) }));
    await assertFails(updateDoc(kidRef(kidDb()), { game: withGame({ gems: 150, heroes: ['knight', 'wizard', 'dragon'] }) }));
    await assertFails(updateDoc(kidRef(parentDb()), { game: withGame({ gems: 150, heroes: ['knight', 'wizard', 'ranger'] }) }));
  });

  it('allows a drop that grows the hero list with its purchases doc, for the kid and the parent', async () => {
    await setGems(250);
    await assertSucceeds(buyBatch(kidDb(), { gems: 150, heroes: ['knight', 'wizard', 'dragon'], hero: 'dragon' }, 'pd', 'dragon', 100));
    await setGems(250);
    await assertSucceeds(buyBatch(parentDb(), { gems: 215, heroes: ['knight', 'wizard', 'ranger'], hero: 'ranger' }, 'pr', 'ranger', 35));
  });

  it('allows earning gems and writing settings with game unchanged', async () => {
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: withGame({ gems: 120 }) }));
    await assertSucceeds(updateDoc(kidRef(parentDb()), { settings: { ...STORED_SETTINGS, sessionSize: 20 } }));
  });
});

describe('monotonic game guards in the rules', () => {
  const withGame = (g: Record<string, unknown>) => ({ ...storedKid().game, ...g });
  const seed = async (g: Record<string, unknown>) =>
    env.withSecurityRulesDisabled(async (ctx) => updateDoc(kidRef(ctx.firestore()), { game: withGame(g) }));
  const clients = [['parent', parentDb] as const, ['kid', kidDb] as const];

  for (const [who, db] of clients) {
    it(`denies an xp decrease from the ${who} (1363 to 467)`, async () => {
      await seed({ xp: 1363 });
      await assertFails(updateDoc(kidRef(db()), { game: withGame({ xp: 467 }) }));
      await assertFails(updateDoc(kidRef(db()), { game: withGame({ xp: 1362 }) }));
      expect((await stored()).game.xp).toBe(1363);
    });

    it(`denies a bestCombo decrease from the ${who}`, async () => {
      await seed({ bestCombo: 30 });
      await assertFails(updateDoc(kidRef(db()), { game: withGame({ bestCombo: 16 }) }));
      await assertFails(updateDoc(kidRef(db()), { game: withGame({ bestCombo: 29 }) }));
    });

    it(`denies dropping a hero from the ${who}`, async () => {
      await assertFails(updateDoc(kidRef(db()), { game: withGame({ heroes: ['knight'] }) }));
      await assertFails(updateDoc(kidRef(db()), { game: withGame({ heroes: ['knight', 'dragon'] }) })); // swap
      await assertFails(updateDoc(kidRef(db()), { game: withGame({ heroes: [] }) }));
    });

    it(`allows a normal run, equal values and a hero purchase from the ${who}`, async () => {
      await assertSucceeds(updateDoc(kidRef(db()), { game: withGame({ xp: 500, bestCombo: 20, gems: 90 }) }));
      await assertSucceeds(updateDoc(kidRef(db()), { game: withGame({ xp: 500, bestCombo: 20, gems: 90 }) })); // no change
      await assertSucceeds(
        buyBatch(db(), { xp: 500, bestCombo: 20, gems: 55, heroes: ['knight', 'wizard', 'ranger'], hero: 'ranger' }, 'pr', 'ranger', 35),
      );
    });
  }

  it('reads a missing xp, bestCombo or heroes as 0 or empty, so a game {} doc can be filled', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => updateDoc(kidRef(ctx.firestore()), { game: {} }));
    await assertSucceeds(updateDoc(kidRef(kidDb()), { game: { xp: 10, bestCombo: 2, gems: 1, heroes: ['knight'], hero: 'knight' } }));
  });

  it('applyGameDelta still passes for a run, a purchase and a retry', async () => {
    const kid = kidRepo() as unknown as { applyGameDelta?: (id: string, d: object, o?: object) => Promise<unknown> };
    await seed({ gems: 40, heroes: ['knight'], hero: 'knight' });
    await finishRun(kidRepo(), (await kidRepo().getKid(KID))!, { xp: 60, gems: 6, bestCombo: 5 });
    await buy(kidRepo(), (await kidRepo().getKid(KID))!, 'wizard');
    expect(kid.applyGameDelta).toBeTypeOf('function');
    const after = (await stored()).game;
    expect(after.xp).toBe(527);
    expect(after.bestCombo).toBe(16);
    expect(after.heroes).toEqual(['knight', 'wizard']);
  });

  it('an Admin write (rules disabled) can still reset xp, for support', async () => {
    await seed({ xp: 0, bestCombo: 0, heroes: ['knight'] });
    expect((await stored()).game.xp).toBe(0);
  });
});

describe('kid-token run after normalization still writes game', () => {
  it('a kid loads the doc through normalizeKid and a run writes game, leaving every other key as stored', async () => {
    const before = await stored();
    const kid = kidRepo();
    const loaded = (await kid.getKid(KID))!;
    expect(loaded.settings).toEqual(before.settings); // normalizing touches game only
    await finishRun(kid, loaded, { xp: 40, gems: 3, bestCombo: 17 });
    const after = await stored();
    expect(after.game.xp).toBe(507);
    expect(after.game.bestCombo).toBe(17);
    expect({ ...after, game: null }).toEqual({ ...before, game: null });
  });

  it('a doc with game {} (fields missing) gets a normalized game on the first run', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => updateDoc(kidRef(ctx.firestore()), { game: {} }));
    const kid = kidRepo();
    const loaded = normalizeKid((await kid.getKid(KID))!);
    await finishRun(kid, loaded, { xp: 25, gems: 2, bestCombo: 4 });
    const after = await stored();
    expect(after.game).toMatchObject({ xp: 25, gems: 2, bestCombo: 4, hero: 'knight', heroes: ['knight'] });
  });
});

describe('repo contract', () => {
  it('createKid refuses an id that exists', async () => {
    const repo = parentRepo() as unknown as { createKid?: (k: Kid) => Promise<void> };
    if (!repo.createKid) return; // main has no createKid: saveKid replaces a stored kid
    await expect(repo.createKid(storedKid() as unknown as Kid)).rejects.toThrow();
    expect((await stored()).game.xp).toBe(467);
  });

  it('a settings save for a removed kid fails and does not bring the kid back', async () => {
    const repo = parentRepo() as unknown as { saveKidSettings?: (id: string, s: KidSettings) => Promise<void> };
    if (!repo.saveKidSettings) return; // main: setDoc recreates the doc
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { deleteDoc } = await import('firebase/firestore');
      await deleteDoc(kidRef(ctx.firestore()));
    });
    await expect(repo.saveKidSettings(KID, STORED_SETTINGS as KidSettings)).rejects.toThrow();
    expect((await getDoc(kidRef(parentDb()))).exists()).toBe(false);
  });

  it('a run retried after it already landed counts once', async () => {
    const kid = kidRepo() as unknown as { applyGameDelta?: (id: string, d: object, o: object) => Promise<unknown> };
    if (!kid.applyGameDelta) return; // main has no delta write
    const session = { id: 'run-1', startedAt: 1, endedAt: 2, answered: 1, graded: 1, correct: 1, fast: 0, newLearned: 0, medianMs: 1, xp: 10, gems: 1, bestCombo: 1, missed: [] };
    const delta = { xp: 10, gems: 1, bestCombo: 1, playedAt: Date.parse('2026-11-18T00:00:00Z') };
    await kid.applyGameDelta(KID, delta, { session });
    await kid.applyGameDelta(KID, delta, { session });
    expect((await stored()).game.xp).toBe(477);
    const logs = await getDocs(collection(kidDb(), `families/${FAM}/kids/${KID}/sessions`));
    expect(logs.docs.filter((d) => d.id === 'run-1')).toHaveLength(1);
  });
});

// ---- adapters: the new Repo methods when they exist, else main's full-document writes ----

interface Delta {
  xp: number;
  gems: number;
  bestCombo: number;
}
interface Loose {
  applyGameDelta?: (kidId: string, delta: object, opts?: object) => Promise<unknown>;
  saveKidSettings?: (kidId: string, s: KidSettings) => Promise<void>;
  setKidFlags?: (kidId: string, f: { hasPin?: boolean }) => Promise<void>;
  saveKid?: (k: Kid) => Promise<void>;
}

async function finishRun(repo: FirestoreRepo, copy: Kid, d: Delta): Promise<void> {
  const r = repo as unknown as Loose;
  if (r.applyGameDelta) {
    await r.applyGameDelta(KID, { ...d, playedAt: Date.parse('2026-11-18T00:00:00Z') });
    return;
  }
  const g = copy.game;
  await r.saveKid!({ ...copy, game: { ...g, xp: g.xp + d.xp, gems: g.gems + d.gems, bestCombo: Math.max(g.bestCombo, d.bestCombo), lastPlayedDay: '2026-11-18' } });
}

async function saveSettings(repo: FirestoreRepo, copy: Kid, settings: KidSettings): Promise<void> {
  const r = repo as unknown as Loose;
  if (r.saveKidSettings) return r.saveKidSettings(KID, settings);
  return r.saveKid!({ ...copy, settings });
}

async function setPinFlag(repo: FirestoreRepo, copy: Kid): Promise<void> {
  const r = repo as unknown as Loose;
  if (r.setKidFlags) return r.setKidFlags(KID, { hasPin: true });
  return r.saveKid!({ ...copy, hasPin: true });
}

async function buy(repo: FirestoreRepo, copy: Kid, heroId: string): Promise<void> {
  const r = repo as unknown as Loose;
  if (r.applyGameDelta) {
    await r.applyGameDelta(KID, { purchase: heroId });
    return;
  }
  const cost = heroId === 'wizard' ? 15 : 35;
  await r.saveKid!({ ...copy, game: { ...copy.game, gems: copy.game.gems - cost, heroes: [...copy.game.heroes, heroId], hero: heroId } });
}

async function dump(col: 'cards' | 'sessions'): Promise<unknown[]> {
  const snap = await getDocs(collection(parentDb(), `families/${FAM}/kids/${KID}/${col}`));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id));
}
