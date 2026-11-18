import { doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import { BUILD, StaleBuildError, isBehind, parseMinVersion } from '../version';

export { StaleBuildError };

export interface GuardOptions {
  /** This bundle's build. Defaults to the build number baked in at build time. */
  build?: number;
  /** A check younger than this is trusted. 0 reads every time. */
  maxAgeMs?: number;
  /** Gives up on a read after this long, so an offline kid is never stuck on a write. */
  timeoutMs?: number;
  /** Where minVersion comes from. Defaults to config/app in Firestore. */
  read?: () => Promise<unknown>;
}

/**
 * Compares this bundle's build with config/app.minVersion. Behind means no game, card or session write
 * and no new run: the screen shows the update page. The check fails open: a missing doc, a bad value or an
 * unreadable doc keeps the last known answer (first answer: not stale). The rules still guard the data,
 * and a kid on a plane must still be able to play.
 */
export class VersionGuard {
  private min: number | null = null;
  private lastTry = -Infinity;
  private listeners = new Set<() => void>();
  private build: number;
  private maxAgeMs: number;
  private timeoutMs: number;
  private read: () => Promise<unknown>;

  constructor(db: Firestore | null, opts: GuardOptions = {}) {
    this.build = opts.build ?? BUILD;
    this.maxAgeMs = opts.maxAgeMs ?? 30_000;
    this.timeoutMs = opts.timeoutMs ?? 4_000;
    this.read =
      opts.read ??
      (async () => {
        if (!db) return undefined;
        const snap = await getDocFromServer(doc(db, 'config', 'app'));
        return snap.exists() ? (snap.data() as { minVersion?: unknown }).minVersion : undefined;
      });
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

  /** Reads minVersion now. Never throws. */
  async refresh(): Promise<void> {
    this.lastTry = Date.now();
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

  /** Throws StaleBuildError when this bundle is behind. Reads minVersion first when the last check is old. */
  async check(): Promise<void> {
    if (!this.stale && Date.now() - this.lastTry >= this.maxAgeMs) await this.refresh();
    if (this.stale) throw new StaleBuildError();
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
