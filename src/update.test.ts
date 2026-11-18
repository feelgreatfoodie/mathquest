import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, clearUpdateAttempt, settleUpdate } from './update';

function fakeBrowser() {
  const store = new Map<string, string>();
  const unregister = vi.fn().mockResolvedValue(true);
  const update = vi.fn().mockResolvedValue(undefined);
  const reload = vi.fn();
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [{ unregister, update }] } });
  vi.stubGlobal('caches', { keys: async () => [], delete: async () => true });
  vi.stubGlobal('location', { reload });
  return { unregister, update, reload };
}

describe('the update flow cannot loop', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.unstubAllGlobals());

  it('a tap that leaves the bundle behind escalates to the hard update, never repeats the soft one', async () => {
    const b = fakeBrowser();
    await applyUpdate();
    expect(b.update).toHaveBeenCalledTimes(1);
    expect(b.unregister).not.toHaveBeenCalled();
    await applyUpdate(); // the reload is still behind: drop the worker and the caches
    expect(b.unregister).toHaveBeenCalledTimes(1);
    expect(b.reload).toHaveBeenCalledTimes(2);
  });

  it('after the update, a bundle at or above minVersion clears the stale state', async () => {
    const b = fakeBrowser();
    await applyUpdate();
    expect(settleUpdate(200, 200)).toBe(false); // build >= minVersion: current, state cleared
    await applyUpdate(); // the next stale episode starts with the soft update again
    expect(b.unregister).not.toHaveBeenCalled();
    expect(b.update).toHaveBeenCalledTimes(2);
  });

  it('a bundle still behind keeps the state, so the next tap is the hard update', async () => {
    const b = fakeBrowser();
    await applyUpdate();
    expect(settleUpdate(100, 200)).toBe(true);
    await applyUpdate();
    expect(b.unregister).toHaveBeenCalledTimes(1);
    clearUpdateAttempt();
  });

  it('no minVersion means current', () => {
    fakeBrowser();
    expect(settleUpdate(100, null)).toBe(false);
  });
});
