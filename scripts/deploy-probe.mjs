// Live round trip against a deployed project: kid PIN sign-in on the real kidSignIn function.
//   node scripts/deploy-probe.mjs --project <gcp-project-id>
// Needs application default credentials with Firestore read/write on the project. Run it after every
// functions deploy. Exit 0 = pass, 1 = fail, 2 = bad usage. It prints one summary line.
//
// Why it exists: the emulator needs no IAM, so the 11-17 missing firebaseauth.viewer role passed every
// test while every real kid PIN failed. Only a call to the deployed function, with the function's
// runtime service account, hits that class of fault.
//
// It creates a throwaway parent registry doc, family, kid, PIN row and name claim with random values
// (same scrypt hashing as setKidPin), calls kidSignIn with the right PIN and with a wrong one, then
// deletes everything it created, including attempts rows and its +1 on meta/parentCount.
// It commits no uid, email, PIN or salt: every value is random per run and gone after it.

import { randomBytes, randomInt, scryptSync } from 'node:crypto';

export const MISMATCH_MESSAGE = "That name and PIN didn't match";
const GLOBAL = '_global';

export const callableUrl = (project) => `https://us-west1-${project}.cloudfunctions.net/kidSignIn`;

export function parseArgs(argv) {
  const i = argv.indexOf('--project');
  const project = i >= 0 ? argv[i + 1] : undefined;
  if (!project || project.startsWith('--') || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) return null;
  return { project };
}

/** Random throwaway identity. Letters only in the name so normalizeName() leaves it unchanged. */
export function makeProbe(rand = randomBytes) {
  const letters = [...rand(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');
  const pin = String(randomInt(0, 10000)).padStart(4, '0');
  let wrongPin = pin;
  while (wrongPin === pin) wrongPin = String(randomInt(0, 10000)).padStart(4, '0');
  return {
    familyUid: `probe-${rand(8).toString('hex')}`,
    kidId: `probe-kid-${rand(6).toString('hex')}`,
    name: `zprobe${letters}`,
    nameKey: `zprobe${letters}`,
    pin,
    wrongPin,
  };
}

/** Same derivation as setKidPin(): scrypt(pin, salt, 32 bytes). */
export function hashPin(pin, salt) {
  return scryptSync(pin, salt, 32);
}

/** The documents the probe writes, as [path, data] pairs. */
export function buildDocs(p, now = Date.now(), salt = randomBytes(16)) {
  return [
    [`parents/${p.familyUid}`, { email: `${p.familyUid}@probe.invalid`, createdAt: now }],
    [`families/${p.familyUid}`, { createdAt: now, probe: true }],
    [`families/${p.familyUid}/kids/${p.kidId}`, { id: p.kidId, name: p.name, createdAt: now, settings: {}, game: {}, hasPin: true }],
    [
      `pinIndex/${p.familyUid}/kids/${p.kidId}`,
      { nameKey: p.nameKey, salt: salt.toString('hex'), hash: hashPin(p.pin, salt).toString('hex'), updatedAt: now },
    ],
    [`nameKeys/${p.nameKey}`, { familyUid: p.familyUid, kidId: p.kidId }],
  ];
}

export function decodeJwtPayload(token) {
  if (typeof token !== 'string') throw new Error('token is not a string');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('token is not a JWT');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

/** Callable success body: { result: { token } }. Returns a list of problems, empty when it passes. */
export function checkSignIn(status, body, p) {
  const problems = [];
  if (status !== 200) return [`right PIN: HTTP ${status} ${JSON.stringify(body?.error ?? body)}`];
  const token = body?.result?.token;
  if (!token) return ['right PIN: response has no token'];
  let c;
  try {
    c = decodeJwtPayload(token);
  } catch (e) {
    return [`right PIN: ${e.message}`];
  }
  const claims = c.claims ?? {};
  if (c.uid !== `kid_${p.kidId}`) problems.push('token uid is not kid_<kidId>');
  if (claims.role !== 'kid') problems.push(`role is ${JSON.stringify(claims.role)}, want "kid"`);
  if (claims.familyUid !== p.familyUid) problems.push('familyUid does not match');
  if (claims.kidId !== p.kidId) problems.push('kidId does not match');
  return problems;
}

/** A wrong PIN must be refused with the generic message and no token. */
export function checkWrongPin(status, body) {
  if (status === 200 || body?.result) return ['wrong PIN: sign-in succeeded'];
  if (body?.error?.message !== MISMATCH_MESSAGE) return [`wrong PIN: error was ${JSON.stringify(body?.error?.message ?? body)}, want the generic message`];
  return [];
}

async function callKidSignIn(url, name, pin, fetchImpl = fetch) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { name, pin } }) });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  return { status: res.status, body };
}

