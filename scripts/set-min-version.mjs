// Sets config/app.minVersion to the build that was just deployed. Run it as the last step of a release:
//   node scripts/set-min-version.mjs --project <gcp-project-id> [--url https://math.rezzed.ai] [--dist dist] [--dry-run] [--force]
//   node scripts/set-min-version.mjs --from-firebaserc      (project from .firebaserc default; what `npm run deploy` uses)
// Needs application default credentials with Firestore write on the project. Exit 0 = set (or already set),
// 1 = refused or failed, 2 = bad usage. It prints one summary line.
//
// What it protects: a bundle older than minVersion shows the update screen and writes nothing. If minVersion
// were set before the new bundle is live, every client would be told to update to a bundle that does not
// exist yet and loop. So it (1) reads the build from dist/version.json, (2) waits until the LIVE site serves
// that same build in /version.json, (3) refuses to lower an existing minVersion without --force, (4) writes
// config/app and reads it back. Firestore rules deny every client write to config/app; only this script
// (Admin SDK, rules skipped) sets it.

import { readFileSync } from 'node:fs';

export const DOC_PATH = 'config/app';

export function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  let project = get('--project');
  if (!project && argv.includes('--from-firebaserc')) {
    try {
      project = JSON.parse(readFileSync('.firebaserc', 'utf8')).projects?.default;
    } catch {
      return null;
    }
  }
  if (!project || project.startsWith('--') || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) return null;
  const url = (get('--url') ?? `https://${project}.web.app`).replace(/\/+$/, '');
  // https only, except a local server for the dry run against the emulators.
  if (!/^(https:\/\/[^/\s]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(url)) return null;
  return { project, url, dist: get('--dist') ?? 'dist', dryRun: argv.includes('--dry-run'), force: argv.includes('--force') };
}

/** A build is a positive integer (seconds since the epoch at build time). */
export function parseBuild(raw) {
  const b = typeof raw === 'string' ? JSON.parse(raw)?.build : raw?.build;
  if (!Number.isInteger(b) || b <= 0) throw new Error(`version.json has no valid build (got ${JSON.stringify(b)})`);
  return b;
}

/** Decides what to write. Returns { action: 'set' | 'keep' | 'refuse', reason }. */
export function decide({ build, current, force }) {
  if (current === undefined || current === null) return { action: 'set', reason: 'no minVersion yet' };
  if (typeof current !== 'number' || !Number.isFinite(current)) return { action: 'set', reason: `existing minVersion is not a number (${JSON.stringify(current)})` };
  if (current === build) return { action: 'keep', reason: 'already at this build' };
  if (current > build && !force) return { action: 'refuse', reason: `existing minVersion ${current} is newer than this build ${build}; this would lower the gate (use --force to lower it)` };
  return { action: 'set', reason: current > build ? 'lowered with --force' : 'raised' };
}

/** Waits until the live site serves `build` in /version.json. Throws after `tries` attempts. */
export async function waitForLive({ url, build, fetchImpl = fetch, tries = 12, delayMs = 10_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} }) {
  let last = 'no response';
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchImpl(`${url}/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const live = parseBuild(await res.json());
        if (live === build) return;
        last = `live build ${live}`;
      } else last = `HTTP ${res.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    log(`live site is not serving build ${build} yet (${last}); attempt ${i + 1}/${tries}`);
    if (i < tries - 1) await sleep(delayMs);
  }
  throw new Error(`${url}/version.json never served build ${build} (last: ${last}). minVersion NOT set.`);
}

export async function setMinVersion({ db, build, force = false, dryRun = false, now = () => new Date() }) {
  const ref = db.doc(DOC_PATH);
  const before = (await ref.get()).data()?.minVersion;
  const d = decide({ build, current: before, force });
  if (d.action === 'refuse') throw new Error(d.reason);
  if (d.action === 'set' && !dryRun) {
    await ref.set({ minVersion: build, setAt: now().toISOString(), setBy: 'scripts/set-min-version.mjs' }, { merge: true });
    const after = (await ref.get()).data()?.minVersion;
    if (after !== build) throw new Error(`read back minVersion ${JSON.stringify(after)} after writing ${build}`);
  }
  return { before, build, ...d };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('Usage: node scripts/set-min-version.mjs --project <gcp-project-id> [--url https://host] [--dist dist] [--dry-run] [--force]\n       node scripts/set-min-version.mjs --from-firebaserc');
    process.exit(2);
  }
  const build = parseBuild(readFileSync(`${args.dist}/version.json`, 'utf8'));
  await waitForLive({ url: args.url, build, log: console.error });
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId: args.project });
  const r = await setMinVersion({ db: getFirestore(), build, force: args.force, dryRun: args.dryRun });
  console.log(`set-min-version ${r.action === 'refuse' ? 'REFUSED' : args.dryRun ? 'DRY-RUN' : 'OK'} project=${args.project} ${DOC_PATH} minVersion ${r.before ?? 'unset'} -> ${r.action === 'keep' ? r.build : args.dryRun ? `${r.build} (not written)` : r.build} (${r.reason}); live ${args.url} serves build ${build}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    console.log('set-min-version FAIL');
    process.exit(1);
  });
}
