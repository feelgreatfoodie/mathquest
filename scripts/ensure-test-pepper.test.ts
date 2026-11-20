import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no types
import { TEST_PEPPER_LINE, ensureTestPepper } from './ensure-test-pepper.mjs';

describe('ensureTestPepper', () => {
  it('writes the made-up test pepper when the file is missing, and leaves an existing file alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pepper-'));
    const path = join(dir, '.secret.local');
    try {
      expect(ensureTestPepper(path)).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe(TEST_PEPPER_LINE);
      expect(TEST_PEPPER_LINE).toMatch(/^MQ_PIN_PEPPER=.*not-a-secret/);
      writeFileSync(path, 'MQ_PIN_PEPPER=mine\n');
      expect(ensureTestPepper(path)).toBe(false);
      expect(readFileSync(path, 'utf8')).toBe('MQ_PIN_PEPPER=mine\n');
    } finally {
      rmSync(dir, { recursive: true });
    }
    expect(existsSync(path)).toBe(false);
  });
});
