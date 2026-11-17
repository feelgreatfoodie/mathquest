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
const config = JSON.parse(readFileSync("firebase.json", "utf8"));
config.firestore.rules = LOCAL;
writeFileSync("firebase.deploy.json", JSON.stringify(config, null, 2) + "\n");
