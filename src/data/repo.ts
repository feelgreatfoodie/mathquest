import type { GameDelta } from '../engine/game';
import type { CardMap, CardState, Family, Kid, KidGame, KidSettings, PurchaseLog, SessionLog } from '../engine/models';

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
  /** Writes the named flags and nothing else. */
  setKidFlags(kidId: string, flags: { hasPin?: boolean }): Promise<void>;
  /**
   * The only writer of `game`. Reads the stored game inside a transaction, applies the delta and writes
   * `game` back, so a stale screen cannot overwrite newer totals. With `session`, the run's log is written
   * in the same transaction, and a log that is already stored means the delta was already applied (a safe retry).
   * A purchase also writes one purchases-log entry in the same transaction. Returns the game as stored. Throws GameDeltaError when the delta cannot apply.
   */
  applyGameDelta(kidId: string, delta: GameDelta, opts?: { session?: SessionLog }): Promise<KidGame>;
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
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

export async function hashPin(salt: string, pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`mathquest:${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
