import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

// ---------------------------------------------------------------------------------------------
// Kid PIN sign-in. All logic lives here so tests can run it against the Firestore emulator.
// index.ts wires it to callable functions.
//
// Data (server-only; firestore.rules deny every client read and write):
//   pinIndex/{familyUid}/kids/{kidId}            { nameKey, salt, hash, updatedAt, pic?: { salt, hash, updatedAt } }
//                                                pic is the picture PIN (4 of 9 icons), derived exactly like the digit PIN
//   pinIndex/{familyUid}/attempts/family         family failure counter and lock
//   pinIndex/_global/attempts/ip_{hash}          per-IP failure counter and lock
//   pinIndex/_global/attempts/name_{hash}        per-name failure counter and lock
//   parents/{uid}                                { email, createdAt }: a registered parent account
//   meta/parentCount                             { count }: how many parents are registered
//   nameKeys/{nameKey}                           { familyUid, kidId }: the one kid that owns a name
// IP and name counters sit in _global so an unknown name is counted exactly like a known one.
// ---------------------------------------------------------------------------------------------

export const MISMATCH_MESSAGE = "That name and PIN didn't match";
export const LOCKED_MESSAGE = 'Too many wrong tries. Ask a grown-up to open Grown-ups and tap Unlock.';
export const FULL_MESSAGE = 'Math Quest is full right now.';
export const NAME_TAKEN_MESSAGE = 'That name is taken. Try adding a last initial, like EmmaS.';

/** Parent accounts that may register. Raise it to let more families in. */
export const MAX_PARENTS = 20;

export const LIMITS = {
  ip: { max: 5, windowMs: 15 * 60_000 },
  name: { max: 10, windowMs: 60 * 60_000 },
  family: { max: 20, windowMs: 60 * 60_000 },
} as const;

// Number of X-Forwarded-For entries the trusted infrastructure appended, counted from the right.
// Cloud Run's Google front end appends the address it received the connection from, so the last
// entry is the real client and everything before it is whatever the caller sent. Confirm the value
// by probing the deployed function (see the PR) before relying on it.
export const TRUSTED_XFF_HOPS = 1;

/**
 * Client IP for the per-IP limit. Reads X-Forwarded-For from the right, so entries a caller
 * forges at the left never pick the bucket. Falls back to `fallbackIp` (req.ip) with no header.
 */
export function clientIp(
  xff: string | string[] | undefined,
  fallbackIp?: string,
  hops: number = TRUSTED_XFF_HOPS,
): string {
  const raw = Array.isArray(xff) ? xff.join(',') : (xff ?? '');
  const entries = raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) return fallbackIp || 'unknown';
  return (entries[Math.max(0, entries.length - Math.max(1, hops))] ?? 'unknown').slice(0, 64);
}

const GLOBAL = '_global';
const PIN_RE = /^\d{4}$/;
/** A picture PIN: 4 icons out of 9, one letter a to i each, repeats allowed (6,561 combinations). Letters never collide with digits. */
const PICTURE_RE = /^[a-i]{4}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface AuthContext {
  uid: string;
  email?: string | undefined;
  emailVerified?: boolean | undefined;
  /** The sign-in provider of the caller's token, for example 'google.com'. */
  provider?: string | undefined;
}

export interface Deps {
  db: Firestore;
  /** The parts of firebase-admin Auth that this code uses. */
  auth: {
    createCustomToken(uid: string, claims: Record<string, unknown>): Promise<string>;
  };
  now?: () => number;
}

const nowOf = (d: Deps) => (d.now ? d.now() : Date.now());

