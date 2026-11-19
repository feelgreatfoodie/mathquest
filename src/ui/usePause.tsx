import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Repo } from '../data/repo';
import { isPaused, msLeft, pauseOf, type KidPause } from '../engine/pause';
import { serverClock, syncServerClock } from './pauseClock';

/** Whether play is blocked now. Run screens read it to stop after the current question. */
export interface PauseState {
  paused: boolean;
  pause: KidPause | null;
  /** Ms left on a timed pause; null when open-ended or no clock estimate yet. */
  left: number | null;
  /** The length of the pause as first seen on this device, for the ring. Null when open-ended. */
  total: number | null;
}

export const NOT_PAUSED: PauseState = { paused: false, pause: null, left: null, total: null };
export const PauseContext = createContext<PauseState>(NOT_PAUSED);
export const usePauseState = () => useContext(PauseContext);

const storeKey = (kidId: string) => `mathquest:v1:pause:${kidId}`;

function readStored(kidId: string): KidPause | null {
  try {
    const raw = localStorage.getItem(storeKey(kidId));
    return raw ? pauseOf({ pause: JSON.parse(raw) }) : null;
  } catch {
    return null;
  }
}

function writeStored(kidId: string, pause: KidPause | null): void {
  try {
    if (pause) localStorage.setItem(storeKey(kidId), JSON.stringify(pause));
    else localStorage.removeItem(storeKey(kidId));
  } catch {
    // The last known state lasts until the screen closes.
  }
}

/**
 * The pause on the kid doc, live. One `onSnapshot` that reads `settings.pause` and nothing else: it never writes, and never
 * touches the game state on screen. Offline, the last state this device saw applies (kept per kid in localStorage).
 * The device clock is never consulted for a timed pause: the server-clock estimate is (see ServerClock). With no estimate
 * a timed pause stays on.
 */
export function usePause(repo: Repo | null, kidId: string | null): PauseState & { check: () => Promise<boolean> } {
  const [pause, setPause] = useState<KidPause | null>(() => (kidId ? readStored(kidId) : null));
  const [, setTick] = useState(0);
  const firstSeen = useRef<{ setAt: number | null | undefined; until: number | undefined; left: number | null } | null>(null);
  const seen = useRef(false);
  const pauseRef = useRef(pause);
  pauseRef.current = pause;
  const nowMs = useCallback((): number | null => serverClock.now(), []);

  useEffect(() => {
    seen.current = false;
    firstSeen.current = null;
    setPause(kidId ? readStored(kidId) : null);
    if (!repo || !kidId) return;
    let stopped = false;
    void syncServerClock().then(() => !stopped && setTick((t) => t + 1));
    const off = repo.watchKid(
      kidId,
      (k, meta) => {
        if (!k) return;
        const next = pauseOf(k.settings);
        const prev = pauseRef.current;
        // A pause that arrives while this device is listening was stamped a moment ago: the stamp is the server's now.
        if (next && meta?.live && seen.current && next.setAt != null && next.setAt !== prev?.setAt) serverClock.atLeast(next.setAt);
        seen.current = true;
        writeStored(kidId, next);
        setPause(next);
        setTick((t) => t + 1);
      },
      { onError: () => undefined },
    );
    // Back to the front: the clock is read again (a sleeping device pauses the monotonic timer).
    const onShow = () => {
      if (document.visibilityState === 'visible') void syncServerClock().then(() => !stopped && setTick((t) => t + 1));
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      stopped = true;
      off();
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [repo, kidId]);

  // A timed pause ends by itself: tick once a second while one is on.
  const timed = !!pause && pause.until !== undefined;
  useEffect(() => {
    if (!timed) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timed]);

  const now = nowMs();
  const paused = isPaused(pause, now);
  const left = msLeft(pause, now);
  if (pause && left !== null) {
    const f = firstSeen.current;
    if (!f || f.setAt !== pause.setAt || f.until !== pause.until) firstSeen.current = { setAt: pause.setAt, until: pause.until, left };
  } else if (!pause) firstSeen.current = null;
  const total = firstSeen.current?.left ?? null;

  /** A fresh read before a run starts: the stored kid, then the clock. True when play is allowed. */
  const check = useCallback(async (): Promise<boolean> => {
    if (!repo || !kidId) return true;
    try {
      const k = await repo.getKid(kidId);
      if (k) {
        const p = pauseOf(k.settings);
        writeStored(kidId, p);
        setPause(p);
        pauseRef.current = p;
      }
    } catch {
      // Offline: the last known state applies.
    }
    // Only a timed pause needs the clock, and the clock is read at launch and whenever the app comes to the front: a read here
    // only waits for the network when there is no estimate yet. The common case (no pause) starts the run without a delay.
    if (pauseRef.current?.until !== undefined && serverClock.now() === null) await syncServerClock();
    return !isPaused(pauseRef.current, serverClock.now());
  }, [repo, kidId]);

  return { paused, pause, left, total, check };
}

/** After this long on one question, a paused run saves what is answered and leaves anyway, so a question left open cannot hold a pause off. */
export const PAUSE_GRACE_MS = 90_000;

/**
 * For a run screen. Returns a ref that is true while play is paused: check it at each question boundary and call the
 * run's normal save-and-leave when it is. `stop` also runs once after PAUSE_GRACE_MS of a pause, if the run is still open.
 */
export function usePauseStop(stop: () => void) {
  const { paused } = usePauseState();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (!paused) return;
    const id = setTimeout(() => stopRef.current(), PAUSE_GRACE_MS);
    return () => clearTimeout(id);
  }, [paused]);
  return pausedRef;
}
