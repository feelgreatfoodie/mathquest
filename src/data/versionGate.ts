import { doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import { BUILD, isBehind, parseMinVersion } from '../version';

export interface GuardOptions {
  /** This bundle's build. Defaults to the build number baked in at build time. */
  build?: number;
  /** Gives up on a read after this long, so an offline kid is never stuck. */
  timeoutMs?: number;
  /** Where minVersion comes from. Defaults to config/app in Firestore. */
  read?: () => Promise<unknown>;
}

/**
 * Compares this bundle's build with config/app.minVersion. Behind means the app offers the update on the home
 * and summary screens and starts no new run. It never blocks a write: the server rules guard the data, and a
 * round that finished is saved. The check fails open: a missing doc, a bad value or an
 * unreadable doc keeps the last known answer (first answer: not stale). The rules still guard the data,
 * and a kid on a plane must still be able to play.
 */
export class VersionGuard {
  private min: number | null = null;
  /** The read in progress, shared by every caller so none of them passes the gate while it is pending. */
  private inflight: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private build: number;
  private timeoutMs: number;
  private read: () => Promise<unknown>;

  constructor(db: Firestore | null, opts: GuardOptions = {}) {
    this.build = opts.build ?? BUILD;
    this.timeoutMs = opts.timeoutMs ?? 4_000;
    this.read =
      opts.read ??
      (async () => {
        if (!db) return undefined;
        const snap = await getDocFromServer(doc(db, 'config', 'app'));
        return snap.exists() ? (snap.data() as { minVersion?: unknown }).minVersion : undefined;
      });
  }

  /** The build and the last minVersion read, for settleUpdate. */
  get state(): { build: number; min: number | null } {
    return { build: this.build, min: this.min };
  }

  get stale(): boolean {
    return isBehind(this.build, this.min);
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** Reads minVersion now. Never throws. A call while a read is in progress waits for that read. */
  refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.doRefresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async doRefresh(): Promise<void> {
    const before = this.stale;
    try {
      const raw = await Promise.race([
        this.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('minVersion read timed out')), this.timeoutMs)),
      ]);
      // A missing doc or a bad value clears a stale answer: the owner removed the gate.
      this.min = parseMinVersion(raw);
    } catch {
      // Unreadable: keep what is known.
    }
    if (this.stale !== before) for (const l of this.listeners) l();
  }
}

const guards = new WeakMap<Firestore, VersionGuard>();
/** One guard per Firestore, shared by the repo and the screens. */
export function guardFor(db: Firestore): VersionGuard {
  let g = guards.get(db);
  if (!g) {
    g = new VersionGuard(db);
    guards.set(db, g);
  }
  return g;
}
