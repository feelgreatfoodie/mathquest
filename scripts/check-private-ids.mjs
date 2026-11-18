// Fails when a PR adds a real kid doc id, the family id or a real first name to the public repo.
//   git diff --unified=0 origin/main...HEAD | node scripts/check-private-ids.mjs
// It reads a unified diff (and, appended, commit messages with a "+" prefix) from stdin, hashes every
// alphanumeric token of the added lines and of the file paths, and compares the hashes with
// scripts/private-id-hashes.txt. The file holds SHA-256 hashes only, never the values.
//
// Why hashes in the repo and not a CI secret: the ids are 20 to 28 random characters, so a published hash
// cannot be reversed by guessing; no secret has to exist for the check to run, forks and local runs get the
// same answer, and a reviewer can read the list. Names are short, so their hashes are guessable: keep only the
// hash of a first name when the risk is accepted. Tokens are tested as written and in lower case.
// It prints the label and the file and line, never the token.
//
// Names: first names are never stored in the repo, not even as hashes (a hash of a first name is reversed with a
// list of common names). They are read from a local file outside the repo, $MQ_PRIVATE_NAMES or
// ~/.config/mathquest/private-names.txt, one name per line. Matching is case-insensitive on word boundaries,
// possessives included. A missing file prints a warning and skips the name check, so CI still passes.
//
// Text mode: `node scripts/check-private-ids.mjs --text <file>` scans a file (a PR title and body) with the same
// id-hash and name checks. `npm run leak-scan -- --pr <n>` fetches the text with gh and runs it.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export function parseHashes(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

export const defaultNamesPath = () => process.env.MQ_PRIVATE_NAMES || join(homedir(), '.config', 'mathquest', 'private-names.txt');

/** Reads the local names file. Returns { regex, count, warning }; regex is null when no names were loaded. */
export function loadNames(path = defaultNamesPath()) {
  if (!existsSync(path)) return { regex: null, count: 0, warning: 'private names file not found, name check skipped (set MQ_PRIVATE_NAMES)' };
  const names = readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 2 && !l.startsWith('#'));
  if (!names.length) return { regex: null, count: 0, warning: 'private names file is empty, name check skipped' };
  return { regex: namesRegex(names), count: names.length, warning: null };
}

/** Case-insensitive, word-bounded; "Name's" matches because the apostrophe is not a word character. */
export function namesRegex(names) {
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'iu');
}

/** Findings for a plain text (a PR title and body): ids by hash, names by the local list. */
export function scanText(text, hashes, namesRe = null, file = 'text') {
  return scanDiff(
    ['diff --git a/' + file + ' b/' + file, '@@ -0,0 +1 @@', ...text.split('\n').map((l) => '+' + l)].join('\n'),
    hashes,
    namesRe,
  ).filter((f) => f.line > 0);
}

/** Findings as { label, file, line } for every added line or path whose token hashes into `hashes` or matches `namesRe`. */
export function scanDiff(diff, hashes, namesRe = null) {
  const found = [];
  let file = '?';
  let line = 0;
  for (const raw of diff.split('\n')) {
    const hunk = /^@@ -\S+ \+(\d+)/.exec(raw);
    if (raw.startsWith('diff --git ')) {
      file = raw.split(' b/')[1] ?? '?';
      line = 0;
      check(raw.slice(11), file, 0);
      continue;
    }
    if (hunk) {
      line = Number(hunk[1]) - 1;
      continue;
    }
    if (raw.startsWith('+++ ') || raw.startsWith('--- ')) continue;
    if (raw.startsWith('+')) {
      line++;
      check(raw.slice(1), file, line);
    } else if (!raw.startsWith('-')) line++;
  }
  return found;

  function check(text, f, n) {
    if (namesRe && namesRe.test(text)) found.push({ label: 'private name', file: f, line: n });
    for (const tok of text.split(/[^A-Za-z0-9]+/)) {
      if (tok.length < 3 || tok.length > 64) continue;
      for (const variant of new Set([tok, tok.toLowerCase()])) {
        const label = hashes.get(hashToken(variant));
        if (label) found.push({ label, file: f, line: n });
      }
    }
  }
}

function main() {
  const hashes = parseHashes(readFileSync(new URL('./private-id-hashes.txt', import.meta.url), 'utf8'));
  if (!hashes.size) {
    console.error('check-private-ids: no hashes loaded');
    process.exit(2);
  }
  const names = loadNames();
  if (names.warning) console.error(`check-private-ids WARNING: ${names.warning}`);
  const args = process.argv.slice(2);
  const ti = args.indexOf('--text');
  let found;
  let where;
  if (ti >= 0) {
    const file = args[ti + 1];
    if (!file) {
      console.error('check-private-ids: --text needs a file');
      process.exit(2);
    }
    found = scanText(readFileSync(file, 'utf8'), hashes, names.regex, 'pr-text');
    where = 'the text';
  } else {
    found = scanDiff(readFileSync(0, 'utf8'), hashes, names.regex);
    where = 'the diff';
  }
  for (const f of found) console.error(`FAIL ${f.label} at ${f.file}:${f.line}`);
  const checked = `${hashes.size} hashes, ${names.count} names`;
  console.log(found.length ? `check-private-ids FAIL: ${found.length} private value(s) in ${where}` : `check-private-ids PASS (${checked})`);
  process.exit(found.length ? 1 : 0);
}

/** `npm run leak-scan -- --pr <n>`: fetch the PR title and body with gh and scan them. */
function leakScan() {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--pr');
  const n = pi >= 0 ? args[pi + 1] : '';
  if (!/^\d+$/.test(n ?? '')) {
    console.error('usage: leak-scan --pr <number>');
    process.exit(2);
  }
  const view = spawnSync('gh', ['pr', 'view', n, '--json', 'title,body'], { encoding: 'utf8' });
  if (view.status !== 0) {
    console.error(`leak-scan: gh pr view ${n} failed`);
    process.exit(2);
  }
  const { title, body } = JSON.parse(view.stdout);
  const dir = mkdtempSync(join(tmpdir(), 'leak-scan-'));
  try {
    const file = join(dir, 'pr-text.txt');
    writeFileSync(file, `${title}\n${body ?? ''}\n`);
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--text', file], { stdio: 'inherit' });
    process.exit(r.status ?? 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.argv.includes('--pr') ? leakScan() : main();
