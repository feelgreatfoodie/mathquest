import { readFileSync } from 'node:fs';
import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME } from '../src/engine/models';
// @ts-expect-error plain .mjs script, no types
import { MISMATCH_MESSAGE, buildDocs, callableUrl, checkBundle, checkSignIn, checkWrongPin, decodeJwtPayload, hashPin, liveUrl, makeProbe, parseArgs, probeBundle, scriptUrls } from './deploy-probe.mjs';

const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const P = { familyUid: 'probe-fam', kidId: 'probe-kid', name: 'zprobeabc', nameKey: 'zprobeabc', pin: '1234', wrongPin: '4321' };
const good = { result: { token: jwt({ uid: 'kid_probe-kid', claims: { role: 'kid', familyUid: 'probe-fam', kidId: 'probe-kid' } }) } };

describe('deploy-probe pieces (no network)', () => {
  it('seeds the kid with the full default game map', () => {
    const kid = (buildDocs(P, 1, Buffer.alloc(16)) as [string, Record<string, unknown>][]).find(([path]) => path.includes('/kids/'))![1];
    expect(kid.game).toEqual(DEFAULT_GAME);
    expect(Object.keys(kid.game as object).sort()).toEqual(['bestCombo', 'gems', 'hero', 'heroes', 'lastPlayedDay', 'streakDays', 'xp']);
  });
  it('builds the callable URL for a project', () => {
    expect(callableUrl('my-proj-1')).toBe('https://us-west1-my-proj-1.cloudfunctions.net/kidSignIn');
  });
  it('parses --project and rejects a missing or odd value', () => {
    expect(parseArgs(['--project', 'my-proj-1'])).toEqual({ project: 'my-proj-1', url: 'https://my-proj-1.web.app/' });
    expect(parseArgs(['--project', 'my-proj-1', '--url', 'https://math.example.com'])).toEqual({ project: 'my-proj-1', url: 'https://math.example.com' });
    expect(parseArgs(['--project', 'my-proj-1', '--url', 'http://insecure.example.com'])).toBeNull();
    expect(parseArgs(['--project', 'my-proj-1', '--url'])).toBeNull();
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(['--project'])).toBeNull();
    expect(parseArgs(['--project', '--x'])).toBeNull();
    expect(parseArgs(['--project', 'a b'])).toBeNull();
  });
  it('makes a different random probe each time, with a wrong PIN that differs', () => {
    const a = makeProbe();
    const b = makeProbe();
    expect(a.familyUid).not.toBe(b.familyUid);
    expect(a.name).toMatch(/^zprobe[a-z]{8}$/);
    expect(a.pin).toMatch(/^\d{4}$/);
    expect(a.wrongPin).not.toBe(a.pin);
  });
  it('hashes a PIN like setKidPin: scrypt, 32 bytes', () => {
    const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    expect(hashPin('1234', salt).equals(scryptSync('1234', salt, 32))).toBe(true);
    const core = readFileSync(new URL('../functions/src/core.ts', import.meta.url), 'utf8');
    expect(core).toMatch(/scrypt\(pin, salt, 32,/);
  });
  it('writes the five docs a signed-in kid needs, with a stored hash that verifies', () => {
    const salt = Buffer.alloc(16, 1);
    const docs = buildDocs(P, 5, salt) as [string, Record<string, unknown>][];
    expect(docs.map((d) => d[0])).toEqual([
      'parents/probe-fam',
      'families/probe-fam',
      'families/probe-fam/kids/probe-kid',
      'pinIndex/probe-fam/kids/probe-kid',
      'nameKeys/zprobeabc',
    ]);
    const row = docs[3]![1];
    expect(row.hash).toBe(scryptSync('1234', salt, 32).toString('hex'));
    expect(JSON.stringify(docs)).not.toContain('@example.com');
  });
  it('decodes a JWT payload and rejects junk', () => {
    expect(decodeJwtPayload(jwt({ a: 1 }))).toEqual({ a: 1 });
    expect(() => decodeJwtPayload('nope')).toThrow();
  });
  it('accepts a token with role kid and the right ids', () => {
    expect(checkSignIn(200, good, P)).toEqual([]);
  });
  it('rejects wrong role, familyUid, kidId, and a missing token', () => {
    const t = (claims: object) => ({ result: { token: jwt({ uid: 'kid_probe-kid', claims }) } });
    expect(checkSignIn(200, t({ role: 'parent', familyUid: 'probe-fam', kidId: 'probe-kid' }), P).join()).toContain('role');
    expect(checkSignIn(200, t({ role: 'kid', familyUid: 'other', kidId: 'probe-kid' }), P).join()).toContain('familyUid');
    expect(checkSignIn(200, t({ role: 'kid', familyUid: 'probe-fam', kidId: 'other' }), P).join()).toContain('kidId');
    expect(checkSignIn(200, { result: {} }, P)).toEqual(['right PIN: response has no token']);
    expect(checkSignIn(403, { error: { message: MISMATCH_MESSAGE } }, P)[0]).toContain('HTTP 403');
  });
  it('wants the generic error for a wrong PIN and fails on success or another message', () => {
    expect(checkWrongPin(403, { error: { message: MISMATCH_MESSAGE, status: 'PERMISSION_DENIED' } })).toEqual([]);
    expect(checkWrongPin(200, good)[0]).toContain('succeeded');
    expect(checkWrongPin(500, { error: { message: 'INTERNAL' } })[0]).toContain('generic message');
  });
  it('keeps the generic message in step with core.ts', () => {
    const core = readFileSync(new URL('../functions/src/core.ts', import.meta.url), 'utf8');
    expect(core).toContain(`MISMATCH_MESSAGE = "${MISMATCH_MESSAGE}"`);
  });
});

