import { describe, expect, it } from 'vitest';
import { clientIp } from '../src/core.js';

// Addresses are from the documentation ranges (RFC 5737).
const REAL = '198.51.100.9';
const FORGED = '203.0.113.7';

describe('clientIp (per-IP limit source)', () => {
  it('no header: falls back to req.ip, then to unknown', () => {
    expect(clientIp(undefined, REAL)).toBe(REAL);
    expect(clientIp(undefined, undefined)).toBe('unknown');
  });

  it('one entry: that entry is the client', () => {
    expect(clientIp(REAL, '10.0.0.1')).toBe(REAL);
  });

  it('forged prefix plus the real entry: the forged entry never picks the bucket', () => {
    expect(clientIp(`${FORGED}, ${REAL}`, FORGED)).toBe(REAL);
    expect(clientIp(`1.1.1.1, ${FORGED}, ${REAL}`)).toBe(REAL);
  });

  it('rotating the forged prefix keeps one bucket', () => {
    const a = clientIp(`203.0.113.1, ${REAL}`);
    const b = clientIp(`203.0.113.2, ${REAL}`);
    expect(a).toBe(b);
  });

  it('empty or blank header: falls back', () => {
    expect(clientIp('', REAL)).toBe(REAL);
    expect(clientIp(' , ,', undefined)).toBe('unknown');
  });

  it('array header is joined, last entry wins', () => {
    expect(clientIp([FORGED, REAL])).toBe(REAL);
  });

  it('hops=2 skips one more trusted entry; short headers clamp to the first entry', () => {
    expect(clientIp(`${FORGED}, ${REAL}, 10.0.0.2`, undefined, 2)).toBe(REAL);
    expect(clientIp(REAL, undefined, 2)).toBe(REAL);
  });
});
