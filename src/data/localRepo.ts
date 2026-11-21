import { applyDelta, GameDeltaError, purchaseTarget, type GameDelta } from '../engine/game';
import { buildGift } from '../game/gifting';
import { creditCheckpoint } from '../engine/tripCheckpoint';
import { PAY_CHUNK, bonusFor, depositProblem, maturesAtOf, owedOf, rateOf, vaultOn, type VaultDeposit, type VaultPointer, type VaultStatus, type VaultTerm } from '../game/vault';
import { normalizeKid, type CardMap, type CardState, type DeviceRecord, type Family, type GiftRecord, type Kid, type KidAvatar, type KidGame, type KidSettings, type PurchaseLog, type SessionLog } from '../engine/models';
import type { CampDoc } from '../game/overworld/camp';
import type { RegionId } from '../game/overworld/maps';
import type { WorldState } from '../game/overworld/worldState';
import type { GameModeId } from '../game/modes/types';
import { newId, type Repo } from './repo';

const PREFIX = 'mathquest:v1';

/** Offline mode only: the PIN of a device with no account is a lock on that device's own storage, so it is hashed here. */
async function hashLocalPin(pin: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mathquest:local:${pin}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
  readonly parentKey = 'local';

  async getFamily(): Promise<Family | null> {
    return read<Family | null>('family', null);
  }

  async saveFamily(family: Family): Promise<void> {
    write('family', { ...read<Family | null>('family', null), ...family });
  }

  async checkParentPin(pin: string): Promise<boolean> {
    const f = read<Family | null>('family', null);
    return !!f?.pinHash && (await hashLocalPin(pin)) === f.pinHash;
  }

  async setParentPin(pin: string): Promise<void> {
    await this.saveFamily({ pinHash: await hashLocalPin(pin), createdAt: read<Family | null>('family', null)?.createdAt ?? Date.now() });
  }

  async markTourSeen(): Promise<void> {
    const f = read<Family | null>('family', null);
    if (f) write('family', { ...f, tourSeen: true });
  }

  async setSchoolMode(on: boolean): Promise<void> {
    const f = read<Family | null>('family', null);
    if (f) write('family', { ...f, schoolMode: on });
  }

  async setGifting(on: boolean): Promise<void> {
    const f = read<Family | null>('family', null);
    if (f) write('family', { ...f, gifting: on });
  }

  async listDevices(): Promise<DeviceRecord[]> {
    return [];
  }

  async setDeviceRevoked(): Promise<void> {
    // Offline mode has no sign-in and no devices.
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
    // A pause set since this copy was read survives, like the Firestore repo.
    this.patchKid(kidId, (k) => {
      const { pause: _copy, ...rest } = settings;
      void _copy;
      return { ...k, settings: k.settings?.pause ? { ...rest, pause: k.settings.pause } : rest };
    });
  }

  async setKidPause(kidIds: string[], pause: { until?: number } | null): Promise<void> {
    for (const id of kidIds)
      this.patchKid(id, (k) => {
        const { pause: _old, ...rest } = k.settings;
        void _old;
        return { ...k, settings: pause ? { ...rest, pause: { on: true, ...(pause.until !== undefined ? { until: pause.until } : {}), setAt: Date.now() } } : rest };
      });
  }

  async setKidAudio(kidId: string, audio: { voice?: 'on' | 'off' | 'kid'; sounds?: 'on' | 'off' }): Promise<void> {
    this.patchKid(kidId, (k) => ({
      ...k,
      settings: { ...k.settings, ...(audio.voice !== undefined ? { voice: audio.voice } : {}), ...(audio.sounds !== undefined ? { sounds: audio.sounds } : {}) },
    }));
  }

  async setKidLightningFloor(kidId: string, ms: number | null): Promise<void> {
    this.patchKid(kidId, (k) => {
      const { lightningFloorMs: _old, ...rest } = k.settings;
      return { ...k, settings: ms === null ? rest : { ...rest, lightningFloorMs: ms } };
    });
  }

  async setKidFlags(kidId: string, flags: { hasPin?: boolean; avatar?: KidAvatar }): Promise<void> {
    this.patchKid(kidId, (k) => ({ ...k, ...(flags.hasPin !== undefined ? { hasPin: flags.hasPin } : {}), ...(flags.avatar !== undefined ? { avatar: flags.avatar } : {}) }));
  }

  async applyGameDelta(kidId: string, delta: GameDelta, opts?: { session?: SessionLog; checkpoint?: boolean }): Promise<KidGame> {
    const stored = read<Kid[]>('kids', []).find((k) => k.id === kidId);
    if (!stored) throw new Error('That player was removed.');
    const current = normalizeKid(stored).game;
    if (opts?.session && opts.checkpoint) {
      const logs = read<SessionLog[]>(`sessions:${kidId}`, []);
      const stored = logs.find((l) => l.id === opts.session!.id) ?? null;
      const cp = creditCheckpoint(stored, opts.session, delta);
      if (!cp) return current;
      const after = applyDelta(current, cp.delta);
      const merged: SessionLog = { ...cp.session, gems: cp.storedGems + (after.gems - current.gems) };
      write(`sessions:${kidId}`, [...logs.filter((l) => l.id !== merged.id), merged].slice(-200));
      this.patchKid(kidId, (k) => ({ ...k, game: after }));
      return after;
    }
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

  async giftItem(giverId: string, receiverId: string, itemId: string): Promise<KidGame> {
    const kids = read<Kid[]>('kids', []);
    const giver = kids.find((k) => k.id === giverId);
    const receiver = kids.find((k) => k.id === receiverId);
    if (!giver || !receiver) throw new Error('That player was removed.');
    if (read<Family | null>('family', null)?.gifting === false) throw new GameDeltaError('Gifts are off.');
    const w = buildGift(normalizeKid(giver), normalizeKid(receiver), itemId, newId(), Date.now());
    write(`purchases:${giverId}`, [...read<PurchaseLog[]>(`purchases:${giverId}`, []), w.entry]);
    write(`gifts:${receiverId}`, [...read<GiftRecord[]>(`gifts:${receiverId}`, []), w.gift]);
    this.patchKid(giverId, (k) => ({ ...k, game: w.giver }));
    this.patchKid(receiverId, (k) => ({ ...k, game: w.receiver }));
    return w.giver;
  }

  async listSiblings(kidId: string): Promise<Kid[]> {
    if (read<Family | null>('family', null)?.gifting === false) return [];
    return (await this.listKids()).filter((k) => k.id !== kidId);
  }

  async listGifts(kidId: string, max: number): Promise<GiftRecord[]> {
    return read<GiftRecord[]>(`gifts:${kidId}`, []).sort((a, b) => b.at - a.at).slice(0, max);
  }

  async markGiftSeen(kidId: string, giftId: string): Promise<void> {
    write(`gifts:${kidId}`, read<GiftRecord[]>(`gifts:${kidId}`, []).map((g) => (g.id === giftId ? { ...g, seen: true } : g)));
  }

  async listPurchases(kidId: string, max: number): Promise<PurchaseLog[]> {
    return read<PurchaseLog[]>(`purchases:${kidId}`, []).sort((a, b) => b.at - a.at).slice(0, max);
  }

  watchKid(kidId: string, onKid: (kid: Kid | null, meta?: { live: boolean }) => void, opts?: { onError?: (e: Error) => void; pollMs?: number }): () => void {
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
          onKid(k, { live: true });
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
    localStorage.removeItem(`${PREFIX}:gifts:${kidId}`);
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

  async loadWorld(kidId: string): Promise<WorldState | null> {
    return read<WorldState | null>(`world:${kidId}`, null);
  }

  async saveWorld(kidId: string, world: WorldState): Promise<void> {
    write(`world:${kidId}`, world);
  }

  async loadCamp(kidId: string): Promise<unknown | null> {
    return read<unknown | null>(`camp:${kidId}`, null);
  }

  async saveCamp(kidId: string, camp: CampDoc, _region: RegionId): Promise<void> {
    write(`camp:${kidId}`, camp);
  }

  async setWorldLastMode(kidId: string, mode: GameModeId): Promise<void> {
    const w = read<WorldState | null>(`world:${kidId}`, null);
    if (w) write(`world:${kidId}`, { ...w, lastMode: mode });
  }
}
