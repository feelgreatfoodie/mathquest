import { applyDelta, type GameDelta } from '../engine/game';
import { normalizeKid, type CardMap, type CardState, type Family, type Kid, type KidGame, type KidSettings, type PurchaseLog, type SessionLog } from '../engine/models';
import { newId, type Repo } from './repo';

const PREFIX = 'mathquest:v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${PREFIX}:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Throws when storage is full or blocked, so the screen shows the failed save instead of losing it silently. */
function write(key: string, value: unknown): void {
  localStorage.setItem(`${PREFIX}:${key}`, JSON.stringify(value));
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

  private patchKid(kidId: string, patch: (k: Kid) => Kid): void {
    const kids = read<Kid[]>('kids', []);
    if (!kids.some((k) => k.id === kidId)) throw new Error('That player was removed.');
    write('kids', kids.map((k) => (k.id === kidId ? patch(k) : k)));
  }

  async createKid(kid: Kid): Promise<void> {
    const kids = read<Kid[]>('kids', []);
    if (kids.some((k) => k.id === kid.id)) throw new Error('That player already exists.');
    write('kids', [...kids, kid]);
  }

  async saveKidSettings(kidId: string, settings: KidSettings): Promise<void> {
    this.patchKid(kidId, (k) => ({ ...k, settings }));
  }

  async setKidFlags(kidId: string, flags: { hasPin?: boolean }): Promise<void> {
    this.patchKid(kidId, (k) => ({ ...k, ...(flags.hasPin !== undefined ? { hasPin: flags.hasPin } : {}) }));
  }

  async applyGameDelta(kidId: string, delta: GameDelta, opts?: { session?: SessionLog }): Promise<KidGame> {
    const stored = read<Kid[]>('kids', []).find((k) => k.id === kidId);
    if (!stored) throw new Error('That player was removed.');
    const current = normalizeKid(stored).game;
    if (opts?.session) {
      const logs = read<SessionLog[]>(`sessions:${kidId}`, []);
      if (logs.some((l) => l.id === opts.session!.id)) return current;
      const next = applyDelta(current, delta);
      write(`sessions:${kidId}`, [...logs, opts.session].slice(-200));
      this.patchKid(kidId, (k) => ({ ...k, game: next }));
      this.logPurchase(kidId, current, next, delta);
      return next;
    }
    const next = applyDelta(current, delta);
    this.patchKid(kidId, (k) => ({ ...k, game: next }));
    this.logPurchase(kidId, current, next, delta);
    return next;
  }

  private logPurchase(kidId: string, before: KidGame, after: KidGame, delta: GameDelta): void {
    if (delta.purchase === undefined) return;
    const logs = read<PurchaseLog[]>(`purchases:${kidId}`, []);
    write(`purchases:${kidId}`, [...logs, { id: newId(), heroId: delta.purchase, cost: before.gems - after.gems, at: Date.now() }]);
  }

  async listPurchases(kidId: string, max: number): Promise<PurchaseLog[]> {
    return read<PurchaseLog[]>(`purchases:${kidId}`, []).sort((a, b) => b.at - a.at).slice(0, max);
  }

  watchKid(kidId: string, onKid: (kid: Kid | null) => void, opts?: { onError?: (e: Error) => void; pollMs?: number }): () => void {
    let last: string | undefined;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      this.getKid(kidId).then(
        (k) => {
          if (stopped) return;
          const json = JSON.stringify(k);
          if (json === last) return;
          last = json;
          onKid(k);
        },
        (e) => opts?.onError?.(e as Error),
      );
    };
    tick();
    const timer = setInterval(tick, opts?.pollMs ?? 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async deleteKid(kidId: string): Promise<void> {
    write('kids', read<Kid[]>('kids', []).filter((k) => k.id !== kidId));
    localStorage.removeItem(`${PREFIX}:cards:${kidId}`);
    localStorage.removeItem(`${PREFIX}:sessions:${kidId}`);
    localStorage.removeItem(`${PREFIX}:purchases:${kidId}`);
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
