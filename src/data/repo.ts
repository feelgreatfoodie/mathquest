import type { GameDelta } from '../engine/game';
import type { CampDoc } from '../game/overworld/camp';
import type { RegionId } from '../game/overworld/maps';
import type { WorldState } from '../game/overworld/worldState';
import type { GameModeId } from '../game/modes/types';
import type { VaultDeposit, VaultTerm } from '../game/vault';
import type { CardMap, CardState, DeviceRecord, Family, GiftRecord, Kid, KidAvatar, KidGame, KidSettings, PurchaseLog, SessionLog } from '../engine/models';

/** Storage boundary. Firestore in production; localStorage for offline demos and dev. */
export interface Repo {
  readonly mode: 'firestore' | 'local';
  /** Who the signed-in parent is, for choices kept on this device (the light theme): the account uid, or 'local' offline. */
  readonly parentKey?: string;
  getFamily(): Promise<Family | null>;
  /** Merges the given fields into the family doc, so a field this code does not know (tourSeen) is kept. */
  saveFamily(family: Family): Promise<void>;
  /**
   * Checks the grown-up PIN. Signed in, the server does it (checkParentPin) and no hash is computed or compared in the browser:
   * false for a wrong PIN, a thrown error for a lock or no connection. Offline mode checks its own on-device copy.
   */
  checkParentPin(pin: string): Promise<boolean>;
  /** Sets or changes the grown-up PIN: setParentPin on the server when signed in, the on-device family doc offline. */
  setParentPin(pin: string): Promise<void>;
  /** Writes the single field tourSeen: true on the parent's own family doc and nothing else. */
  markTourSeen(): Promise<void>;
  /** Writes the single field `schoolMode` on the parent's own family doc and nothing else. */
  setSchoolMode(on: boolean): Promise<void>;
  /** Writes the single field `gifting` on the parent's own family doc and nothing else. A family with no value reads as on. */
  setGifting(on: boolean): Promise<void>;
  /** Writes the single field `selling` on the parent's own family doc and nothing else. A family with no value reads as on. */
  setSelling(on: boolean): Promise<void>;
  /**
   * Whether selling is on for the family. A parent session reads the family doc. A kid session cannot read it (the rules close the family doc
   * to kid tokens), so it answers true and the first refused sale turns the Sell button off (firestore.rules sellingOn).
   */
  getSelling(): Promise<boolean>;
  /** The devices that signed a player in, most recent first. Offline mode has none. */
  listDevices(): Promise<DeviceRecord[]>;
  /** Forget a device (`true`) or allow it again (`false`): writes the single field `revoked` on its record. */
  setDeviceRevoked(deviceId: string, revoked: boolean): Promise<void>;
  listKids(): Promise<Kid[]>;
  getKid(kidId: string): Promise<Kid | null>;
  /** Creates a kid. Fails when the id exists, so a stale copy can never replace a stored kid. */
  createKid(kid: Kid): Promise<void>;
  /** Writes `settings` and nothing else. Fails when the kid was removed. */
  saveKidSettings(kidId: string, settings: KidSettings): Promise<void>;
  /**
   * Pauses or resumes play for the named kids in one batch, as the single field `settings.pause` and nothing else
   * (a stale copy of the other settings can never be written back). `until` is an absolute server-clock time in ms;
   * `{}` pauses until a parent resumes; `null` resumes. `setAt` is the server's stamp.
   */
  setKidPause(kidIds: string[], pause: { until?: number } | null): Promise<void>;
  /** Writes `settings.voice` and `settings.sounds` (only the ones given) and nothing else in settings. */
  setKidAudio(kidId: string, audio: { voice?: 'on' | 'off' | 'kid'; sounds?: 'on' | 'off' }): Promise<void>;
  /** Writes the one field `settings.lightningFloorMs` (the Lightning Round delay floor, 1000 to 4000) and nothing else in settings. `null` clears it. */
  setKidLightningFloor(kidId: string, ms: number | null): Promise<void>;
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
  /**
   * Gives `itemId` from one kid to a sibling in one transaction: the giver's gems drop by the price, a purchases record
   * (kind 'gift') goes on the giver, the item joins the receiver's owned list with giftFrom, and a gift record goes on the
   * receiver. Throws GameDeltaError when the receiver already owns the item, the giver cannot pay or the item is not in the shop.
   * Never adds gems to anyone. Returns the giver's game as stored.
   */
  giftItem(giverId: string, receiverId: string, itemId: string): Promise<KidGame>;
  /**
   * Sells one owned shop item back in one transaction: gems rise by half its catalog price (rounded down), the item leaves the owned
   * list (and its equipped slot and gift notes), and a purchases record (kind 'sale') rides along. Throws GameDeltaError when the item
   * cannot be sold (legendary, not owned, a gift inside its 7 days) or the family turned selling off. Returns the game as stored.
   */
  sellItem(kidId: string, itemId: string): Promise<KidGame>;
  /** The other kids of the family, for the gift picker. A kid session reads them only while the family has gifting on; the read fails otherwise. */
  listSiblings(kidId: string): Promise<Kid[]>;
  /** The gifts a kid received, newest first. */
  listGifts(kidId: string, max: number): Promise<GiftRecord[]>;
  /** Marks one received gift opened (seen: true). */
  markGiftSeen(kidId: string, giftId: string): Promise<void>;
  /** The purchases log, newest first. Reads the kid's own purchases path only. */
  listPurchases(kidId: string, max: number): Promise<PurchaseLog[]>;
  /**
   * Calls `onKid` with the stored kid now and after every change, from any client. Returns the unsubscribe.
   * `onKid(null)` means the kid was removed. `meta.live` is true when the snapshot came from the server (not the cache or a pending local write). The local repo polls storage every `pollMs` (default 1500).
   */
  watchKid(kidId: string, onKid: (kid: Kid | null, meta?: { live: boolean }) => void, opts?: { onError?: (e: Error) => void; pollMs?: number }): () => void;
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
   * The camp save, or null before the first one: the tents and flags a kid placed. Firestore keeps one doc per land
   * (families/{uid}/kids/{kidId}/world/camp_meadow, camp_forest and camp_castle); this returns them joined as one list. Callers read it through `fromCampDoc`.
   */
  loadCamp(kidId: string): Promise<unknown | null>;
  /** Writes the camp doc of one land (the items of `region` only). world/main and the kid doc are untouched. */
  saveCamp(kidId: string, camp: CampDoc, region: RegionId): Promise<void>;
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