/**
 * Removes everything the probe created. Counter docs that name only the probe family are deleted.
 * A counter shared with another family (the caller's IP bucket) is left alone and counted.
 * @returns {Promise<{ sharedCounters: number }>}
 */
export async function cleanup(db, p, { createdCount }) {
  let sharedCounters = 0;
  const attempts = await db.collection(`pinIndex/${GLOBAL}/attempts`).where('families', 'array-contains', p.familyUid).get();
  for (const doc of attempts.docs) {
    const fams = doc.data().families ?? [];
    if (fams.every((f) => f === p.familyUid)) await doc.ref.delete();
    else sharedCounters++;
  }
  await db.recursiveDelete(db.doc(`pinIndex/${p.familyUid}`));
  await db.recursiveDelete(db.doc(`families/${p.familyUid}`));
  await db.doc(`parents/${p.familyUid}`).delete();
  const claim = db.doc(`nameKeys/${p.nameKey}`);
  if ((await claim.get()).data()?.familyUid === p.familyUid) await claim.delete();
  // Undo the +1 on the registry count. If the probe created the count doc, remove it again.
  const countRef = db.doc('meta/parentCount');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(countRef);
    if (!snap.exists) return;
    const n = Number(snap.data()?.count ?? 0);
    if (createdCount && n <= 1) tx.delete(countRef);
    else tx.set(countRef, { count: Math.max(0, n - 1) });
  });
  return { sharedCounters };
}

export async function probe({ db, project, fetchImpl = fetch, log = () => {} }) {
  const p = makeProbe();
  const url = callableUrl(project);
  const problems = [];
  const countRef = db.doc('meta/parentCount');
  let createdCount = false;
  let cleaned = { sharedCounters: 0 };
  let cleanupError = null;
  try {
    for (const [path, data] of buildDocs(p)) await db.doc(path).set(data);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(countRef);
      createdCount = !snap.exists;
      tx.set(countRef, { count: Number(snap.data()?.count ?? 0) + 1 });
    });
    log('seeded throwaway parent, family, kid');
    const ok = await callKidSignIn(url, p.name, p.pin, fetchImpl);
    problems.push(...checkSignIn(ok.status, ok.body, p));
    const bad = await callKidSignIn(url, p.name, p.wrongPin, fetchImpl);
    problems.push(...checkWrongPin(bad.status, bad.body));
  } catch (e) {
    problems.push(`probe error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    try {
      cleaned = await cleanup(db, p, { createdCount });
    } catch (e) {
      cleanupError = e instanceof Error ? e.message : String(e);
    }
  }
  if (cleanupError) problems.push(`cleanup failed: ${cleanupError} (look for parents/${p.familyUid} and fix the count by hand)`);
  return { ok: problems.length === 0, problems, sharedCounters: cleaned.sharedCounters, familyUid: p.familyUid };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('Usage: node scripts/deploy-probe.mjs --project <gcp-project-id>');
    process.exit(2);
  }
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId: args.project });
  const r = await probe({ db: getFirestore(), project: args.project, log: console.error });
  for (const m of r.problems) console.error(`FAIL ${m}`);
  const shared = r.sharedCounters ? `, ${r.sharedCounters} shared IP counter left (expires in 15 min)` : '';
  console.log(`deploy-probe ${r.ok ? 'PASS' : 'FAIL'} project=${args.project}: kidSignIn right PIN + wrong PIN, cleanup ${r.problems.some((x) => x.startsWith('cleanup')) ? 'FAILED' : 'done'}${shared}`);
  process.exit(r.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    console.log('deploy-probe FAIL: unexpected error');
    process.exit(1);
  });
}