// The served bundle must carry the Firebase project id. A no-config bundle has none and runs in local mode.
describe('deploy-probe bundle check (no network)', () => {
  const PROJECT = 'demo-proj-1';
  const html = '<html><head><script type="module" crossorigin src="/assets/index-abc123.js"></script><link rel="modulepreload" href="/assets/vendor-def456.js"><link rel="stylesheet" href="/assets/index-x.css"><script src="https://cdn.example.com/x.js"></script></head></html>';
  const page = 'https://demo-proj-1.web.app/';
  const reply = (files: Record<string, string>, pageHtml = html) => async (u: string) => {
    if (u === page) return { ok: true, status: 200, text: async () => pageHtml };
    const t = files[u];
    return t === undefined ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => t };
  };
  it('builds the default live URL from the project', () => {
    expect(liveUrl(PROJECT)).toBe(page);
  });
  it('finds module scripts and preloads, resolves them against the page, skips css, keeps order, no repeats', () => {
    expect(scriptUrls(html + html, page)).toEqual([
      'https://demo-proj-1.web.app/assets/index-abc123.js',
      'https://demo-proj-1.web.app/assets/vendor-def456.js',
      'https://cdn.example.com/x.js',
    ]);
  });
  it('passes when a served script contains the project id', () => {
    expect(checkBundle([{ url: 'a', text: 'x' }, { url: 'b', text: `a={projectId:"${PROJECT}"}` }], PROJECT)).toEqual([]);
  });
  it('fails when no script contains the project id (a no-config bundle), and when the page loads no script', () => {
    expect(checkBundle([{ url: 'a', text: 'projectId:void 0' }], PROJECT)[0]).toContain('none of 1 served script');
    expect(checkBundle([{ url: 'a', text: null }], PROJECT)[0]).toContain(PROJECT);
    expect(checkBundle([], PROJECT)).toEqual(['bundle: the page loads no script files']);
  });
  it('fetches the live page and its scripts, and passes on a configured bundle', async () => {
    const fetchImpl = reply({ 'https://demo-proj-1.web.app/assets/index-abc123.js': `projectId:"${PROJECT}"`, 'https://demo-proj-1.web.app/assets/vendor-def456.js': 'v', 'https://cdn.example.com/x.js': 'c' });
    expect(await probeBundle({ url: page, project: PROJECT, fetchImpl })).toEqual([]);
  });
  it('fails a served no-config bundle even though the page and scripts load fine', async () => {
    const fetchImpl = reply({ 'https://demo-proj-1.web.app/assets/index-abc123.js': 'const cfg={apiKey:void 0,projectId:void 0}', 'https://demo-proj-1.web.app/assets/vendor-def456.js': 'v', 'https://cdn.example.com/x.js': 'c' });
    const problems = await probeBundle({ url: page, project: PROJECT, fetchImpl });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('kid sign-in would fail');
  });
  it('fails on an HTTP error for the page, and on a network error', async () => {
    expect((await probeBundle({ url: page, project: PROJECT, fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) }))[0]).toContain('HTTP 503');
    expect((await probeBundle({ url: page, project: PROJECT, fetchImpl: async () => { throw new Error('offline'); } }))[0]).toContain('offline');
  });
  it('the script calls the bundle check inside probe() so a passing sign-in cannot hide a bad bundle', () => {
    const src = readFileSync(new URL('./deploy-probe.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/problems\.push\(\.\.\.\(await probeBundle\(/);
  });
});