export function normalizeName(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Same derivation as hashPin() in the web app, so the server can compare against family.pinHash. */
export const parentPinHash = (uid: string, pin: string) => sha(`mathquest:${uid}:${pin}`);

function scryptAsync(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, 32, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const DUMMY_SALT = Buffer.from('mathquest-dummy-salt-not-a-secret');
const DUMMY_HASH = Buffer.alloc(32, 7);

const parentRef = (d: Deps, uid: string) => d.db.doc(`parents/${uid}`);
const parentCountRef = (d: Deps) => d.db.doc('meta/parentCount');
const nameKeyRef = (d: Deps, nameKey: string) => d.db.doc(`nameKeys/${nameKey}`);

/** A registered parent: a verified email and a parents/{uid} doc. */
async function assertParent(d: Deps, auth: AuthContext | undefined): Promise<AuthContext> {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in as a parent first.');
  if (auth.emailVerified !== true || !auth.email) throw new HttpsError('permission-denied', 'Parents only.');
  if (!(await parentRef(d, auth.uid).get()).exists) throw new HttpsError('permission-denied', 'Parents only.');
  return auth;
}

// ---------- parent registry ----------

/**
 * Registers the calling Google account as a parent. Idempotent per uid. One transaction reads the
 * count and refuses at MAX_PARENTS, so two callers at count 19 cannot both get in.
 */
export async function registerParent(d: Deps, auth: AuthContext | undefined): Promise<{ ok: true }> {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in with Google first.');
  if (auth.provider !== 'google.com') throw new HttpsError('permission-denied', 'Sign in with Google.');
  if (auth.emailVerified !== true || !auth.email) throw new HttpsError('permission-denied', 'Verify your Google email first.');
  const email = auth.email.toLowerCase();
  await d.db.runTransaction(async (tx) => {
    const [mine, counter] = await Promise.all([tx.get(parentRef(d, auth.uid)), tx.get(parentCountRef(d))]);
    if (mine.exists) return;
    const raw = counter.data()?.count;
    const count = typeof raw === 'number' ? raw : 0;
    if (count >= MAX_PARENTS) throw new HttpsError('resource-exhausted', FULL_MESSAGE);
    tx.set(parentRef(d, auth.uid), { email, createdAt: nowOf(d) });
    tx.set(parentCountRef(d), { count: count + 1 });
  });
  return { ok: true };
}

// ---------- counters ----------

interface Entry {
  id: string;
  at: number;
}
interface Counter {
  entries: Entry[];
  lockedUntil: number;
  lockedBy: string | null;
  families?: string[];
}

const emptyCounter = (): Counter => ({ entries: [], lockedUntil: 0, lockedBy: null });

function readCounter(raw: FirebaseFirestore.DocumentData | undefined): Counter {
  if (!raw) return emptyCounter();
  return {
    entries: Array.isArray(raw.entries) ? (raw.entries as Entry[]) : [],
    lockedUntil: typeof raw.lockedUntil === 'number' ? raw.lockedUntil : 0,
    lockedBy: typeof raw.lockedBy === 'string' ? raw.lockedBy : null,
    families: Array.isArray(raw.families) ? (raw.families as string[]) : [],
  };
}

interface Bucket {
  ref: FirebaseFirestore.DocumentReference;
  max: number;
  windowMs: number;
  familyUid?: string;
}

/**
 * Counts an attempt BEFORE the PIN is checked, so parallel guesses cannot skip the count.
 * A correct PIN refunds its own entry. Returns false when any bucket is locked (nothing is written).
 */
async function reserve(d: Deps, buckets: Bucket[], entryId: string): Promise<boolean> {
  return d.db.runTransaction(async (tx: Transaction) => {
    const now = nowOf(d);
    const snaps = await Promise.all(buckets.map((b) => tx.get(b.ref)));
    const next: Counter[] = [];
    for (const [i, b] of buckets.entries()) {
      const c = readCounter(snaps[i]!.data());
      c.entries = c.entries.filter((e) => e.at > now - b.windowMs);
      if (c.lockedUntil > now || c.entries.length >= b.max) return false;
      next.push(c);
    }
    for (const [i, b] of buckets.entries()) {
      const c = next[i]!;
      c.entries.push({ id: entryId, at: now });
      if (c.entries.length >= b.max) {
        c.lockedUntil = now + b.windowMs;
        c.lockedBy = entryId;
      }
      const fams = new Set(c.families ?? []);
      if (b.familyUid) fams.add(b.familyUid);
      tx.set(b.ref, { entries: c.entries, lockedUntil: c.lockedUntil, lockedBy: c.lockedBy, families: [...fams], updatedAt: now });
    }
    return true;
  });
}

async function refund(d: Deps, buckets: Bucket[], entryId: string): Promise<void> {
  await d.db.runTransaction(async (tx) => {
    const snaps = await Promise.all(buckets.map((b) => tx.get(b.ref)));
    for (const [i, b] of buckets.entries()) {
      const raw = snaps[i]!.data();
      if (!raw) continue;
      const c = readCounter(raw);
      c.entries = c.entries.filter((e) => e.id !== entryId);
      if (c.lockedBy === entryId) {
        c.lockedBy = null;
        c.lockedUntil = 0;
      }
      tx.set(b.ref, { ...raw, entries: c.entries, lockedUntil: c.lockedUntil, lockedBy: c.lockedBy });
    }
  });
}

const familyCounter = (d: Deps, uid: string) => d.db.doc(`pinIndex/${uid}/attempts/family`);
const ipCounter = (d: Deps, ip: string) => d.db.doc(`pinIndex/${GLOBAL}/attempts/ip_${sha(ip).slice(0, 32)}`);
const nameCounter = (d: Deps, nameKey: string) => d.db.doc(`pinIndex/${GLOBAL}/attempts/name_${sha(nameKey).slice(0, 32)}`);

/**
 * A parent who sets or resets a kid's PIN expects the kid to get straight in, so the same call clears the kid's name counter,
 * the family counter and the caller's ip counter. The ip counter is shared by every family behind that address, so it is only
 * deleted when it has counted nobody but this family: a parent cannot reset their own kid's PIN to wipe the ip limit while
 * guessing at other families' kids (those guesses add the other family to the counter's `families` list).
 */
async function clearKidLocks(d: Deps, familyUid: string, nameKey: string, ip: string | undefined): Promise<void> {
  const refs = [familyCounter(d, familyUid), nameCounter(d, nameKey)];
  if (ip) {
    const ipRef = ipCounter(d, ip);
    const fams = readCounter((await ipRef.get()).data()).families ?? [];
    if (fams.every((f) => f === familyUid)) refs.push(ipRef);
  }
  const batch = d.db.batch();
  refs.forEach((r) => batch.delete(r));
  await batch.commit();
}

// ---------- index lookups ----------

interface PinRow {
  familyUid: string;
  kidId: string;
  salt: Buffer;
  hash: Buffer;
  /** The picture PIN, when a parent set one. */
  pic: { salt: Buffer; hash: Buffer } | null;
}

async function familyRegistered(d: Deps, uid: string): Promise<boolean> {
  try {
    return (await parentRef(d, uid).get()).exists;
  } catch (err) {
    // 11-17: a swallowed getUser permission error made every kid PIN look wrong. A registry read that
    // throws (IAM, outage) must be visible in the logs, never a silent "not registered".
    console.error('familyRegistered: registry lookup failed', { uid, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Every family that has pinIndex rows, except the _global counter bucket. */
async function indexFamilies(d: Deps): Promise<string[]> {
  const refs = await d.db.collection('pinIndex').listDocuments();
  return refs.map((r) => r.id).filter((id) => id !== GLOBAL);
}

/** Rows whose nameKey matches and whose kid doc and registered family still exist. */
async function findRows(d: Deps, nameKey: string): Promise<PinRow[]> {
  const out: PinRow[] = [];
  for (const familyUid of await indexFamilies(d)) {
    const snap = await d.db.collection(`pinIndex/${familyUid}/kids`).where('nameKey', '==', nameKey).get();
    if (snap.empty) continue;
    if (!(await familyRegistered(d, familyUid))) continue;
    for (const doc of snap.docs) {
      const kid = await d.db.doc(`families/${familyUid}/kids/${doc.id}`).get();
      if (!kid.exists) continue;
      const row = doc.data();
      const pic = row.pic && typeof row.pic === 'object' && row.pic.salt && row.pic.hash ? { salt: Buffer.from(String(row.pic.salt), 'hex'), hash: Buffer.from(String(row.pic.hash), 'hex') } : null;
      out.push({ familyUid, kidId: doc.id, salt: Buffer.from(String(row.salt), 'hex'), hash: Buffer.from(String(row.hash), 'hex'), pic });
    }
  }
  return out;
}

// ---------- kidSignIn ----------

export interface SignInInput {
  name: unknown;
  pin: unknown;
  ip: string | undefined;
}

export async function kidSignIn(d: Deps, input: SignInInput): Promise<{ token: string }> {
  const { name, pin } = input;
  // `pin` is 4 digits, or 4 picture letters a to i. Both take the same path, the same counters and the same scrypt.
  const isPicture = typeof pin === 'string' && PICTURE_RE.test(pin);
  if (typeof name !== 'string' || typeof pin !== 'string' || !name.trim() || name.length > 40 || !(PIN_RE.test(pin) || isPicture)) {
    throw new HttpsError('invalid-argument', 'Type your name and a 4-digit PIN.');
  }
  const nameKey = normalizeName(name);
  const ip = input.ip || 'unknown';

  const rows = await findRows(d, nameKey);
  const row = rows[0] ?? null;

  const buckets: Bucket[] = [
    { ref: ipCounter(d, ip), ...LIMITS.ip, ...(row ? { familyUid: row.familyUid } : {}) },
    { ref: nameCounter(d, nameKey), ...LIMITS.name, ...(row ? { familyUid: row.familyUid } : {}) },
  ];
  if (row) buckets.push({ ref: familyCounter(d, row.familyUid), ...LIMITS.family });

  const entryId = randomBytes(8).toString('hex');
  if (!(await reserve(d, buckets, entryId))) throw new HttpsError('resource-exhausted', LOCKED_MESSAGE);

  // An unknown name still pays for one scrypt, so timing does not reveal which names exist.
  // A picture tried on a kid with no picture PIN, like an unknown name, pays one scrypt and fails the same way.
  const secret = row ? (isPicture ? row.pic : { salt: row.salt, hash: row.hash }) : null;
  const derived = await scryptAsync(pin, secret ? secret.salt : DUMMY_SALT);
  const ok = timingSafeEqual(derived, secret ? secret.hash : DUMMY_HASH) && secret !== null;
  if (!ok || !row) throw new HttpsError('permission-denied', MISMATCH_MESSAGE);

  await refund(d, buckets, entryId);
  const token = await d.auth.createCustomToken(`kid_${row.kidId}`, { role: 'kid', familyUid: row.familyUid, kidId: row.kidId });
  return { token };
}

// ---------- setKidPin ----------

export async function setKidPin(d: Deps, auth: AuthContext | undefined, data: { kidId?: unknown; pin?: unknown }, ip?: string): Promise<{ ok: true }> {
  const parent = await assertParent(d, auth);
  const { kidId, pin } = data;
  if (typeof kidId !== 'string' || !ID_RE.test(kidId)) throw new HttpsError('invalid-argument', 'Bad player id.');
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw new HttpsError('invalid-argument', 'The PIN must be 4 digits.');

  const kidRef = d.db.doc(`families/${parent.uid}/kids/${kidId}`);
  const kidSnap = await kidRef.get();
  if (!kidSnap.exists) throw new HttpsError('not-found', 'That player does not exist.');
  const name = String(kidSnap.data()?.name ?? '');
  const nameKey = normalizeName(name);
  if (!nameKey) throw new HttpsError('invalid-argument', 'The player needs a name first.');

  const family = await d.db.doc(`families/${parent.uid}`).get();
  const parentHash = family.data()?.pinHash;
  if (typeof parentHash === 'string' && parentHash === parentPinHash(parent.uid, pin)) {
    throw new HttpsError('invalid-argument', 'Pick a PIN that is different from the parent PIN.');
  }

  // Names are unique inside the family, across kid docs and across index rows.
  const kids = await d.db.collection(`families/${parent.uid}/kids`).get();
  if (kids.docs.some((k) => k.id !== kidId && normalizeName(String(k.data().name ?? '')) === nameKey)) {
    throw new HttpsError('already-exists', 'Another player in this family has that name.');
  }
  const mine = await d.db.collection(`pinIndex/${parent.uid}/kids`).where('nameKey', '==', nameKey).get();
  for (const row of mine.docs) {
    if (row.id === kidId) continue;
    if ((await d.db.doc(`families/${parent.uid}/kids/${row.id}`).get()).exists) {
      throw new HttpsError('already-exists', 'Another player in this family has that name.');
    }
  }
  const salt = randomBytes(16);
  const hash = await scryptAsync(pin, salt);
  const rowRef = d.db.doc(`pinIndex/${parent.uid}/kids/${kidId}`);

  // Names are unique across every family. The claim doc nameKeys/{nameKey} is the lock: two
  // parents claiming one name at once both read it, and Firestore retries the loser, who then sees the winner.
  await d.db.runTransaction(async (tx) => {
    const claimRef = nameKeyRef(d, nameKey);
    const [claim, oldRow] = await Promise.all([tx.get(claimRef), tx.get(rowRef)]);
    const owner = claim.data() as { familyUid?: string; kidId?: string } | undefined;
    const ownedByThisKid = owner?.familyUid === parent.uid && owner?.kidId === kidId;
    if (claim.exists && !ownedByThisKid) {
      // A claim whose kid doc is gone is stale (the parent deleted that kid), so the name is free again.
      const ownerKid = await tx.get(d.db.doc(`families/${owner?.familyUid}/kids/${owner?.kidId}`));
      if (ownerKid.exists) {
        throw new HttpsError('already-exists', owner?.familyUid === parent.uid ? 'Another player in this family has that name.' : NAME_TAKEN_MESSAGE);
      }
    }
    // A kid whose name changed gives up the old name.
    const oldKey = oldRow.exists ? String(oldRow.data()?.nameKey ?? '') : '';
    let releaseOld: FirebaseFirestore.DocumentReference | null = null;
    if (oldKey && oldKey !== nameKey) {
      const oldClaim = await tx.get(nameKeyRef(d, oldKey));
      const o = oldClaim.data();
      if (oldClaim.exists && o?.familyUid === parent.uid && o?.kidId === kidId) releaseOld = oldClaim.ref;
    }
    tx.set(claimRef, { familyUid: parent.uid, kidId });
    // merge: a new digit PIN keeps the picture PIN the parent set.
    tx.set(rowRef, { nameKey, salt: salt.toString('hex'), hash: hash.toString('hex'), updatedAt: nowOf(d) }, { merge: true });
    if (releaseOld) tx.delete(releaseOld);
  });
  await kidRef.update({ hasPin: true });
  await clearKidLocks(d, parent.uid, nameKey, ip);
  return { ok: true };
}

// ---------- setKidPicturePin ----------

/**
 * Sets the picture PIN of one of the caller's kids. Parents only. The kid must already have a digit PIN (the row and the
 * name claim exist), so the digit PIN keeps working and a picture is an extra way in. Hashed with scrypt and a fresh
 * 16-byte salt exactly like setKidPin, stored in the same server-only row. The kid doc gets one flag, hasPicturePin,
 * so the parent screen can show it. The picture itself is never stored or logged.
 */
export async function setKidPicturePin(d: Deps, auth: AuthContext | undefined, data: { kidId?: unknown; picture?: unknown }, ip?: string): Promise<{ ok: true }> {
  const parent = await assertParent(d, auth);
  const { kidId, picture } = data;
  if (typeof kidId !== 'string' || !ID_RE.test(kidId)) throw new HttpsError('invalid-argument', 'Bad player id.');
  if (typeof picture !== 'string' || !PICTURE_RE.test(picture)) throw new HttpsError('invalid-argument', 'Pick 4 pictures.');
  const kidRef = d.db.doc(`families/${parent.uid}/kids/${kidId}`);
  if (!(await kidRef.get()).exists) throw new HttpsError('not-found', 'That player does not exist.');
  const rowRef = d.db.doc(`pinIndex/${parent.uid}/kids/${kidId}`);
  const row = await rowRef.get();
  if (!row.exists) throw new HttpsError('failed-precondition', 'Set a PIN for this player first.');
  const salt = randomBytes(16);
  const hash = await scryptAsync(picture, salt);
  await rowRef.update({ pic: { salt: salt.toString('hex'), hash: hash.toString('hex'), updatedAt: nowOf(d) } });
  await kidRef.update({ hasPicturePin: true });
  await clearKidLocks(d, parent.uid, String(row.data()?.nameKey ?? ''), ip);
  return { ok: true };
}

// ---------- lock status and unlock ----------

export interface LockStatus {
  locked: boolean;
  /** Wrong PINs counted for this family in the last hour. */
  failures: number;
  lockedUntil: number;
  /** Players whose name is locked on its own. */
  lockedPlayers: string[];
}

async function familyBuckets(d: Deps, uid: string) {
  const rows = await d.db.collection(`pinIndex/${uid}/kids`).get();
  const names = rows.docs.map((r) => ({ kidId: r.id, nameKey: String(r.data().nameKey) }));
  const ips = await d.db.collection(`pinIndex/${GLOBAL}/attempts`).where('families', 'array-contains', uid).get();
  return { names, ipDocs: ips.docs.filter((x) => x.id.startsWith('ip_')) };
}

export async function kidLockStatus(d: Deps, auth: AuthContext | undefined): Promise<LockStatus> {
  const parent = await assertParent(d, auth);
  const now = nowOf(d);
  const fam = readCounter((await familyCounter(d, parent.uid).get()).data());
  const failures = fam.entries.filter((e) => e.at > now - LIMITS.family.windowMs).length;
  const { names, ipDocs } = await familyBuckets(d, parent.uid);
  const lockedPlayers: string[] = [];
  for (const n of names) {
    const c = readCounter((await nameCounter(d, n.nameKey).get()).data());
    if (c.lockedUntil > now) lockedPlayers.push(n.nameKey);
  }
  const ipLocked = ipDocs.some((x) => readCounter(x.data()).lockedUntil > now);
  const lockedUntil = Math.max(fam.lockedUntil, 0);
  return { locked: fam.lockedUntil > now || lockedPlayers.length > 0 || ipLocked, failures, lockedUntil, lockedPlayers };
}

export async function unlockKidSignIn(d: Deps, auth: AuthContext | undefined): Promise<{ ok: true }> {
  const parent = await assertParent(d, auth);
  const { names, ipDocs } = await familyBuckets(d, parent.uid);
  const refs = [familyCounter(d, parent.uid), ...names.map((n) => nameCounter(d, n.nameKey)), ...ipDocs.map((x) => x.ref)];
  const batch = d.db.batch();
  refs.forEach((r) => batch.delete(r));
  await batch.commit();
  return { ok: true };
}
