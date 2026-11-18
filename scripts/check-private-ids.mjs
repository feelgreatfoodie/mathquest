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

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export function parseHashes(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** Findings as { label, file, line } for every added line or path whose token hashes into `hashes`. */
export function scanDiff(diff, hashes) {
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
  const found = scanDiff(readFileSync(0, 'utf8'), hashes);
  for (const f of found) console.error(`FAIL ${f.label} at ${f.file}:${f.line}`);
  console.log(found.length ? `check-private-ids FAIL: ${found.length} private value(s) in the diff` : `check-private-ids PASS (${hashes.size} hashes)`);
  process.exit(found.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
