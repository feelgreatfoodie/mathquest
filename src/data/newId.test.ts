import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './repo';

// An insecure http origin (a local build opened by IP on an iPad) has no crypto.randomUUID. newId must still return
// a 20-character id, and must never throw: a throw inside the save freezes the run.
afterEach(() => vi.unstubAllGlobals());

describe('newId', () => {
  it('returns 20 hex characters with crypto.randomUUID', () => {
    expect(newId()).toMatch(/^[0-9a-f]{20}$/);
  });

  it('falls back to crypto.getRandomValues when randomUUID is missing', () => {
    const getRandomValues = vi.fn((a: Uint8Array) => a.fill(171));
    vi.stubGlobal('crypto', { getRandomValues });
    expect(newId()).toBe('ab'.repeat(10));
    expect(getRandomValues).toHaveBeenCalled();
  });

  it('falls back to Math.random when crypto is missing entirely', () => {
    vi.stubGlobal('crypto', undefined);
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{20}$/);
  });
});
