import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no types
import { decide, parseArgs, parseBuild, setMinVersion, waitForLive } from './set-min-version.mjs';

const fakeDb = (initial?: unknown) => {
  let stored: Record<string, unknown> | undefined = initial === undefined ? undefined : { minVersion: initial };
  return {
    writes: [] as Record<string, unknown>[],
    doc() {
      const self = this;
      return {
        async get() {
          return { data: () => stored };
        },
        async set(d: Record<string, unknown>) {
          self.writes.push(d);
          stored = { ...stored, ...d };
        },
      };
    },
  };
};

describe('parseArgs', () => {
  it('needs a project id and gives the web.app url by default', () => {
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(['--project'])).toBeNull();
    expect(parseArgs(['--project', 'Bad_ID'])).toBeNull();
    expect(parseArgs(['--project', 'demo-proj1'])).toMatchObject({ project: 'demo-proj1', url: 'https://demo-proj1.web.app', dist: 'dist', dryRun: false, force: false });
  });
  it('takes a custom url, refuses a non-https one, reads flags', () => {
    expect(parseArgs(['--project', 'demo-proj1', '--url', 'https://math.example.com/', '--dry-run', '--force'])).toMatchObject({ url: 'https://math.example.com', dryRun: true, force: true });
    expect(parseArgs(['--project', 'demo-proj1', '--url', 'http://math.example.com'])).toBeNull();
  });
});

describe('parseBuild', () => {
  it('reads a positive integer build and rejects anything else', () => {
    expect(parseBuild('{"build":1763433600}')).toBe(1763433600);
    for (const bad of ['{}', '{"build":"5"}', '{"build":0}', '{"build":-3}', '{"build":1.5}']) expect(() => parseBuild(bad)).toThrow();
  });
});

describe('decide', () => {
  it('sets when unset, raises, keeps an equal build, refuses to lower without force', () => {
    expect(decide({ build: 10, current: undefined, force: false }).action).toBe('set');
    expect(decide({ build: 10, current: 5, force: false }).action).toBe('set');
    expect(decide({ build: 10, current: 10, force: false }).action).toBe('keep');
    expect(decide({ build: 10, current: 20, force: false }).action).toBe('refuse');
    expect(decide({ build: 10, current: 20, force: true }).action).toBe('set');
    expect(decide({ build: 10, current: 'x', force: false }).action).toBe('set');
  });
});

describe('waitForLive', () => {
  const ok = (build: number) => async () => ({ ok: true, status: 200, json: async () => ({ build }) });
  it('returns when the live build matches', async () => {
    await waitForLive({ url: 'https://x.example', build: 7, fetchImpl: ok(7) as never, sleep: async () => {} });
  });
  it('waits through an old build, then gives up with minVersion not set', async () => {
    let n = 0;
    const f = async () => ({ ok: true, status: 200, json: async () => ({ build: ++n < 3 ? 6 : 7 }) });
    await waitForLive({ url: 'https://x.example', build: 7, fetchImpl: f as never, sleep: async () => {} });
    expect(n).toBe(3);
    await expect(waitForLive({ url: 'https://x.example', build: 7, fetchImpl: ok(6) as never, tries: 3, sleep: async () => {} })).rejects.toThrow(/minVersion NOT set/);
  });
  it('survives a network error and an HTTP error', async () => {
    let n = 0;
    const f = async () => {
      if (++n === 1) throw new Error('offline');
      if (n === 2) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ build: 7 }) };
    };
    await waitForLive({ url: 'https://x.example', build: 7, fetchImpl: f as never, sleep: async () => {} });
  });
});

describe('setMinVersion', () => {
  it('writes the build, reads it back, and records when', async () => {
    const db = fakeDb();
    const r = await setMinVersion({ db, build: 50, now: () => new Date('2026-11-18T03:00:00Z') });
    expect(r).toMatchObject({ before: undefined, build: 50, action: 'set' });
    expect(db.writes).toEqual([{ minVersion: 50, setAt: '2026-11-18T03:00:00.000Z', setBy: 'scripts/set-min-version.mjs' }]);
  });
  it('writes nothing for an equal build or a dry run, and refuses to lower', async () => {
    const same = fakeDb(50);
    await setMinVersion({ db: same, build: 50 });
    expect(same.writes).toHaveLength(0);
    const dry = fakeDb(10);
    await setMinVersion({ db: dry, build: 50, dryRun: true });
    expect(dry.writes).toHaveLength(0);
    const newer = fakeDb(90);
    await expect(setMinVersion({ db: newer, build: 50 })).rejects.toThrow(/lower/);
    expect(newer.writes).toHaveLength(0);
    await setMinVersion({ db: newer, build: 50, force: true });
    expect(newer.writes).toHaveLength(1);
  });
});
