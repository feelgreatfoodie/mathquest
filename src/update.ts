// "Update" for a stale bundle: ask the service worker for the new release, wait for it to take over, reload.
// If the reload is still behind (the worker never changed), the second tap drops the worker and every cache,
// so the reload fetches the bundle fresh from the network.

import { isBehind } from './version';

const TRIED_KEY = 'mathquest:update-tried';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Call when a check finds the bundle current again, so the next stale episode starts with the soft update. */
export function clearUpdateAttempt(): void {
  try {
    storage()?.removeItem(TRIED_KEY);
  } catch {
    // ignore
  }
}

/**
 * Call with this bundle's build and the latest minVersion. A bundle at or above minVersion is current: the update
 * attempt is cleared, so the next stale episode starts with the soft update. Returns true while still behind.
 */
export function settleUpdate(build: number, min: number | null): boolean {
  const behind = isBehind(build, min);
  if (!behind) clearUpdateAttempt();
  return behind;
}

function activated(reg: ServiceWorkerRegistration, ms: number): Promise<void> {
  const worker = reg.installing ?? reg.waiting;
  if (!worker || worker.state === 'activated') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    const timer = setTimeout(done, ms);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        clearTimeout(timer);
        done();
      }
    });
    worker.postMessage({ type: 'SKIP_WAITING' });
  });
}

export async function applyUpdate(): Promise<void> {
  const s = storage();
  const secondTry = s?.getItem(TRIED_KEY) === '1';
  try {
    s?.setItem(TRIED_KEY, '1');
  } catch {
    // ignore
  }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    if (secondTry) {
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = (await globalThis.caches?.keys?.()) ?? [];
      await Promise.all(keys.map((k) => caches.delete(k)));
    } else {
      await Promise.all(regs.map((r) => r.update()));
      await Promise.all(regs.map((r) => activated(r, 6000)));
    }
  } catch (e) {
    console.error('Update failed; reloading anyway.', e);
  }
  location.reload();
}
