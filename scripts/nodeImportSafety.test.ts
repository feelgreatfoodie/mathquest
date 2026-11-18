import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vite and vitest resolve extensionless imports, plain Node does not. The ops scripts run under plain
// Node, so each one is imported in a child process with no bundler. A broken import chain
// (ERR_MODULE_NOT_FOUND, ERR_UNKNOWN_FILE_EXTENSION, a syntax error in type-stripped code) exits non-zero.
const root = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTS = ['scripts/deploy-probe.mjs', 'scripts/backfill-parents.mjs', 'scripts/set-min-version.mjs'];

describe.each(SCRIPTS)('%s under plain Node', (script) => {
  it('imports without a module resolution error', () => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(`./${script}`)})`], { cwd: root, encoding: 'utf8' });
    expect(r.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|SyntaxError/);
    expect(r.status).toBe(0);
  });
  it('prints usage and exits 2 with no arguments', () => {
    const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    expect(r.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION/);
    expect(r.stderr).toMatch(/Usage/);
    expect(r.status).toBe(2);
  });
});
