// CI check: a PR that changes src/ must also change src/whatsnew.ts, unless it carries the "no-whatsnew" label.
// Library: checkWhatsnew({ files, labels }). CLI (CI): PR_LABELS (JSON array) and either CHANGED_FILES (newline list)
// or BASE_SHA and HEAD_SHA (the file list comes from git diff) from the env.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const WHATSNEW_FILE = 'src/whatsnew.ts';
export const SKIP_LABEL = 'no-whatsnew';

export function checkWhatsnew({ files, labels }) {
  const touchesSrc = files.some((f) => f.startsWith('src/'));
  if (!touchesSrc) return { ok: true, message: 'No change under src/.' };
  if (files.includes(WHATSNEW_FILE)) return { ok: true, message: `${WHATSNEW_FILE} is in the diff.` };
  if (labels.includes(SKIP_LABEL)) return { ok: true, message: `Skipped by the "${SKIP_LABEL}" label.` };
  return {
    ok: false,
    message: `This PR changes src/ but not ${WHATSNEW_FILE}. Add a line for it in ${WHATSNEW_FILE}, or add the "${SKIP_LABEL}" label if no parent should hear about it.`,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { CHANGED_FILES, BASE_SHA, HEAD_SHA } = process.env;
  const raw =
    CHANGED_FILES ?? (BASE_SHA && HEAD_SHA ? execFileSync('git', ['diff', '--name-only', `${BASE_SHA}...${HEAD_SHA}`], { encoding: 'utf8' }) : '');
  const files = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  let labels = [];
  try {
    labels = JSON.parse(process.env.PR_LABELS || '[]');
  } catch {
    labels = [];
  }
  const r = checkWhatsnew({ files, labels });
  (r.ok ? console.log : console.error)(r.message);
  process.exit(r.ok ? 0 : 1);
}
