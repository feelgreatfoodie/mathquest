import { applyDelta, GameDeltaError, purchaseTarget, type GameDelta } from '../engine/game';
import { PAY_CHUNK, bonusFor, depositProblem, maturesAtOf, owedOf, rateOf, vaultOn, type VaultDeposit, type VaultPointer, type VaultStatus, type VaultTerm } from '../game/vault';
import { normalizeKid, type CardMap, type CardState, type Family, type Kid, type KidAvatar, type KidGame, type KidSettings, type PurchaseLog, type SessionLog } from '../engine/models';
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

  async setKidFlags(kidId: string, flags: { hasPin?: boolean; avatar?: KidAvatar }): Promise<void> {
    this.patchKid(kidId, (k) => ({ ...k, ...(flags.hasPin !== undefined ? { hasPin: flags.hasPin } : {}), ...(flags.avatar !== undefined ? { avatar: flags.avatar } : {}) }));
  }

  async applyGameDelta(kidId: string, delta: GameDelta, opts?: { session?: SessionLog }): Promise<KidGame> {
    const stored = read<Kid[]>('kids', []).find((k) => k.id === kidId);
    if (!stored) throw new Error('That player was removed.');
    const current = normalizeKid(stored).game;
    if (opts?.session) {
      const logs = read<SessionLog[]>(`sessions:${kidId}`, []);
      if (logs.some((l) => l.id === opts.session!.id)) return current;
      const next = applyDelta(current, delta);
      write(`sessions:${kidId}`, [...logs, { ...opts.session, gems: next.gems - current.gems }].slice(-200));
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
    write(`purchases:${kidId}`, [...logs, { id: newId(), ...purchaseTarget(delta.purchase), cost: before.gems - after.gems, at: Date.now() }]);
  }

  // Local mode is one device with no server, so the deposit time is this device's clock. That is the one place a
  // device clock decides, and only in the offline demo. The Firestore repo never reads it.
  async vaultDeposit(kidId: string, amount: number, termDays: VaultTerm): Promise<KidGame> {
    const stored = read<Kid[]>('kids', []).find((k) => k.id === kidId);
    if (!stored) throw new Error('That player was removed.');
    const kid = normalizeKid(stored);
    const pointer: VaultPointer = stored.vault ?? { active: 0 };
    if (!vaultOn(kid.settings)) throw new GameDeltaError('The vault is off.');
    const problem = depositProblem(amount, kid.game.gems, pointer.active);
    if (problem) throw new GameDeltaError(problem);
    const id = newId();
    const ratePer10 = rateOf(kid.settings, termDays);
    const dep: VaultDeposit = { id, amount, termDays, ratePer10, bonus: bonusFor(amount, ratePer10), status: 'active', paidOut: 0, createdAt: Date.now() };
    write(`vault:${kidId}`, [...read<VaultDeposit[]>(`vault:${kidId}`, []), dep]);
    const next: KidGame = { ...kid.game, gems: kid.game.gems - amount };
    this.patchKid(kidId, (k) => ({ ...k, game: next, vault: { ...pointer, active: pointer.active + 1, lastId: id } }));
    return next;
  }

  async vaultPay(kidId: string, depositId: string, mode: 'collect' | 'break'): Promise<{ paid: number; done: boolean }> {
    const stored = read<Kid[]>('kids', []).find((k) => k.id === kidId);
    if (!stored) throw new Error('That player was removed.');
    const deps = read<VaultDeposit[]>(`vault:${kidId}`, []);
    const dep = deps.find((d) => d.id === depositId);
    if (!dep) throw new GameDeltaError('That deposit is not in the vault.');
    if (dep.status === 'collected' || dep.status === 'broken') return { paid: 0, done: true };
    const closing = dep.status === 'active';
    const running: VaultStatus = closing ? (mode === 'break' ? 'breaking' : 'collecting') : dep.status;
    if (closing && running === 'collecting' && Date.now() < maturesAtOf(dep)) throw new GameDeltaError('The vault is not ready yet.');
    const owed = owedOf({ ...dep, status: running });
    const chunk = Math.min(PAY_CHUNK, owed);
    const last = chunk === owed;
    const status: VaultStatus = last ? (running === 'breaking' ? 'broken' : 'collected') : running;
    const kid = normalizeKid(stored);
    const pointer: VaultPointer = stored.vault ?? { active: 0 };
    write(`vault:${kidId}`, deps.map((d) => (d.id === depositId ? { ...d, status, paidOut: d.paidOut + chunk, ...(closing ? { collectedAt: Date.now() } : {}) } : d)));
    const game: KidGame = { ...kid.game, gems: kid.game.gems + chunk };
    this.patchKid(kidId, (k) => ({ ...k, game, ...(closing ? { vault: { ...pointer, active: pointer.active - 1, closedId: depositId } } : {}) }));
    return { paid: chunk, done: last };
  }

  async listVault(kidId: string, max: number): Promise<VaultDeposit[]> {
    return read<VaultDeposit[]>(`vault:${kidId}`, []).sort((a, b) => b.createdAt - a.createdAt).slice(0, max);
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
    localStorage.removeItem(`${PREFIX}:vault:${kidId}`);
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
