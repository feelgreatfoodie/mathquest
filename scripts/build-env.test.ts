import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no types
import { buildEnvMessage, buildEnvProblems } from './build-env.mjs';

// `vite build` must refuse a bundle with no Firebase project id or API key, unless VITE_DATA_MODE=local is set on purpose.
// Why: a rollback from a fresh worktree shipped a no-config bundle that fell back to local mode and broke kid sign-in.
describe('buildEnvProblems', () => {
  const full = { VITE_FIREBASE_PROJECT_ID: 'demo-proj-1', VITE_FIREBASE_API_KEY: 'fake-key', VITE_DATA_MODE: '' };
  it('passes with both set', () => {
    expect(buildEnvProblems(full)).toEqual([]);
  });
  it('fails on an empty, blank or missing project id or API key', () => {
    expect(buildEnvProblems({ ...full, VITE_FIREBASE_PROJECT_ID: '' })).toEqual(['VITE_FIREBASE_PROJECT_ID is empty']);
    expect(buildEnvProblems({ ...full, VITE_FIREBASE_API_KEY: '   ' })).toEqual(['VITE_FIREBASE_API_KEY is empty']);
    expect(buildEnvProblems({})).toEqual(['VITE_FIREBASE_PROJECT_ID is empty', 'VITE_FIREBASE_API_KEY is empty']);
  });
  it('passes with no config when VITE_DATA_MODE=local is set on purpose, and only for the exact value "local"', () => {
    expect(buildEnvProblems({ VITE_DATA_MODE: 'local' })).toEqual([]);
    expect(buildEnvProblems({ VITE_DATA_MODE: 'Local' })).toHaveLength(2);
    expect(buildEnvProblems({ VITE_DATA_MODE: 'true' })).toHaveLength(2);
  });
  it('names both variables and the way out in the message', () => {
    const m = buildEnvMessage(buildEnvProblems({}));
    expect(m).toContain('VITE_FIREBASE_PROJECT_ID');
    expect(m).toContain('VITE_FIREBASE_API_KEY');
    expect(m).toContain('VITE_DATA_MODE=local');
  });
});

describe('vite build gate (real build into a temp folder)', () => {
  const run = (env: Record<string, string>) => {
    const out = mkdtempSync(join(tmpdir(), 'mq-build-'));
    try {
      const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', out, '--emptyOutDir'], {
        cwd: process.cwd(),
        // Shell values win over any .env file, so a developer's .env.local cannot change the result.
        env: { ...process.env, VITE_FIREBASE_PROJECT_ID: '', VITE_FIREBASE_API_KEY: '', VITE_DATA_MODE: '', ...env },
        encoding: 'utf8',
      });
      return { status: r.status, text: `${r.stdout}\n${r.stderr}` };
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  };
  it('fails with an empty project id and API key, and says why', () => {
    const r = run({});
    expect(r.status).not.toBe(0);
    expect(r.text).toContain('Build refused');
    expect(r.text).toContain('VITE_FIREBASE_PROJECT_ID is empty');
  }, 60_000);
  it('fails with only the API key empty', () => {
    const r = run({ VITE_FIREBASE_PROJECT_ID: 'demo-proj-1' });
    expect(r.status).not.toBe(0);
    expect(r.text).toContain('VITE_FIREBASE_API_KEY is empty');
  }, 60_000);
  it('builds with VITE_DATA_MODE=local on purpose, and with both values set', () => {
    expect(run({ VITE_DATA_MODE: 'local' }).status).toBe(0);
    expect(run({ VITE_FIREBASE_PROJECT_ID: 'demo-proj-1', VITE_FIREBASE_API_KEY: 'fake-key' }).status).toBe(0);
  }, 120_000);
});
