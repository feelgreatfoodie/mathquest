// Checks the parent allowlists that `npm run deploy` ships: the active `allowedAccount()` list in
// firestore.local.rules and ALLOWED_EMAILS in functions/.env. Both files are gitignored.
// 11-17: a copy step took the first `email in [...]` match, which was a commented-out example list
// (parent1@example.com, parent2@example.com). The old guard rejected only the literal
// parent@example.com, so the placeholders deployed and the real parent was locked out.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Drops `//` comments so only active rule text is read. */
function stripComments(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Addresses in the active `request.auth.token.email in [...]` lists of a rules file. */
export function rulesAllowlist(rulesText) {
  const active = stripComments(rulesText);
  const out = [];
  for (const m of active.matchAll(/request\.auth\.token\.email\s+in\s+\[([^\]]*)\]/g)) {
    out.push(...(m[1].match(EMAIL) ?? []));
  }
  return out;
}

/** Addresses in the ALLOWED_EMAILS line of a functions .env file. */
export function envAllowlist(envText) {
  const m = envText.match(/^ALLOWED_EMAILS=(.*)$/m);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

function isPlaceholder(addr) {
  return /@example\.(com|org|net)$/i.test(addr);
}

/**
 * Returns a list of problems; an empty list means the files may deploy.
 * `envText` is null when functions are not part of the deploy.
 */
export function allowlistProblems(rulesText, envText) {
  const problems = [];
  if (/@example\.(com|org|net)/i.test(rulesText)) {
    problems.push("firestore.local.rules contains an @example address (comments included). Remove it.");
  }
  const rules = rulesAllowlist(rulesText);
  if (rules.length === 0) problems.push("firestore.local.rules has no address in allowedAccount().");
  if (rules.some(isPlaceholder)) problems.push("firestore.local.rules allowedAccount() lists a placeholder address.");
  if (envText !== null) {
    const env = envAllowlist(envText);
    if (env.length === 0) problems.push("functions/.env needs ALLOWED_EMAILS set to your parent emails.");
    if (env.some(isPlaceholder) || /@example\.(com|org|net)/i.test(envText)) {
      problems.push("functions/.env ALLOWED_EMAILS lists a placeholder address.");
    }
    const a = [...rules].map((s) => s.toLowerCase()).sort().join(",");
    const b = [...env].map((s) => s.toLowerCase()).sort().join(",");
    if (env.length > 0 && rules.length > 0 && a !== b) {
      problems.push("functions/.env ALLOWED_EMAILS and firestore.local.rules allowedAccount() list different addresses.");
    }
  }
  return problems;
}
