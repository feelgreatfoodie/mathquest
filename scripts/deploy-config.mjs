// Writes firebase.deploy.json: firebase.json with Firestore rules taken from
// firestore.local.rules, the gitignored copy that holds the real parent allowlist.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const LOCAL = "firestore.local.rules";
if (!existsSync(LOCAL)) {
  console.error(`${LOCAL} is missing. Copy firestore.rules to ${LOCAL} and put your parent emails in allowedAccount().`);
  process.exit(1);
}
if (readFileSync(LOCAL, "utf8").includes("parent@example.com")) {
  console.error(`${LOCAL} still lists parent@example.com. Replace it with your parent emails.`);
  process.exit(1);
}
// The functions read the parent allowlist from functions/.env (gitignored), same addresses as the rules.
// Checked only when deploying functions (`npm run deploy` passes --functions; the CI job does not).
const FUNCTIONS_ENV = "functions/.env";
if (process.argv.includes("--functions")) {
  if (!existsSync(FUNCTIONS_ENV)) {
    console.error(`${FUNCTIONS_ENV} is missing. Copy functions/.env.example to it and set ALLOWED_EMAILS to your parent emails, comma separated.`);
    process.exit(1);
  }
  const functionsEnv = readFileSync(FUNCTIONS_ENV, "utf8");
  if (!/^ALLOWED_EMAILS=\S+/m.test(functionsEnv) || functionsEnv.includes("parent@example.com")) {
    console.error(`${FUNCTIONS_ENV} needs ALLOWED_EMAILS set to your real parent emails (not parent@example.com).`);
    process.exit(1);
  }
}
const config = JSON.parse(readFileSync("firebase.json", "utf8"));
config.firestore.rules = LOCAL;
writeFileSync("firebase.deploy.json", JSON.stringify(config, null, 2) + "\n");
