import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { CardMap, CardState, Family, Kid, SessionLog } from '../engine/models';
import type { Repo } from './repo';

const BATCH_MAX = 450;

/**
 * Layout (all under the signed-in parent's uid, enforced by firestore.rules):
 *   families/{uid}
 *   families/{uid}/kids/{kidId}
 *   families/{uid}/kids/{kidId}/cards/{cardId}
 *   families/{uid}/kids/{kidId}/sessions/{sessionId}
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

  async getFamily(): Promise<Family | null> {
    const snap = await getDoc(this.family());
    return snap.exists() ? (snap.data() as Family) : null;
  }

  async saveFamily(family: Family): Promise<void> {
    await setDoc(this.family(), family);
  }

  async listKids(): Promise<Kid[]> {
    const snap = await getDocs(query(this.kids(), orderBy('createdAt')));
    return snap.docs.map((d) => d.data() as Kid);
  }

  async getKid(kidId: string): Promise<Kid | null> {
    const snap = await getDoc(doc(this.kids(), kidId));
    return snap.exists() ? (snap.data() as Kid) : null;
  }

  async saveKid(kid: Kid): Promise<void> {
    await setDoc(doc(this.kids(), kid.id), kid);
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
}
