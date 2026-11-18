import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore';

// Shared setup for the vault emulator suites. Every name, id and number is made up. RULES_FILE runs a suite against another rules file.
export const RULES = readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8');
export const FAM = 'fam-parent-uid';
export const KID = 'kidaaaa';
export const DAY = 86_400_000;

export const HEROES = ['knight', 'wizard', 'ranger', 'robot', 'dragon'];
export const GAME = { lastPlayedDay: '2026-11-17', xp: 467, gems: 200, heroes: ['knight'], bestCombo: 16, hero: 'knight', streakDays: 1 };
export const SETTINGS = {
  sessionSize: 30, maxNew: 8, factGroupsUnlocked: 1, paceMultiplier: 3,
  tracks: { facts: true, multidigit: true, fractions: true },
  vault: { on: true },
};

export type Db = Firestore;
export const newEnv = (project: string) => initializeTestEnvironment({ projectId: project, firestore: { rules: RULES } });
export const parentDb = (env: RulesTestEnvironment) => env.authenticatedContext(FAM, { email: 'parent@example.com', email_verified: true }).firestore();
export const kidDb = (env: RulesTestEnvironment) => env.authenticatedContext(`kid_${KID}`, { role: 'kid', familyUid: FAM, kidId: KID }).firestore();
export const kidRef = (db: Db) => doc(db, `families/${FAM}/kids/${KID}`);
export const vaultRef = (db: Db, id: string) => doc(db, `families/${FAM}/kids/${KID}/vault/${id}`);

export interface SeedDeposit {
  id: string;
  amount: number;
  termDays: 3 | 7 | 14;
  ratePer10: number;
  bonus: number;
  status?: 'active' | 'collected' | 'broken';
  paid?: number;
  /** How many days ago the server stamped it. */
  ageDays: number;
}

/** Seeds the family and one kid. `deposits` are written with a server stamp `ageDays` in the past: the emulator's fast-forward. */
export async function seed(
  env: RulesTestEnvironment,
  opts: { game?: Record<string, unknown>; settings?: Record<string, unknown>; deposits?: SeedDeposit[]; inventory?: Record<string, unknown>; vault?: Record<string, unknown> } = {},
) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAM}`), { pinHash: 'x', createdAt: 1 });
    await setDoc(doc(db, `parents/${FAM}`), { email: 'parent@example.com', createdAt: 1 });
    const deposits = opts.deposits ?? [];
    const active = deposits.filter((d) => (d.status ?? 'active') === 'active').length;
    await setDoc(kidRef(db), {
      id: KID, name: 'Testkid', createdAt: 1, hasPin: true,
      settings: opts.settings ?? SETTINGS,
      game: opts.game ?? GAME,
      ...(opts.inventory ? { inventory: opts.inventory } : {}),
      ...(opts.vault ? { vault: opts.vault } : deposits.length ? { vault: { active, lastId: deposits[deposits.length - 1]!.id } } : {}),
    });
    for (const d of deposits) {
      const { ageDays, ...rest } = d;
      await setDoc(vaultRef(db, d.id), { ...rest, status: d.status ?? 'active', paid: d.paid ?? 0, createdAt: Timestamp.fromMillis(Date.now() - ageDays * DAY) });
    }
  });
}

/** Reads with the rules off, so a check of stored state does not depend on the rules under test. */
async function read<T>(env: RulesTestEnvironment, path: string): Promise<T | undefined> {
  let out: T | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = (await getDoc(doc(ctx.firestore(), path))).data() as T | undefined;
  });
  return out;
}
export const stored = async (env: RulesTestEnvironment) => (await read<{ game: Record<string, number>; vault?: Record<string, unknown>; inventory?: Record<string, unknown> }>(env, `families/${FAM}/kids/${KID}`))!;
export const storedDeposit = (env: RulesTestEnvironment, id: string) => read<Record<string, unknown>>(env, `families/${FAM}/kids/${KID}/vault/${id}`);

export interface NewDeposit { id: string; amount: number; termDays: number; ratePer10?: number; bonus?: number }
const DEFAULT_RATE: Record<number, number> = { 3: 1, 7: 3, 14: 7 };

/** A deposit as the client writes it: gems drop by `amount`, the vault pointer moves, the deposit doc is created. */
export function deposit(db: Db, d: NewDeposit, over: { game?: Record<string, unknown>; vault?: Record<string, unknown>; doc?: Record<string, unknown>; gemsBefore?: number; activeBefore?: number } = {}) {
  const rate = d.ratePer10 ?? DEFAULT_RATE[d.termDays]!;
  const gemsBefore = over.gemsBefore ?? GAME.gems;
  const b = writeBatch(db);
  b.update(kidRef(db), {
    game: { ...GAME, gems: gemsBefore - d.amount, ...(over.game ?? {}) },
    vault: over.vault ?? { active: (over.activeBefore ?? 0) + 1, lastId: d.id },
  });
  b.set(vaultRef(db, d.id), {
    id: d.id, amount: d.amount, termDays: d.termDays, ratePer10: rate, bonus: d.bonus ?? Math.floor(d.amount / 10) * rate,
    status: 'active', paid: 0, createdAt: serverTimestamp(), ...(over.doc ?? {}),
  });
  return b.commit();
}

/**
 * One payout chunk as the client writes it: gems rise by `chunk`, the vault doc's `paid` rises by `chunk`. The first chunk
 * also closes the deposit (status, collectedAt, the kid's vault pointer).
 */
export function payChunk(
  db: Db,
  id: string,
  p: { gemsBefore: number; chunk: number; paidBefore?: number; close?: 'collected' | 'broken'; activeBefore?: number; lastId?: string },
  over: { game?: Record<string, unknown>; vault?: Record<string, unknown>; doc?: Record<string, unknown> } = {},
) {
  const b = writeBatch(db);
  const paid = (p.paidBefore ?? 0) + p.chunk;
  b.update(kidRef(db), {
    game: { ...GAME, gems: p.gemsBefore + p.chunk, ...(over.game ?? {}) },
    ...(p.close ? { vault: over.vault ?? { active: (p.activeBefore ?? 1) - 1, lastId: p.lastId ?? id, closedId: id } } : over.vault ? { vault: over.vault } : {}),
  });
  b.update(vaultRef(db, id), { paid, ...(p.close ? { status: p.close, collectedAt: serverTimestamp() } : {}), ...(over.doc ?? {}) });
  return b.commit();
}
