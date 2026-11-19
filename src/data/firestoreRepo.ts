import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { applyDelta, GameDeltaError, purchaseTarget, type GameDelta } from '../engine/game';
import { creditCheckpoint } from '../engine/tripCheckpoint';
import { PAY_CHUNK, bonusFor, depositProblem, owedOf, rateOf, vaultOn, type VaultDeposit, type VaultPointer, type VaultStatus, type VaultTerm } from '../game/vault';
import { normalizeKid, sameInventory, splitGame, type CardMap, type CardState, type Family, type Kid, type KidAvatar, type KidGame, type KidSettings, type PurchaseLog, type SessionLog } from '../engine/models';
import type { WorldState } from '../game/overworld/worldState';
import type { GameModeId } from '../game/modes/types';
import { newId, type Repo } from './repo';

const BATCH_MAX = 450;

/**
 * Layout (all under the signed-in parent's uid, enforced by firestore.rules):
 *   families/{uid}
 *   families/{uid}/kids/{kidId}
 *   families/{uid}/kids/{kidId}/cards/{cardId}
 *   families/{uid}/kids/{kidId}/sessions/{sessionId}
 *   families/{uid}/kids/{kidId}/purchases/{purchaseId}   (parent reads; written only with a game change)
 *   families/{uid}/kids/{kidId}/world/main              (the Overworld save; the kid and the parent read and write it)
 *   families/{uid}/kids/{kidId}/vault/{depositId}        (a deposit; created only with the gems it takes, paid only with the gems it gives)
 * Firestore's persistent cache makes every write work offline and sync later.
 */
export class FirestoreRepo implements Repo {
  readonly mode = 'firestore' as const;

  constructor(
    private db: Firestore,
    private uid: string,
  ) {}

  private family() {
    return doc(this.db, 'families', this.uid);
  }

  private kids() {
    return collection(this.db, 'families', this.uid, 'kids');
  }

  private cards(kidId: string) {
    return collection(this.db, 'families', this.uid, 'kids', kidId, 'cards');
  }

  private sessions(kidId: string) {
    return collection(this.db, 'families', this.uid, 'kids', kidId, 'sessions');
  }

  private vault(kidId: string) {
    return collection(this.db, 'families', this.uid, 'kids', kidId, 'vault');
  }

  private purchases(kidId: string) {
    return collection(this.db, 'families', this.uid, 'kids', kidId, 'purchases');
  }

  async getFamily(): Promise<Family | null> {
    const snap = await getDoc(this.family());
    return snap.exists() ? (snap.data() as Family) : null;
  }

  async saveFamily(family: Family): Promise<void> {
    await setDoc(this.family(), family);
  }

  async listKids(): Promise<Kid[]> {
    const snap = await getDocs(query(this.kids(), orderBy('createdAt')));
    return snap.docs.map((d) => normalizeKid(d.data() as Kid));
  }

  async getKid(kidId: string): Promise<Kid | null> {
    const snap = await getDoc(doc(this.kids(), kidId));
    return snap.exists() ? normalizeKid(snap.data() as Kid) : null;
  }

  async createKid(kid: Kid): Promise<void> {
    const ref = doc(this.kids(), kid.id);
    await runTransaction(this.db, async (tx) => {
      if ((await tx.get(ref)).exists()) throw new Error('That player already exists.');
      tx.set(ref, kid);
    });
  }

