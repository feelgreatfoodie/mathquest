import { normalizeKid, type CardMap, type CardState, type Family, type Kid, type SessionLog } from '../engine/models';
import type { Repo } from './repo';

const PREFIX = 'mathquest:v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${PREFIX}:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(`${PREFIX}:${key}`, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode). Progress for this run is kept in memory only.
  }
}

/** Single-device storage. Used when Firebase isn't configured or VITE_DATA_MODE=local. */
export class LocalRepo implements Repo {
  readonly mode = 'local' as const;

  async getFamily(): Promise<Family | null> {
    return read<Family | null>('family', null);
  }

  async saveFamily(family: Family): Promise<void> {
    write('family', family);
  }

  async listKids(): Promise<Kid[]> {
    return read<Kid[]>('kids', []).map(normalizeKid).sort((a, b) => a.createdAt - b.createdAt);
  }

  async getKid(kidId: string): Promise<Kid | null> {
    const k = read<Kid[]>('kids', []).find((x) => x.id === kidId);
    return k ? normalizeKid(k) : null;
  }

  async saveKid(kid: Kid): Promise<void> {
    const kids = read<Kid[]>('kids', []).filter((k) => k.id !== kid.id);
    write('kids', [...kids, kid]);
  }

  async deleteKid(kidId: string): Promise<void> {
    write('kids', read<Kid[]>('kids', []).filter((k) => k.id !== kidId));
    localStorage.removeItem(`${PREFIX}:cards:${kidId}`);
    localStorage.removeItem(`${PREFIX}:sessions:${kidId}`);
  }

  async loadCards(kidId: string): Promise<CardMap> {
    return read<CardMap>(`cards:${kidId}`, {});
  }

  async saveCards(kidId: string, cards: CardState[]): Promise<void> {
    const all = read<CardMap>(`cards:${kidId}`, {});
    for (const c of cards) all[c.id] = c;
    write(`cards:${kidId}`, all);
  }

  async addSession(kidId: string, log: SessionLog): Promise<void> {
    const logs = read<SessionLog[]>(`sessions:${kidId}`, []);
    write(`sessions:${kidId}`, [...logs, log].slice(-200));
  }

  async listSessions(kidId: string, max: number): Promise<SessionLog[]> {
    return read<SessionLog[]>(`sessions:${kidId}`, [])
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, max);
  }
}
