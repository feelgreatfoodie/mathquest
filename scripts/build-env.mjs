// The build's Firebase config check. A bundle built with an empty VITE_FIREBASE_PROJECT_ID or VITE_FIREBASE_API_KEY
// reads as "Firebase not configured" (src/firebase.ts) and falls back to local mode, so every kid sign-in breaks while the
// site still loads. On 2026-11-18 a rollback from a fresh worktree shipped such a bundle. vite.config.ts calls this on
// every `vite build` and refuses to build when it returns problems. VITE_DATA_MODE=local is the one deliberate way out.

/** @param {Record<string, string | undefined>} env the VITE_ variables the build will see (process env over .env files) */
export function buildEnvProblems(env) {
  if (env.VITE_DATA_MODE === 'local') return [];
  const problems = [];
  for (const name of ['VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_API_KEY']) {
    if (!String(env[name] ?? '').trim()) problems.push(`${name} is empty`);
  }
  return problems;
}

export function buildEnvMessage(problems) {
  return [
    `Build refused: ${problems.join(' and ')}.`,
    'A bundle without them runs in local mode and kid sign-in fails. Set them (see .env.example),',
    'or set VITE_DATA_MODE=local if this is a local-mode build on purpose.',
  ].join('\n');
}
