import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkWhatsnew } from './check-whatsnew.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (files: string[], labels: string[]) =>
  spawnSync(process.execPath, ['scripts/check-whatsnew.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CHANGED_FILES: files.join('\n'), PR_LABELS: JSON.stringify(labels) },
  });

describe('checkWhatsnew (pure)', () => {
  it('fails when src/ changes and whatsnew.ts does not', () => {
    expect(checkWhatsnew({ files: ['src/ui/screens/Parent.tsx'], labels: [] }).ok).toBe(false);
  });
  it('passes when src/whatsnew.ts changes too', () => {
    expect(checkWhatsnew({ files: ['src/ui/screens/Parent.tsx', 'src/whatsnew.ts'], labels: [] }).ok).toBe(true);
  });
  it('passes with the no-whatsnew label', () => {
    expect(checkWhatsnew({ files: ['src/engine/mastery.ts'], labels: ['no-whatsnew'] }).ok).toBe(true);
  });
  it('passes when nothing under src/ changes', () => {
    expect(checkWhatsnew({ files: ['README.md', 'firestore.rules', 'e2e/a.e2e.ts'], labels: [] }).ok).toBe(true);
  });
});

describe('scripts/check-whatsnew.mjs on a fake diff', () => {
  it('exits 1 for src/ without whatsnew', () => {
    const r = run(['src/styles.css', 'README.md'], ['bug']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/whatsnew/);
  });
  it('exits 0 when whatsnew.ts is in the diff', () => {
    expect(run(['src/styles.css', 'src/whatsnew.ts'], []).status).toBe(0);
  });
  it('exits 0 with the no-whatsnew label', () => {
    expect(run(['src/styles.css'], ['no-whatsnew']).status).toBe(0);
  });
});

describe('scripts/check-whatsnew.mjs reading git', () => {
  it('fails on a real diff that touches src/ only, passes when whatsnew.ts is added', () => {
    const git = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });
    const dir = mkdtempSync(join(tmpdir(), 'wn-'));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'a@b.c');
    git(dir, 'config', 'user.name', 'x');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/a.ts'), '1');
    writeFileSync(join(dir, 'src/whatsnew.ts'), '1');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'base');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(join(dir, 'src/a.ts'), '2');
    git(dir, 'commit', '-qam', 'src only');
    const head1 = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(join(dir, 'src/whatsnew.ts'), '2');
    git(dir, 'commit', '-qam', 'with whatsnew');
    const head2 = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const script = join(root, 'scripts/check-whatsnew.mjs');
    const go = (head: string) => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env: { ...process.env, CHANGED_FILES: undefined, BASE_SHA: base, HEAD_SHA: head, PR_LABELS: '[]' } });
    expect(go(head1).status).toBe(1);
    expect(go(head2).status).toBe(0);
  });
});
