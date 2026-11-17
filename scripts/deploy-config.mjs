// Writes firebase.deploy.json: firebase.json with Firestore rules taken from
// firestore.local.rules, the gitignored copy that holds the real parent allowlist.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { allowlistProblems } from "./allowlist.mjs";

const LOCAL = "firestore.local.rules";
if (!existsSync(LOCAL)) {
  console.error(`${LOCAL} is missing. Copy firestore.rules to ${LOCAL} and put your parent emails in allowedAccount().`);
  process.exit(1);
}
// The functions read the parent allowlist from functions/.env (gitignored), same addresses as the rules.
// Checked only when deploying functions (`npm run deploy` passes --functions).
const FUNCTIONS_ENV = "functions/.env";
const withFunctions = process.argv.includes("--functions");
if (withFunctions && !existsSync(FUNCTIONS_ENV)) {
  console.error(`${FUNCTIONS_ENV} is missing. Copy functions/.env.example to it and set ALLOWED_EMAILS to your parent emails, comma separated.`);
  process.exit(1);
}
const problems = allowlistProblems(
  readFileSync(LOCAL, "utf8"),
  withFunctions ? readFileSync(FUNCTIONS_ENV, "utf8") : null,
);
if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
const config = JSON.parse(readFileSync("firebase.json", "utf8"));
config.firestore.rules = LOCAL;
writeFileSync("firebase.deploy.json", JSON.stringify(config, null, 2) + "\n");
