// Writes functions/.secret.local with a fixed TEST pepper when the file is missing, so the Functions emulator can bind
// defineSecret('MQ_PIN_PEPPER'). The file is gitignored and the value is made up: the real pepper lives in Secret Manager
// and is never read here. An existing file is left alone.
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TEST_PEPPER_LINE = 'MQ_PIN_PEPPER=emulator-test-pepper-not-a-secret-0123456789abcdef\n';

export function ensureTestPepper(path = fileURLToPath(new URL('../functions/.secret.local', import.meta.url))) {
  if (existsSync(path)) return false;
  writeFileSync(path, TEST_PEPPER_LINE, { mode: 0o600 });
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(ensureTestPepper() ? 'wrote functions/.secret.local (test pepper)' : 'functions/.secret.local exists, left alone');
}
