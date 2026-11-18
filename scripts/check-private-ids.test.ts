import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no types
import { hashToken, parseHashes, scanDiff } from './check-private-ids.mjs';

// Every value below is made up. The real list holds hashes only (scripts/private-id-hashes.txt).
const FAKE_KID = 'a1b2c3d4e5f60718293a';
const FAKE_FAMILY = 'Zy9Xw8Vu7Ts6Rq5Pn4Mm3Lk2Jh1';
const hashes = parseHashes(
  [`${hashToken(FAKE_KID)}  kid doc id`, `${hashToken(FAKE_FAMILY)}  family id`, `${hashToken('pip')}  first name`].join('\n'),
);

const diff = (path: string, ...added: string[]) =>
  [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -0,0 +1,${added.length} @@`, ...added.map((l) => `+${l}`)].join('\n');

describe('scanDiff', () => {
  it('passes a clean diff', () => {
    expect(scanDiff(diff('src/a.ts', 'const x = 1;', 'const y = "kid_123";'), hashes)).toEqual([]);
  });
  it('finds a kid id, a family id and a name, with the file and line and no token', () => {
    const found = scanDiff(diff('src/a.ts', 'ok', `const id = '${FAKE_KID}';`, `// family ${FAKE_FAMILY}`, 'name: PIP'), hashes);
    expect(found.map((f: { label: string; line: number }) => [f.label, f.line])).toEqual([['kid doc id', 2], ['family id', 3], ['first name', 4]]);
    expect(JSON.stringify(found)).not.toContain(FAKE_KID);
  });
  it('finds an id inside a path or a path-like string', () => {
    expect(scanDiff(diff(`.private-eval/cards-${FAKE_KID}.json`, 'x'), hashes)[0]?.label).toBe('kid doc id');
    expect(scanDiff(diff('src/a.ts', `families/${FAKE_FAMILY}/kids/x`), hashes)).toHaveLength(1);
  });
  it('ignores removed lines and context lines', () => {
    const d = ['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -1,2 +1,1 @@', `-${FAKE_KID}`, ` ${FAKE_FAMILY}`, '+fine'].join('\n');
    expect(scanDiff(d, hashes)).toEqual([]);
  });
  it('matches a token as written and in lower case, not as a substring of a longer word', () => {
    expect(scanDiff(diff('f', 'Pip'), hashes)).toHaveLength(1);
    expect(scanDiff(diff('f', 'pipeline'), hashes)).toEqual([]);
  });
});

describe('the real hash list', () => {
  const real = parseHashes(readFileSync(new URL('./private-id-hashes.txt', import.meta.url), 'utf8'));
  it('has hashes with labels and holds no readable value', () => {
    expect(real.size).toBeGreaterThanOrEqual(5);
    for (const [h, label] of real) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(label.length).toBeGreaterThan(3);
    }
  });
});
