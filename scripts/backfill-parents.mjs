// One-off: moves existing families into the parents registry before the rules switch.
//   node scripts/backfill-parents.mjs --project <gcp-project-id>           dry run, writes nothing
//   node scripts/backfill-parents.mjs --project <gcp-project-id> --apply   writes
// Needs application default credentials with Firestore and Auth read/write on the project. It reads every
// uid from Firestore at run time and writes only to the project it is pointed at. It commits no uid or email.
//
// What it writes (all server-only collections):
//   parents/{uid}      { email, createdAt }   for every family that has data and no registry doc yet
//   meta/parentCount   { count }              the number of parents/ docs after the run
//   nameKeys/{key}     { familyUid, kidId }   for every kid PIN row whose kid doc still exists
// Safe to re-run: existing parents/ and nameKeys/ docs are kept, the count is recomputed.

const MAX_PARENTS = 20;

/**
 * @param {{ db: import('firebase-admin/firestore').Firestore,
 *           getEmail: (uid: string) => Promise<string | undefined>,
 *           apply: boolean, now?: () => number, log?: (s: string) => void }} o
 */
export async function backfill({ db, getEmail, apply, now = Date.now, log = () => {} }) {
  const uids = new Set();
  for (const col of ['families', 'pinIndex']) {
    for (const ref of await db.collection(col).listDocuments()) if (ref.id !== '_global') uids.add(ref.id);
  }
  const result = { families: uids.size, registered: 0, alreadyRegistered: 0, skippedNoEmail: [], nameKeys: 0, nameKeyConflicts: [], count: 0, overCap: false };

  const existing = new Set((await db.collection('parents').listDocuments()).map((r) => r.id));
  const toRegister = [];
  for (const uid of [...uids].sort()) {
    if (existing.has(uid)) {
      result.alreadyRegistered++;
      continue;
    }
    const email = await getEmail(uid);
    if (!email) {
      result.skippedNoEmail.push(uid);
      continue;
    }
    toRegister.push({ uid, email: email.toLowerCase() });
  }
  result.count = existing.size + toRegister.length;
  result.overCap = result.count > MAX_PARENTS;
  if (result.overCap) {
    log(`Refusing: ${result.count} parents would exceed the cap of ${MAX_PARENTS}.`);
    return result;
  }
  for (const p of toRegister) {
    log(`${apply ? 'register' : 'would register'} parents/${p.uid}`);
    if (apply) await db.doc(`parents/${p.uid}`).set({ email: p.email, createdAt: now() });
    result.registered++;
  }
  if (apply) await db.doc('meta/parentCount').set({ count: result.count });

  // Name claims from the existing PIN rows. A kid whose doc is gone has no claim.
  const claimed = new Map();
  for (const uid of [...uids].sort()) {
    for (const row of (await db.collection(`pinIndex/${uid}/kids`).get()).docs) {
      const kid = await db.doc(`families/${uid}/kids/${row.id}`).get();
      if (!kid.exists) continue;
      const key = String(row.data().nameKey ?? '');
      if (!key) continue;
      const have = claimed.get(key) ?? (await db.doc(`nameKeys/${key}`).get()).data();
      if (have && !(have.familyUid === uid && have.kidId === row.id)) {
        result.nameKeyConflicts.push(key);
        continue;
      }
      claimed.set(key, { familyUid: uid, kidId: row.id });
      log(`${apply ? 'claim' : 'would claim'} nameKeys/${key}`);
      if (apply) await db.doc(`nameKeys/${key}`).set({ familyUid: uid, kidId: row.id });
      result.nameKeys++;
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--project');
  const project = i >= 0 ? args[i + 1] : undefined;
  const apply = args.includes('--apply');
  if (!project) {
    console.error('Usage: node scripts/backfill-parents.mjs --project <gcp-project-id> [--apply]');
    process.exit(2);
  }
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const { initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId: project });
  const auth = getAuth();
  const r = await backfill({
    db: getFirestore(),
    apply,
    getEmail: async (uid) => {
      try {
        const u = await auth.getUser(uid);
        return u.emailVerified ? u.email : undefined;
      } catch {
        return undefined;
      }
    },
    log: console.log,
  });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...r }, null, 2));
  if (r.overCap || r.nameKeyConflicts.length || r.skippedNoEmail.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
