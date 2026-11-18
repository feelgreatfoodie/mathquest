import type { GameDelta } from '../engine/game';
import type { WorldState } from '../game/overworld/worldState';
import type { GameModeId } from '../game/modes/types';
import type { VaultDeposit, VaultTerm } from '../game/vault';
import type { CardMap, CardState, Family, Kid, KidAvatar, KidGame, KidSettings, PurchaseLog, SessionLog } from '../engine/models';

/** Storage boundary. Firestore in production; localStorage for offline demos and dev. */
export interface Repo {
  readonly mode: 'firestore' | 'local';
  getFamily(): Promise<Family | null>;
  saveFamily(family: Family): Promise<void>;
  listKids(): Promise<Kid[]>;
  getKid(kidId: string): Promise<Kid | null>;
  /** Creates a kid. Fails when the id exists, so a stale copy can never replace a stored kid. */
  createKid(kid: Kid): Promise<void>;
  /** Writes `settings` and nothing else. Fails when the kid was removed. */
  saveKidSettings(kidId: string, settings: KidSettings): Promise<void>;
  /** Writes the named flags and nothing else. `avatar` is the picker hero and color; only the parent sets it. */
  setKidFlags(kidId: string, flags: { hasPin?: boolean; avatar?: KidAvatar }): Promise<void>;
  /**
   * The only writer of `game`. Reads the stored game inside a transaction, applies the delta and writes
   * `game` back, so a stale screen cannot overwrite newer totals. With `session`, the run's log is written
   * in the same transaction, and a log that is already stored means the delta was already applied (a safe retry).
   * With `checkpoint` (an Adventure trip), `session` is the trip's cumulative log and a stored log does NOT end the write: the transaction
   * reads it, credits only the XP above its `xpCredited`, and merges the log in place. A closed trip (`finished`) takes nothing more.
   * A purchase also writes one purchases-log entry in the same transaction. Returns the game as stored. Throws GameDeltaError when the delta cannot apply.
   */
  applyGameDelta(kidId: string, delta: GameDelta, opts?: { session?: SessionLog; checkpoint?: boolean }): Promise<KidGame>;
  /**
   * Puts `amount` gems in the vault for `termDays` in one transaction: gems drop, the vault pointer moves and the deposit doc is
   * created with the server's time. Throws GameDeltaError when the vault is off, the amount is under 10 or over the gems, or 3 are active.
   */
  vaultDeposit(kidId: string, amount: number, termDays: VaultTerm): Promise<KidGame>;
  /**
   * Pays one chunk (at most 10 gems) of a deposit back and reports it. `collect` takes amount + bonus and the server refuses it
   * before the term ends (server time only). `break` takes the amount back at any time and drops the bonus. A deposit that is
   * already closed ignores `mode` and pays what it still owes. Call it until `done`. A device clock never decides.
   */
  vaultPay(kidId: string, depositId: string, mode: 'collect' | 'break'): Promise<{ paid: number; done: boolean }>;
  /** The kid's deposits, newest first. */
  listVault(kidId: string, max: number): Promise<VaultDeposit[]>;
  /** The purchases log, newest first. Reads the kid's own purchases path only. */
  listPurchases(kidId: string, max: number): Promise<PurchaseLog[]>;
  /**
   * Calls `onKid` with the stored kid now and after every change, from any client. Returns the unsubscribe.
   * `onKid(null)` means the kid was removed. The local repo polls storage every `pollMs` (default 1500).
   */
  watchKid(kidId: string, onKid: (kid: Kid | null) => void, opts?: { onError?: (e: Error) => void; pollMs?: number }): () => void;
  deleteKid(kidId: string): Promise<void>;
  loadCards(kidId: string): Promise<CardMap>;
  saveCards(kidId: string, cards: CardState[]): Promise<void>;
  addSession(kidId: string, log: SessionLog): Promise<void>;
  listSessions(kidId: string, max: number): Promise<SessionLog[]>;
  /** The Overworld save (families/{uid}/kids/{kidId}/world/main), or null before the first save. Callers read it through `fromDoc`. */
  loadWorld(kidId: string): Promise<WorldState | null>;
  /** Writes the whole Overworld save. Only the Overworld calls it; nothing else about the kid changes. */
  saveWorld(kidId: string, world: WorldState): Promise<void>;
  /**
   * Stores the kid's last mode pick in world/main. Does nothing when world/main does not exist (the pick then lives on the
   * device only); it never creates the doc. Only that one field changes.
   */
  setWorldLastMode(kidId: string, mode: GameModeId): Promise<void>;
}

/**
 * A 20-character hex id. crypto.randomUUID is missing on an insecure http origin (a local build opened by IP), so
 * the fallback is crypto.getRandomValues, and Math.random is the last resort. Ids are labels, never secrets: nothing
 * here is used for a PIN, salt or token.
 */
export function newId(): string {
  const c = (globalThis as { crypto?: Partial<Crypto> }).crypto;
  try {
    if (typeof c?.randomUUID === 'function') return c.randomUUID().replace(/-/g, '').slice(0, 20);
  } catch {
    // Fall through to the next source.
  }
  const bytes = new Uint8Array(10);
  try {
    if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes);
    else throw new Error('no getRandomValues');
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPin(salt: string, pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`mathquest:${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
