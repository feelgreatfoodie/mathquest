import type { CardMap, CardState, Family, Kid, SessionLog } from '../engine/models';

/** Storage boundary. Firestore in production; localStorage for offline demos and dev. */
export interface Repo {
  readonly mode: 'firestore' | 'local';
  getFamily(): Promise<Family | null>;
  saveFamily(family: Family): Promise<void>;
  listKids(): Promise<Kid[]>;
  getKid(kidId: string): Promise<Kid | null>;
  saveKid(kid: Kid): Promise<void>;
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
