// The outbox keeps each finished run's session log and game delta in IndexedDB until the server confirms both.
// A refused or offline write, or a closed tab, loses nothing: the next launch (or the Try again button) replays
// the entry through applyGameDelta, which stores the session log and the delta in one transaction. A stored
// session log with the same id means the delta already landed, so a replay is idempotent by runId.

import { GameDeltaError, type GameDelta } from '../engine/game';
import { GEM_RUN_MAX } from '../engine/gems';
import type { KidGame, SessionLog } from '../engine/models';
import { isSaveDenied } from '../version';
import type { Repo } from './repo';

/** The most XP one write may raise (firestore.rules, kid branch). */
export const XP_WRITE_MAX = 2000;
/** Tries before a refused run is parked: the original, the repeat, and one more after clamping to the rules. */
export const MAX_DENIED_TRIES = 3;

export interface OutboxEntry {
  /** The session log id: one finished run. */
  runId: string;
  kidId: string;
  /** Absent on a shop math tip: a tip has no session, and the cap (not a stored log) stops a repeat. */
  sessionLog?: SessionLog;
  /** An Adventure checkpoint: `runId` is `${tripId}:${seq}`, `sessionLog` is the trip's cumulative log. A replay credits only the XP above the stored xpCredited. */
  checkpoint?: boolean;
  gameDelta: GameDelta;
  savedAt: number;
  /** How many times the server refused this run (permission-denied). */
  denied?: number;
}

/** A run the server refused on every try. Kept for the parent to see, never replayed. */
export interface ParkedRun extends OutboxEntry {
  parkedAt: number;
}

const DB_NAME = 'mathquest-outbox';
const STORE = 'runs';
const PARKED = 'parked';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const names = req.result.objectStoreNames;
      if (!names.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'runId' });
      if (!names.contains(PARKED)) req.result.createObjectStore(PARKED, { keyPath: 'runId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = run(t.objectStore(store));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

/** IndexedDB can be missing or blocked (private mode). The outbox then does nothing and saving works as before. */
function available(): boolean {
  return typeof indexedDB !== 'undefined';
}

export const outbox = {
  async put(entry: OutboxEntry): Promise<void> {
    if (!available()) return;
    await tx('readwrite', (s) => s.put(entry));
  },
  async remove(runId: string): Promise<void> {
    if (!available()) return;
    await tx('readwrite', (s) => s.delete(runId));
  },
  /** Oldest first. With `kidId`, only that kid's runs. */
  async list(kidId?: string): Promise<OutboxEntry[]> {
    if (!available()) return [];
    const all = await tx<OutboxEntry[]>('readonly', (s) => s.getAll());
    return all.filter((e) => kidId === undefined || e.kidId === kidId).sort((a, b) => a.savedAt - b.savedAt);
  },
  async clear(): Promise<void> {
    if (!available()) return;
    await tx('readwrite', (s) => s.clear());
    await tx('readwrite', (s) => s.clear(), PARKED);
  },
  /** Moves a run out of the outbox into the parked store. Parked runs are never replayed. */
  async park(entry: OutboxEntry): Promise<void> {
    if (!available()) return;
    const parked: ParkedRun = { ...entry, parkedAt: Date.now() };
    await tx('readwrite', (s) => s.put(parked), PARKED);
    await tx('readwrite', (s) => s.delete(entry.runId));
  },
  async listParked(): Promise<ParkedRun[]> {
    if (!available()) return [];
    const all = await tx<ParkedRun[]>('readonly', (s) => s.getAll(), PARKED);
    return all.sort((a, b) => a.savedAt - b.savedAt);
  },
  /** The parent saw it and dismissed it. */
  async removeParked(runId: string): Promise<void> {
    if (!available()) return;
    await tx('readwrite', (s) => s.delete(runId), PARKED);
  },
};

/** The delta with gems and XP cut to what the rules accept today. A price (negative gems) stays. */
export function clampToRules(delta: GameDelta): GameDelta {
  const out: GameDelta = { ...delta };
  if (!delta.gemRun && delta.gems !== undefined && delta.gems > GEM_RUN_MAX) out.gems = GEM_RUN_MAX;
  if (delta.xp !== undefined && delta.xp > XP_WRITE_MAX) out.xp = XP_WRITE_MAX;
  return out;
}

/** Counts one refusal of a run's first save (the save path calls this when the write is denied). */
export async function noteDenied(runId: string): Promise<void> {
  try {
    const e = (await outbox.list()).find((x) => x.runId === runId);
    if (e) await outbox.put({ ...e, denied: (e.denied ?? 0) + 1 });
  } catch (err) {
    console.error('Could not count the refused run.', err);
  }
}

/** put() that never throws: a broken outbox must not stop the save itself. */
export async function putQuietly(entry: OutboxEntry): Promise<void> {
  try {
    await outbox.put(entry);
  } catch (e) {
    console.error('Could not keep the run in the outbox.', e);
  }
}

export async function removeQuietly(runId: string): Promise<void> {
  try {
    await outbox.remove(runId);
  } catch (e) {
    console.error('Could not clear the run from the outbox.', e);
  }
}

/**
 * Writes every stored run (of `kidId`, or of all kids) through applyGameDelta and removes each one once it is
 * confirmed. Stops at the first failure so runs land in order, and throws it. A run the server already holds
 * (its session log is stored) writes nothing and is removed. `onSynced` gets the stored game after each run.
 */
export async function replayOutbox(
  repo: Repo,
  kidId?: string,
  onSynced?: (kidId: string, game: KidGame) => void,
): Promise<{ replayed: number }> {
  let replayed = 0;
  for (const e of await outbox.list(kidId)) {
    // After two refusals the delta is cut to the current rules for the last try.
    const delta = (e.denied ?? 0) >= MAX_DENIED_TRIES - 1 ? clampToRules(e.gameDelta) : e.gameDelta;
    let game: KidGame;
    try {
      game = await repo.applyGameDelta(e.kidId, delta, e.sessionLog ? { session: e.sessionLog, ...(e.checkpoint ? { checkpoint: true } : {}) } : undefined);
    } catch (err) {
      // A tip the stored game cannot take (the 4th of the day) will never apply: drop it, do not retry, do not block the queue.
      if (e.gameDelta.shopTip && err instanceof GameDeltaError) {
        await outbox.remove(e.runId);
        continue;
      }
      if (!isSaveDenied(err)) throw err; // offline or other: keep it, stop, the next launch tries again
      const denied = (e.denied ?? 0) + 1;
      if (denied < MAX_DENIED_TRIES) {
        await outbox.put({ ...e, denied });
        throw err;
      }
      console.error('A round was refused 3 times and is parked. It will not be tried again.', { runId: e.runId, kidId: e.kidId, savedAt: e.savedAt, gameDelta: e.gameDelta }, err);
      await outbox.park({ ...e, denied });
      continue; // the next run must not wait behind a run the server will never take
    }
    await outbox.remove(e.runId);
    onSynced?.(e.kidId, game);
    replayed++;
  }
  return { replayed };
}
