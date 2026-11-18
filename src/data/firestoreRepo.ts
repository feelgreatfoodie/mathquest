import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { applyDelta, type GameDelta } from '../engine/game';
import { normalizeGame, normalizeKid, type CardMap, type CardState, type Family, type Kid, type KidGame, type KidSettings, type PurchaseLog, type SessionLog } from '../engine/models';
import { newId, type Repo } from './repo';
import { guardFor, type VersionGuard } from './versionGate';

const BATCH_MAX = 450;

/**
 * Layout (all under the signed-in parent's uid, enforced by firestore.rules):
 *   families/{uid}
 *   families/{uid}/kids/{kidId}
 *   families/{uid}/kids/{kidId}/cards/{cardId}
 *   families/{uid}/kids/{kidId}/sessions/{sessionId}
 *   families/{uid}/kids/{kidId}/purchases/{purchaseId}   (parent reads; written only with a game change)
 * Firestore's persistent cache makes every write work offline and sync later.
 */
export class FirestoreRepo implements Repo {
  readonly mode = 'firestore' as const;

  private guard: VersionGuard;

  constructor(
    private db: Firestore,
    private uid: string,
    guard?: VersionGuard,
  ) {
    this.guard = guard ?? guardFor(db);
  }

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
    await updateDoc(doc(this.kids(), kidId), { settings });
  }

  async setKidFlags(kidId: string, flags: { hasPin?: boolean }): Promise<void> {
    const update: Record<string, unknown> = {};
    if (flags.hasPin !== undefined) update.hasPin = flags.hasPin;
    if (Object.keys(update).length) await updateDoc(doc(this.kids(), kidId), update);
  }

  async applyGameDelta(kidId: string, delta: GameDelta, opts?: { session?: SessionLog }): Promise<KidGame> {
    await this.guard.check(); // a bundle behind config/app.minVersion writes nothing
    const ref = doc(this.kids(), kidId);
    const sessionRef = opts?.session ? doc(this.sessions(kidId), opts.session.id) : null;
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('That player was removed.');
      const current = normalizeGame((snap.data() as { game?: unknown }).game);
      if (sessionRef && opts?.session) {
        // The log is written with the delta, so a stored log means this delta already landed.
        if ((await tx.get(sessionRef)).exists()) return current;
        tx.set(sessionRef, opts.session);
      }
      let next = applyDelta(current, delta);
      if (delta.purchase !== undefined) {
        // The log entry rides in the same transaction as the hero and the gems it records. The kid doc names it
        // (lastPurchaseId) so the rules can find it: a gem drop is legal only with that one entry.
        const id = newId();
        const entry: PurchaseLog = { id, heroId: delta.purchase, cost: current.gems - next.gems, at: Date.now() };
        tx.set(doc(this.purchases(kidId), id), entry);
        next = { ...next, lastPurchaseId: id };
      }
      tx.update(ref, { game: next });
      return next;
    });
  }

  async listPurchases(kidId: string, max: number): Promise<PurchaseLog[]> {
    const snap = await getDocs(query(this.purchases(kidId), orderBy('at', 'desc'), limit(max)));
    return snap.docs.map((d) => d.data() as PurchaseLog);
  }

  watchKid(kidId: string, onKid: (kid: Kid | null) => void, opts?: { onError?: (e: Error) => void }): () => void {
    return onSnapshot(
      doc(this.kids(), kidId),
      (snap) => onKid(snap.exists() ? normalizeKid(snap.data() as Kid) : null),
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
    await this.guard.check();
    for (let i = 0; i < cards.length; i += BATCH_MAX) {
      const batch = writeBatch(this.db);
      cards.slice(i, i + BATCH_MAX).forEach((c) => batch.set(doc(this.cards(kidId), c.id), c));
      await batch.commit();
    }
  }

  async addSession(kidId: string, log: SessionLog): Promise<void> {
    await this.guard.check();
    await setDoc(doc(this.sessions(kidId), log.id), log);
  }

  async listSessions(kidId: string, max: number): Promise<SessionLog[]> {
    const snap = await getDocs(query(this.sessions(kidId), orderBy('startedAt', 'desc'), limit(max)));
    return snap.docs.map((d) => d.data() as SessionLog);
  }
}