  async saveKidSettings(kidId: string, settings: KidSettings): Promise<void> {
    // Field-level: only the settings that differ from the stored ones are written, each as `settings.<name>`, and a name the
    // screen dropped is deleted. Nothing else in the map is sent, so a pause set from another phone since this copy was
    // read (or any other setting changed elsewhere) cannot be overwritten. `pause` is never part of this write.
    const ref = doc(this.kids(), kidId);
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('That player was removed.');
      const stored = ((snap.data() as { settings?: Record<string, unknown> }).settings ?? {}) as Record<string, unknown>;
      const next = settings as unknown as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(next)) {
        if (name === 'pause' || value === undefined) continue;
        if (JSON.stringify(value) !== JSON.stringify(stored[name])) update[`settings.${name}`] = value;
      }
      for (const name of Object.keys(stored)) if (name !== 'pause' && (!(name in next) || next[name] === undefined)) update[`settings.${name}`] = deleteField();
      if (Object.keys(update).length) tx.update(ref, update);
    });
  }

  async setKidPause(kidIds: string[], pause: { until?: number } | null): Promise<void> {
    for (let i = 0; i < kidIds.length; i += BATCH_MAX) {
      const batch = writeBatch(this.db);
      for (const id of kidIds.slice(i, i + BATCH_MAX)) {
        batch.update(doc(this.kids(), id), {
          'settings.pause': pause ? { on: true, ...(pause.until !== undefined ? { until: pause.until } : {}), setAt: serverTimestamp() } : deleteField(),
        });
      }
      await batch.commit();
    }
  }

  async setKidAudio(kidId: string, audio: { voice?: 'on' | 'off' | 'kid'; sounds?: 'on' | 'off' }): Promise<void> {
    const update: Record<string, unknown> = {};
    if (audio.voice !== undefined) update['settings.voice'] = audio.voice;
    if (audio.sounds !== undefined) update['settings.sounds'] = audio.sounds;
    if (Object.keys(update).length) await updateDoc(doc(this.kids(), kidId), update);
  }

  async setKidFlags(kidId: string, flags: { hasPin?: boolean; avatar?: KidAvatar }): Promise<void> {
    const update: Record<string, unknown> = {};
    if (flags.hasPin !== undefined) update.hasPin = flags.hasPin;
    if (flags.avatar !== undefined) update.avatar = flags.avatar;
    if (Object.keys(update).length) await updateDoc(doc(this.kids(), kidId), update);
  }

  async applyGameDelta(kidId: string, delta: GameDelta, opts?: { session?: SessionLog; checkpoint?: boolean }): Promise<KidGame> {
    const ref = doc(this.kids(), kidId);
    const sessionRef = opts?.session ? doc(this.sessions(kidId), opts.session.id) : null;
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('That player was removed.');
      const current = normalizeKid(snap.data() as Kid).game;
      if (sessionRef && opts?.session && opts.checkpoint) {
        // An Adventure checkpoint: the stored trip doc says how much XP was already credited. Read, credit the rest and merge, in this transaction.
        const sSnap = await tx.get(sessionRef);
        const cp = creditCheckpoint(sSnap.exists() ? (sSnap.data() as SessionLog) : null, opts.session, delta);
        if (!cp) return current;
        const after = applyDelta(current, cp.delta);
        tx.set(sessionRef, { ...cp.session, gems: cp.storedGems + (after.gems - current.gems) });
        tx.update(ref, { game: splitGame(after).game });
        return after;
      }
      // The log is written with the delta, so a stored log means this delta already landed.
      if (sessionRef && (await tx.get(sessionRef)).exists()) return current;
      let next = applyDelta(current, delta);
      // The log records the gems the transaction awarded (the throttle reads the stored count), not the screen's estimate.
      if (sessionRef && opts?.session) tx.set(sessionRef, { ...opts.session, gems: next.gems - current.gems });
      if (delta.purchase !== undefined) {
        // The log entry rides in the same transaction as the hero and the gems it records. The kid doc names it
        // (lastPurchaseId) so the rules can find it: a gem drop is legal only with that one entry.
        const id = newId();
        const entry: PurchaseLog = { id, ...purchaseTarget(delta.purchase), cost: current.gems - next.gems, at: Date.now() };
        tx.set(doc(this.purchases(kidId), id), entry);
        next = { ...next, lastPurchaseId: id };
      }
      // The shop fields go to the top-level inventory, never into game, and only when they changed: a run or a hero
      // buy writes game alone, the same shape an old bundle writes.
      const out = splitGame(next);
      const changed = !sameInventory(splitGame(current).inventory, out.inventory);
      tx.update(ref, { game: out.game, ...(changed ? { inventory: out.inventory ?? { items: [] } } : {}) });
      return next;
    });
  }

  async vaultDeposit(kidId: string, amount: number, termDays: VaultTerm): Promise<KidGame> {
    const ref = doc(this.kids(), kidId);
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('That player was removed.');
      const kid = normalizeKid(snap.data() as Kid);
      const pointer: VaultPointer = (snap.data() as Kid).vault ?? { active: 0 };
      if (!vaultOn(kid.settings)) throw new GameDeltaError('The vault is off.');
      const problem = depositProblem(amount, kid.game.gems, pointer.active);
      if (problem) throw new GameDeltaError(problem);
      const id = newId();
      const ratePer10 = rateOf(kid.settings, termDays);
      // createdAt is the server's time. No time from this device goes into the deposit.
      tx.set(doc(this.vault(kidId), id), { id, amount, termDays, ratePer10, bonus: bonusFor(amount, ratePer10), status: 'active', paidOut: 0, createdAt: serverTimestamp() });
      const next: KidGame = { ...kid.game, gems: kid.game.gems - amount };
      tx.update(ref, { game: splitGame(next).game, vault: { ...pointer, active: pointer.active + 1, lastId: id } });
      return next;
    });
  }

  async vaultPay(kidId: string, depositId: string, mode: 'collect' | 'break'): Promise<{ paid: number; done: boolean }> {
    const ref = doc(this.kids(), kidId);
    const depRef = doc(this.vault(kidId), depositId);
    // One chunk per transaction. The transaction reads the deposit and the kid, then writes game.gems and paidOut together,
    // so a chunk lands once: a second client that read the same paidOut retries, reads the new one and pays the next chunk or nothing.
    return runTransaction(this.db, async (tx) => {
      const [snap, depSnap] = await Promise.all([tx.get(ref), tx.get(depRef)]);
      if (!snap.exists()) throw new Error('That player was removed.');
      if (!depSnap.exists()) throw new GameDeltaError('That deposit is not in the vault.');
      const dep = fromStored(depSnap.data());
      if (dep.status === 'collected' || dep.status === 'broken') return { paid: 0, done: true };
      // An active deposit starts the payout the caller asked for. A payout in progress finishes as it started, whatever `mode` says.
      const closing = dep.status === 'active';
      const running: VaultStatus = closing ? (mode === 'break' ? 'breaking' : 'collecting') : dep.status;
      const owed = owedOf({ ...dep, status: running });
      const chunk = Math.min(PAY_CHUNK, owed);
      const last = chunk === owed;
      const status: VaultStatus = last ? (running === 'breaking' ? 'broken' : 'collected') : running;
      const kid = normalizeKid(snap.data() as Kid);
      const pointer: VaultPointer = (snap.data() as Kid).vault ?? { active: 0 };
      // The first chunk leaves `active`: the rules check the term against their own clock and createdAt (this code never does) and the pointer drops.
      tx.update(depRef, { paidOut: dep.paidOut + chunk, ...(status !== dep.status ? { status } : {}), ...(closing ? { collectedAt: serverTimestamp() } : {}) });
      const game = splitGame({ ...kid.game, gems: kid.game.gems + chunk }).game;
      tx.update(ref, closing ? { game, vault: { ...pointer, active: pointer.active - 1, closedId: depositId } } : { game });
      return { paid: chunk, done: last };
    });
  }

  async listVault(kidId: string, max: number): Promise<VaultDeposit[]> {
    const snap = await getDocs(query(this.vault(kidId), orderBy('createdAt', 'desc'), limit(max)));
    return snap.docs.map((d) => fromStored(d.data()));
  }

  async listPurchases(kidId: string, max: number): Promise<PurchaseLog[]> {
    const snap = await getDocs(query(this.purchases(kidId), orderBy('at', 'desc'), limit(max)));
    return snap.docs.map((d) => d.data() as PurchaseLog);
  }

  watchKid(kidId: string, onKid: (kid: Kid | null, meta?: { live: boolean }) => void, opts?: { onError?: (e: Error) => void }): () => void {
    return onSnapshot(
      doc(this.kids(), kidId),
      (snap) => onKid(snap.exists() ? normalizeKid(snap.data() as Kid) : null, { live: !snap.metadata.fromCache && !snap.metadata.hasPendingWrites }),
      (e) => opts?.onError?.(e),
    );
  }

  async deleteKid(kidId: string): Promise<void> {
    for (const col of [this.cards(kidId), this.sessions(kidId)]) {
      const snap = await getDocs(col);
      for (let i = 0; i < snap.docs.length; i += BATCH_MAX) {
        const batch = writeBatch(this.db);
        snap.docs.slice(i, i + BATCH_MAX).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await deleteDoc(doc(this.kids(), kidId));
  }

  async loadCards(kidId: string): Promise<CardMap> {
    const snap = await getDocs(this.cards(kidId));
    const out: CardMap = {};
    snap.forEach((d) => {
      const c = d.data() as CardState;
      out[c.id] = c;
    });
    return out;
  }

  async saveCards(kidId: string, cards: CardState[]): Promise<void> {
    for (let i = 0; i < cards.length; i += BATCH_MAX) {
      const batch = writeBatch(this.db);
      cards.slice(i, i + BATCH_MAX).forEach((c) => batch.set(doc(this.cards(kidId), c.id), c));
      await batch.commit();
    }
  }

  async addSession(kidId: string, log: SessionLog): Promise<void> {
    await setDoc(doc(this.sessions(kidId), log.id), log);
  }

  async listSessions(kidId: string, max: number): Promise<SessionLog[]> {
    const snap = await getDocs(query(this.sessions(kidId), orderBy('startedAt', 'desc'), limit(max)));
    return snap.docs.map((d) => d.data() as SessionLog);
  }

  async loadWorld(kidId: string): Promise<WorldState | null> {
    const snap = await getDoc(doc(this.db, 'families', this.uid, 'kids', kidId, 'world', 'main'));
    return snap.exists() ? (snap.data() as WorldState) : null;
  }

  async saveWorld(kidId: string, world: WorldState): Promise<void> {
    await setDoc(doc(this.db, 'families', this.uid, 'kids', kidId, 'world', 'main'), world);
  }

  async setWorldLastMode(kidId: string, mode: GameModeId): Promise<void> {
    try {
      await updateDoc(doc(this.db, 'families', this.uid, 'kids', kidId, 'world', 'main'), { lastMode: mode });
    } catch {
      // No world doc yet (not-found): the pick stays on the device. Any other failure is a convenience that never blocks play.
    }
  }
}

/** A stored deposit as the app reads it: server timestamps become epoch ms. */
function fromStored(raw: Record<string, unknown>): VaultDeposit {
  const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0);
  return {
    id: String(raw.id),
    amount: Number(raw.amount),
    termDays: Number(raw.termDays) as VaultTerm,
    ratePer10: Number(raw.ratePer10),
    bonus: Number(raw.bonus),
    status: (['collecting', 'breaking', 'collected', 'broken'] as const).find((x) => x === raw.status) ?? 'active',
    paidOut: Number(raw.paidOut ?? 0),
    // A deposit just written has no server stamp yet in a cached read; it reads as now until the server fills it.
    createdAt: ms(raw.createdAt) || Date.now(),
    ...(raw.collectedAt ? { collectedAt: ms(raw.collectedAt) } : {}),
  };
}
