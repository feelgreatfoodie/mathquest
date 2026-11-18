// The outbox keeps each finished run's session log and game delta in IndexedDB until the server confirms both.
// A refused or offline write, or a closed tab, loses nothing: the next launch (or the Try again button) replays
// the entry through applyGameDelta, which stores the session log and the delta in one transaction. A stored
// session log with the same id means the delta already landed, so a replay is idempotent by runId.

import type { GameDelta } from '../engine/game';
import type { KidGame, SessionLog } from '../engine/models';
import type { Repo } from './repo';

export interface OutboxEntry {
  /** The session log id: one finished run. */
  runId: string;
  kidId: string;
  sessionLog: SessionLog;
  gameDelta: GameDelta;
  savedAt: number;
}

const DB_NAME = 'mathquest-outbox';
const STORE = 'runs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'runId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
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
  },
};

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
    const game = await repo.applyGameDelta(e.kidId, e.gameDelta, { session: e.sessionLog });
    await outbox.remove(e.runId);
    onSynced?.(e.kidId, game);
    replayed++;
  }
  return { replayed };
}
