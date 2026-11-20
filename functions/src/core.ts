import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { reservedReason } from './reserved.js';
import { ANIMALS, COLORS } from './words.js';

// ---------------------------------------------------------------------------------------------
// Kid PIN sign-in. All logic lives here so tests can run it against the Firestore emulator.
// index.ts wires it to callable functions.
//
// Data (server-only; firestore.rules deny every client read and write):
//   pinIndex/{familyUid}/kids/{kidId}            { nameKey, salt, hash, v?, updatedAt, pic?: { salt, hash, v?, updatedAt } }
//                                                pic is the picture PIN (4 of 9 icons), derived exactly like the digit PIN.
//                                                v: 2 is the peppered hash, scrypt(HMAC-SHA256(pepper, passcode), salt). No v is v1: scrypt(passcode, salt).
//   pinIndex/{familyUid}/attempts/family         family failure counter and lock (100 per hour)
//   pinIndex/_global/attempts/ip_{hash}          network counter and lock (50 per 15 min)
//   pinIndex/_global/attempts/dev_{hash}         device counter and lock (20 per 15 min, only when the call carries a valid deviceId)
//   pinIndex/_global/attempts/user_{hash}        username counter (index usernames only): 5 wrong in a row lock 5 min, doubling to 60 min
//   pinIndex/_global/attempts/dn_{hash}          the same strike counter for a display name with no username, and for any unknown name
//   pinIndex/_global/attempts/name_{hash}        legacy display-name counter (10 per hour), for the legacy path only
//   usernames/{usernameLower}                    { familyUid, kidId, createdAt }: the one kid that owns a username
//   families/{uid}/devices/{deviceId}            { firstSeen, lastSeen, kids[], label, revoked? }: written on a good sign-in, parents read it; revoked: true (Forget) refuses the next sign-in
//   families/{uid}.schoolMode                    true: kidSignIn answers remember: false (nothing stays on the device)
//   parentPins/{uid}                             { salt, hash, v: 2, updatedAt, verifiedAt }: the grown-up PIN (peppered scrypt), server-only
//   pinIndex/_global/attempts/par_{hash}         the same strike counter for one parent uid: 5 wrong lock 5 min, doubling to 60 min
//   families/{uid}                               { hasPin, createdAt, tourSeen }; a pinHash here is the old browser SHA-256, migrated on the first right check
//   parents/{uid}                                { email, createdAt }: a registered parent account
//   meta/parentCount                             { count }: how many parents are registered
//   nameKeys/{nameKey}                           { familyUid, kidId }: the one kid that owns a display name
// Every counter sits in _global so an unknown name is counted exactly like a known one.
// ---------------------------------------------------------------------------------------------

export const MISMATCH_MESSAGE = "That username and passcode didn't match.";
export const LOCKED_MESSAGE = 'Too many wrong tries. Ask a grown-up to open Grown-ups and tap Unlock.';
export const LOCKED_PARENT_MESSAGE = 'Too many wrong tries. Wait a while, or sign in with Google again to try once more.';
export const PARENT_STALE_MESSAGE = 'Type the Grown-up PIN first.';
export const FULL_MESSAGE = 'Math Quest is full right now.';
export const DEVICE_FORGOTTEN_MESSAGE = 'This device was forgotten. Ask a grown-up.';
export const NAME_TAKEN_MESSAGE = 'That name is taken. Try adding a last initial, like EmmaS.';

/** Parent accounts that may register when config/app has no maxParents. Raise config/app.maxParents to let more families in. */
export const MAX_PARENTS = 20;

export const LIMITS = {
  /** Network (client IP): sized for a classroom behind one NAT. A backstop against spraying. */
  ip: { max: 50, windowMs: 15 * 60_000 },
  /** One deviceId. Skipped when the call carries no valid deviceId (clients before L2 send none). */
  device: { max: 20, windowMs: 15 * 60_000 },
  /** Legacy display-name path only. Removed with the path in L4. */
  name: { max: 10, windowMs: 60 * 60_000 },
  family: { max: 100, windowMs: 60 * 60_000 },
  /** 5 wrong in a row lock baseLockMs x 2^strikes (cap capLockMs). Strikes reset after strikeResetMs without a lock. */
  username: { max: 5, baseLockMs: 5 * 60_000, capLockMs: 60 * 60_000, strikeResetMs: 24 * 60 * 60_000 },
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
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;

export interface AuthContext {
  uid: string;
  email?: string | undefined;
  emailVerified?: boolean | undefined;
  /** The sign-in provider of the caller's token, for example 'google.com'. */
  provider?: string | undefined;
  /** When the caller last signed in, in seconds (the token's auth_time). A Google sign-in after a parent PIN lock opens that lock. */
  authTime?: number | undefined;
}

export interface Deps {
  db: Firestore;
  /** MQ_PIN_PEPPER. Keys every v2 passcode hash. Never logged, never stored. */
  pepper: string;
  /** Structured log sink. Defaults to the Cloud Functions logger. */
  log?: (entry: Record<string, unknown>) => void;
  /** The parts of firebase-admin Auth that this code uses. */
  auth: {
    createCustomToken(uid: string, claims: Record<string, unknown>): Promise<string>;
  };
  now?: () => number;
  /** How long signinMode reuses one config/app read. Default 30 s. The emulator sets 0, so an e2e run can flip the switch between tests. */
  modeTtlMs?: number;
}

const nowOf = (d: Deps) => (d.now ? d.now() : Date.now());

export function normalizeName(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Same derivation as hashPin() in the web app, so the server can compare against family.pinHash. */
export const parentPinHash = (uid: string, pin: string) => sha(`mathquest:${uid}:${pin}`);

function scryptAsync(pin: string | Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, 32, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** v2 hash: scrypt(HMAC-SHA256(pepper, passcode), salt). One scrypt call, same cost as v1. */
function hashV2(d: Deps, passcode: string, salt: Buffer): Promise<Buffer> {
  // An empty pepper means a function without the secret bound. Hashing without a key would be a silent downgrade.
  if (!d.pepper) return Promise.reject(new HttpsError('internal', 'Sign-in is not set up.'));
  return scryptAsync(createHmac('sha256', d.pepper).update(passcode).digest(), salt);
}

/** The v1 derivation, kept only to verify rows written before the pepper. */
const hashV1 = (passcode: string, salt: Buffer) => scryptAsync(passcode, salt);

const logLine = (d: Deps, entry: Record<string, unknown>) => (d.log ? d.log(entry) : logger.info(String(entry.event), entry));
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
    const [mine, counter, config] = await Promise.all([tx.get(parentRef(d, auth.uid)), tx.get(parentCountRef(d)), tx.get(d.db.doc('config/app'))]);
    if (mine.exists) return;
    const raw = counter.data()?.count;
    const count = typeof raw === 'number' ? raw : 0;
    // config/app.maxParents sets the cap (the Admin SDK writes it; clients cannot). Anything but a whole number from 1 up falls back to MAX_PARENTS.
    const cfg = config.data()?.maxParents;
    const max = typeof cfg === 'number' && Number.isInteger(cfg) && cfg >= 1 ? cfg : MAX_PARENTS;
    if (count >= max) throw new HttpsError('resource-exhausted', FULL_MESSAGE);
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
  /** Username bucket: wrong tries since the last lock or success. */
  fails: number;
  /** Username bucket: locks since the last success or 24 h without a lock. */
  strikes: number;
  /** Username bucket: when the last lock was set. */
  strikeAt: number;
  /** Parent bucket: strikes and strikeAt from before the lock that the latest try set, so a right try can take that lock back. */
  prevStrikes?: number;
  prevStrikeAt?: number;
}

const emptyCounter = (): Counter => ({ entries: [], lockedUntil: 0, lockedBy: null, fails: 0, strikes: 0, strikeAt: 0 });

function readCounter(raw: FirebaseFirestore.DocumentData | undefined): Counter {
  if (!raw) return emptyCounter();
  return {
    entries: Array.isArray(raw.entries) ? (raw.entries as Entry[]) : [],
    lockedUntil: typeof raw.lockedUntil === 'number' ? raw.lockedUntil : 0,
    lockedBy: typeof raw.lockedBy === 'string' ? raw.lockedBy : null,
    families: Array.isArray(raw.families) ? (raw.families as string[]) : [],
    fails: typeof raw.fails === 'number' ? raw.fails : 0,
    strikes: typeof raw.strikes === 'number' ? raw.strikes : 0,
    strikeAt: typeof raw.strikeAt === 'number' ? raw.strikeAt : 0,
    ...(typeof raw.prevStrikes === 'number' ? { prevStrikes: raw.prevStrikes, prevStrikeAt: typeof raw.prevStrikeAt === 'number' ? raw.prevStrikeAt : 0 } : {}),
  };
}

/** A sliding window: `max` wrong tries inside `windowMs` lock the bucket for `windowMs`. */
interface WindowBucket {
  kind?: 'window';
  ref: FirebaseFirestore.DocumentReference;
  max: number;
  windowMs: number;
  familyUid?: string;
}
/** The username bucket: LIMITS.username. */
interface StrikeBucket {
  kind: 'strike';
  ref: FirebaseFirestore.DocumentReference;
  familyUid?: string;
  /** A success clears the wrong tries and the lock it set, but keeps the strikes (parent PIN). Kid buckets reset strikes on a success. */
  keepStrikes?: boolean;
}
type Bucket = WindowBucket | StrikeBucket;

/** Lock length for a bucket that already has `strikes` locks: 5, 10, 20, 40, 60, 60 min. */
export const lockMsFor = (strikes: number) => Math.min(LIMITS.username.baseLockMs * 2 ** strikes, LIMITS.username.capLockMs);

// The network counter is one doc that every sign-in behind one school NAT writes at the bell. Ten attempts instead of the
// default five let a classroom's parallel sign-ins retry past that contention.
const TX_OPTS = { maxAttempts: 10 } as const;

/**
 * True for a Firestore transaction that lost to contention: gRPC ABORTED (10), or the emulator's code 3 with the message
 * "Transaction is invalid or closed.", which it returns once the retries run out. Any other error, code 3 included, is not contention.
 */
export function isContention(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return code === 10 || (code === 3 && typeof message === 'string' && /Transaction is invalid or closed/i.test(message));
}

/** Runs a counter transaction. Contention ends as HttpsError 'aborted' (a client may retry; nothing was verified), any other error as it is. */
async function runCounterTx<T>(d: Deps, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  try {
    return await d.db.runTransaction(fn, TX_OPTS);
  } catch (err) {
    if (isContention(err)) throw new HttpsError('aborted', 'Busy right now. Try again.');
    throw err;
  }
}

/**
 * Counts an attempt BEFORE the PIN is checked, so parallel guesses cannot skip the count.
 * A correct PIN refunds its own entry. Returns false when any bucket is locked (nothing is written).
 */
async function reserve(d: Deps, buckets: Bucket[], entryId: string): Promise<boolean> {
  return runCounterTx(d, async (tx: Transaction) => {
    const now = nowOf(d);
    const snaps = await Promise.all(buckets.map((b) => tx.get(b.ref)));
    const next: Counter[] = [];
    for (const [i, b] of buckets.entries()) {
      const c = readCounter(snaps[i]!.data());
      if (b.kind === 'strike') {
        // 24 h with no lock forgive the strikes.
        if (c.strikes > 0 && c.lockedUntil <= now && now - c.strikeAt >= LIMITS.username.strikeResetMs) c.strikes = 0;
        if (c.lockedUntil > now) return false;
      } else {
        c.entries = c.entries.filter((e) => e.at > now - b.windowMs);
        if (c.lockedUntil > now || c.entries.length >= b.max) return false;
      }
      next.push(c);
    }
    for (const [i, b] of buckets.entries()) {
      const c = next[i]!;
      if (b.kind === 'strike') {
        c.fails += 1;
        if (c.fails >= LIMITS.username.max) {
          // The 5th try sets the lock before it is compared. A parent bucket remembers what it held, so a right 5th try can undo it.
          if (b.keepStrikes) {
            c.prevStrikes = c.strikes;
            c.prevStrikeAt = c.strikeAt;
          }
          c.lockedUntil = now + lockMsFor(c.strikes);
          c.lockedBy = entryId;
          c.strikes += 1;
          c.strikeAt = now;
          c.fails = 0;
        }
      } else {
        c.entries.push({ id: entryId, at: now });
        if (c.entries.length >= b.max) {
          c.lockedUntil = now + b.windowMs;
          c.lockedBy = entryId;
        }
      }
      const fams = new Set(c.families ?? []);
      if (b.familyUid) fams.add(b.familyUid);
      tx.set(b.ref, {
        entries: c.entries,
        lockedUntil: c.lockedUntil,
        lockedBy: c.lockedBy,
        families: [...fams],
        fails: c.fails,
        strikes: c.strikes,
        strikeAt: c.strikeAt,
        ...(c.prevStrikes !== undefined ? { prevStrikes: c.prevStrikes, prevStrikeAt: c.prevStrikeAt ?? 0 } : {}),
        updatedAt: now,
      });
    }
    return true;
  });
}

/** A v1 hash that verified, and the v2 hash that replaces it. */
interface Migration {
  rowRef: FirebaseFirestore.DocumentReference;
  picture: boolean;
  /** The v1 hash that verified. The write only lands while the row still holds it, so a reset in between is never overwritten. */
  oldHash: Buffer;
  salt: Buffer;
  hash: Buffer;
}

/**
 * A correct passcode refunds its own entry. A success also clears the username bucket (fails and strikes back to 0).
 * With `migrate`, the same transaction rewrites a v1 row as v2: the v1 row stays readable until this commit lands,
 * and a wrong passcode never reaches this function.
 */
async function refund(d: Deps, buckets: Bucket[], entryId: string, migrate?: Migration): Promise<void> {
  await runCounterTx(d, async (tx) => {
    const [snaps, rowSnap] = await Promise.all([Promise.all(buckets.map((b) => tx.get(b.ref))), migrate ? tx.get(migrate.rowRef) : Promise.resolve(null)]);
    for (const [i, b] of buckets.entries()) {
      const raw = snaps[i]!.data();
      if (!raw) continue;
      const c = readCounter(raw);
      if (b.kind === 'strike') {
        tx.set(b.ref, {
          ...raw,
          entries: [],
          lockedUntil: c.lockedBy === entryId ? 0 : c.lockedUntil,
          lockedBy: c.lockedBy === entryId ? null : c.lockedBy,
          fails: 0,
          // A right try keeps the strikes, except the one its own 5th-try lock added before the compare: that goes back, with its time.
          strikes: !b.keepStrikes ? 0 : c.lockedBy === entryId && c.prevStrikes !== undefined ? c.prevStrikes : c.strikes,
          strikeAt: !b.keepStrikes ? 0 : c.lockedBy === entryId && c.prevStrikes !== undefined ? c.prevStrikeAt ?? 0 : c.strikeAt,
        });
        continue;
      }
      c.entries = c.entries.filter((e) => e.id !== entryId);
      if (c.lockedBy === entryId) {
        c.lockedBy = null;
        c.lockedUntil = 0;
      }
      tx.set(b.ref, { ...raw, entries: c.entries, lockedUntil: c.lockedUntil, lockedBy: c.lockedBy });
    }
    if (migrate && rowSnap?.exists) {
      const row = rowSnap.data()!;
      const cur = migrate.picture ? row.pic : row;
      if (cur && cur.v !== 2 && String(cur.hash) === migrate.oldHash.toString('hex')) {
        const next = { salt: migrate.salt.toString('hex'), hash: migrate.hash.toString('hex'), v: 2, updatedAt: nowOf(d) };
        tx.set(migrate.rowRef, migrate.picture ? { pic: { ...row.pic, ...next } } : next, { merge: true });
      }
    }
  });
}

const familyCounter = (d: Deps, uid: string) => d.db.doc(`pinIndex/${uid}/attempts/family`);
const ipCounter = (d: Deps, ip: string) => d.db.doc(`pinIndex/${GLOBAL}/attempts/ip_${sha(ip).slice(0, 32)}`);
const nameCounter = (d: Deps, nameKey: string) => d.db.doc(`pinIndex/${GLOBAL}/attempts/name_${sha(nameKey).slice(0, 32)}`);
const userCounter = (d: Deps, usernameLower: string) => d.db.doc(`pinIndex/${GLOBAL}/attempts/user_${sha(usernameLower).slice(0, 32)}`);
/** The strike bucket of a display name (legacy and unknown names). Its own key space, so no family's Unlock or reset can reach a username's user_ bucket. */
const dnCounter = (d: Deps, nameKey: string) => d.db.doc(`pinIndex/${GLOBAL}/attempts/dn_${sha(nameKey).slice(0, 32)}`);
const deviceCounter = (d: Deps, deviceId: string) => d.db.doc(`pinIndex/${GLOBAL}/attempts/dev_${sha(deviceId).slice(0, 32)}`);
/** Deletes in batches of at most 450: a Firestore batch refuses more than 500 writes, and devices are uncapped. */
async function deleteAll(d: Deps, refs: FirebaseFirestore.DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 450) {
    const batch = d.db.batch();
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

const usernameRef = (d: Deps, usernameLower: string) => d.db.doc(`usernames/${usernameLower}`);
const deviceRef = (d: Deps, familyUid: string, deviceId: string) => d.db.doc(`families/${familyUid}/devices/${deviceId}`);

/** Usernames this family owns, read from the server-owned index. The kid doc's own username field is never trusted for a lock. */
async function familyUsernames(d: Deps, familyUid: string): Promise<Map<string, string>> {
  const snap = await d.db.collection('usernames').where('familyUid', '==', familyUid).get();
  return new Map(snap.docs.map((x) => [String(x.data().kidId), x.id]));
}

/** Device ids recorded for one kid (or, with no kidId, for the whole family). Clients cannot create device docs. */
async function familyDeviceIds(d: Deps, familyUid: string, kidId?: string): Promise<string[]> {
  const col = d.db.collection(`families/${familyUid}/devices`);
  const snap = await (kidId ? col.where('kids', 'array-contains', kidId) : col).get();
  return snap.docs.map((x) => x.id);
}

/**
 * A parent who sets or resets a kid's PIN expects the kid to get straight in, so the same call clears the kid's name counter,
 * username counter, the counters of the devices recorded for that kid, the family counter and the caller's ip counter. The ip counter is shared by every family behind that address, so it is only
 * deleted when it has counted nobody but this family: a parent cannot reset their own kid's PIN to wipe the ip limit while
 * guessing at other families' kids (those guesses add the other family to the counter's `families` list).
 */
async function clearKidLocks(d: Deps, familyUid: string, nameKey: string, ip: string | undefined, kidId: string): Promise<void> {
  const refs = [familyCounter(d, familyUid), nameCounter(d, nameKey)];
  // The kid's username bucket and the buckets of the devices recorded for this kid.
  // A legacy kid with no username counts its strikes under its display name (dn_), so that bucket goes too.
  const username = (await familyUsernames(d, familyUid)).get(kidId);
  refs.push(dnCounter(d, nameKey));
  if (username) refs.push(userCounter(d, username));
  for (const id of await familyDeviceIds(d, familyUid, kidId)) refs.push(deviceCounter(d, id));
  if (ip) {
    const ipRef = ipCounter(d, ip);
    const fams = readCounter((await ipRef.get()).data()).families ?? [];
    if (fams.every((f) => f === familyUid)) refs.push(ipRef);
  }
  await deleteAll(d, refs);
}

// ---------- index lookups ----------

interface Secret {
  salt: Buffer;
  hash: Buffer;
  /** 2 is the peppered hash, 1 (no v on the row) the old scrypt. */
  v: 1 | 2;
}

interface PinRow {
  familyUid: string;
  kidId: string;
  rowRef: FirebaseFirestore.DocumentReference;
  digit: Secret;
  /** The picture PIN, when a parent set one. */
  pic: Secret | null;
}

function rowOf(familyUid: string, kidId: string, ref: FirebaseFirestore.DocumentReference, row: FirebaseFirestore.DocumentData): PinRow {
  const pic: Secret | null = row.pic && typeof row.pic === 'object' && row.pic.salt && row.pic.hash ? { salt: Buffer.from(String(row.pic.salt), 'hex'), hash: Buffer.from(String(row.pic.hash), 'hex'), v: row.pic.v === 2 ? 2 : 1 } : null;
  return { familyUid, kidId, rowRef: ref, digit: { salt: Buffer.from(String(row.salt), 'hex'), hash: Buffer.from(String(row.hash), 'hex'), v: row.v === 2 ? 2 : 1 }, pic };
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
      out.push(rowOf(familyUid, doc.id, doc.ref, doc.data()));
    }
  }
  return out;
}

/** One `get` on the username index, then the kid's own pinIndex row. Null when the username, the family, the kid or the row is missing. */
async function findByUsername(d: Deps, usernameLower: string): Promise<PinRow | null> {
  const claim = (await usernameRef(d, usernameLower).get()).data() as { familyUid?: unknown; kidId?: unknown } | undefined;
  if (!claim || typeof claim.familyUid !== 'string' || typeof claim.kidId !== 'string') return null;
  if (!(await familyRegistered(d, claim.familyUid))) return null;
  const [kid, row] = await Promise.all([d.db.doc(`families/${claim.familyUid}/kids/${claim.kidId}`).get(), d.db.doc(`pinIndex/${claim.familyUid}/kids/${claim.kidId}`).get()]);
  if (!kid.exists || !row.exists) return null;
  return rowOf(claim.familyUid, claim.kidId, row.ref, row.data()!);
}

// ---------- usernames ----------

export const USERNAME_INVALID_MESSAGE = 'A username is 3 to 20 letters, digits or _.';
export const USERNAME_RESERVED_MESSAGE = "That username isn't allowed. Pick another one.";
export const USERNAME_TAKEN_MESSAGE = 'That username is taken. Pick another one.';

/**
 * Claims a username for one kid: the index entry usernames/{lower} and kids/{kidId}.username, in one transaction. Server-side
 * only (L3 adds the parent callable, which must check the caller owns familyUid). Refuses a bad shape, a reserved word, and
 * a name another kid owns. A claim whose kid doc is gone is stale and counts as free. A kid that already has another username
 * gives it up in the same transaction. Claiming a kid's own username again changes nothing.
 */
export async function claimUsername(d: Deps, familyUid: string, kidId: string, username: unknown): Promise<{ username: string }> {
  if (typeof username !== 'string') throw new HttpsError('invalid-argument', USERNAME_INVALID_MESSAGE);
  const lower = username.trim().toLowerCase();
  if (!USERNAME_RE.test(lower)) throw new HttpsError('invalid-argument', USERNAME_INVALID_MESSAGE);
  if (reservedReason(lower)) throw new HttpsError('invalid-argument', USERNAME_RESERVED_MESSAGE);
  if (!ID_RE.test(kidId) || !ID_RE.test(familyUid)) throw new HttpsError('invalid-argument', 'Bad player id.');
  const kidRef = d.db.doc(`families/${familyUid}/kids/${kidId}`);
  await d.db.runTransaction(async (tx) => {
    const [kid, claim] = await Promise.all([tx.get(kidRef), tx.get(usernameRef(d, lower))]);
    if (!kid.exists) throw new HttpsError('not-found', 'That player does not exist.');
    const owner = claim.data() as { familyUid?: string; kidId?: string } | undefined;
    const mine = owner?.familyUid === familyUid && owner?.kidId === kidId;
    if (claim.exists && !mine) {
      const ownerKid = await tx.get(d.db.doc(`families/${owner?.familyUid}/kids/${owner?.kidId}`));
      if (ownerKid.exists) throw new HttpsError('already-exists', USERNAME_TAKEN_MESSAGE);
    }
    // The username this kid holds now, from the index (never from the kid doc field), is released.
    const old = String(kid.data()?.username ?? '');
    let release: FirebaseFirestore.DocumentReference | null = null;
    if (old && old !== lower && USERNAME_RE.test(old)) {
      const oldClaim = await tx.get(usernameRef(d, old));
      const o = oldClaim.data();
      if (oldClaim.exists && o?.familyUid === familyUid && o?.kidId === kidId) release = oldClaim.ref;
    }
    if (!mine) tx.set(usernameRef(d, lower), { familyUid, kidId, createdAt: nowOf(d) });
    tx.update(kidRef, { username: lower });
    if (release) tx.delete(release);
  });
  return { username: lower };
}

// ---------- the grown-up's username callables (L3) ----------

/** suggestUsername, checkUsername and setUsername each allow 30 calls a minute per parent. Every call counts and none refunds. */
export const NAME_TOOL_LIMIT = { max: 30, windowMs: 60_000 } as const;
export const NAME_TOOL_LOCKED_MESSAGE = 'Too many username checks. Wait a minute and try again.';

const toolCounter = (d: Deps, fn: string, uid: string) => d.db.doc(`pinIndex/${GLOBAL}/attempts/un_${fn}_${sha(uid).slice(0, 32)}`);

/** Counts one call against the caller's own bucket for `fn`. Runs after the caller is known to be a parent, so a stranger cannot fill a parent's bucket. */
async function limitParentTool(d: Deps, fn: string, uid: string): Promise<void> {
  if (!(await reserve(d, [{ ref: toolCounter(d, fn, uid), ...NAME_TOOL_LIMIT }], randomBytes(8).toString('hex')))) {
    throw new HttpsError('resource-exhausted', NAME_TOOL_LOCKED_MESSAGE);
  }
}

/** Free means no index entry, or an entry whose kid is gone (claimUsername treats that claim as free too). `mine` is the kid asking, who may keep a name it holds. */
async function usernameFree(d: Deps, lower: string, mine?: { familyUid: string; kidId: string }): Promise<boolean> {
  const claim = await usernameRef(d, lower).get();
  if (!claim.exists) return true;
  const o = claim.data() as { familyUid?: unknown; kidId?: unknown };
  if (mine && o.familyUid === mine.familyUid && o.kidId === mine.kidId) return true;
  if (typeof o.familyUid !== 'string' || typeof o.kidId !== 'string') return true;
  return !(await d.db.doc(`families/${o.familyUid}/kids/${o.kidId}`).get()).exists;
}

/** Three free usernames, each a color, an animal and 2 digits. Built from the word lists only: a player's name never goes in. */
export async function suggestUsername(d: Deps, auth: AuthContext | undefined): Promise<{ suggestions: string[] }> {
  const parent = await assertParent(d, auth);
  await limitParentTool(d, 'suggest', parent.uid);
  const out: string[] = [];
  for (let round = 0; round < 5 && out.length < 3; round++) {
    const batch = new Set<string>();
    while (batch.size < 9) batch.add(`${COLORS[randomInt(COLORS.length)]}${ANIMALS[randomInt(ANIMALS.length)]}${String(randomInt(100)).padStart(2, '0')}`);
    const fresh = [...batch].filter((n) => USERNAME_RE.test(n) && !reservedReason(n) && !out.includes(n));
    const free = await Promise.all(fresh.map((n) => usernameFree(d, n)));
    for (const [i, n] of fresh.entries()) if (free[i] && out.length < 3) out.push(n);
  }
  if (out.length < 3) throw new HttpsError('unavailable', 'Could not find free usernames. Try again.');
  return { suggestions: out };
}

export type UsernameVerdict = { free: true } | { free: false; reason: 'invalid' | 'reserved' | 'taken' };

/** Free or taken, for the wizard's live check. `kidId` is the player being named: a name that kid already holds is free. */
export async function checkUsername(d: Deps, auth: AuthContext | undefined, data: { username?: unknown; kidId?: unknown }): Promise<UsernameVerdict> {
  const parent = await assertParent(d, auth);
  await limitParentTool(d, 'check', parent.uid);
  if (typeof data.username !== 'string' || data.username.length > 64) return { free: false, reason: 'invalid' };
  const lower = data.username.trim().toLowerCase();
  if (!USERNAME_RE.test(lower)) return { free: false, reason: 'invalid' };
  if (reservedReason(lower)) return { free: false, reason: 'reserved' };
  const kidId = typeof data.kidId === 'string' && ID_RE.test(data.kidId) ? data.kidId : null;
  return (await usernameFree(d, lower, kidId ? { familyUid: parent.uid, kidId } : undefined)) ? { free: true } : { free: false, reason: 'taken' };
}

/**
 * Sets one of the caller's players' username. Parents only, 30 a minute per parent, and the grown-up PIN typed in the last 30
 * minutes (the same gate as setKidPin). The caller's own uid is the family, so a parent can never name another family's player.
 * The index and the kid doc change in one transaction (claimUsername); nothing else on the kid is written.
 */
export async function setUsername(d: Deps, auth: AuthContext | undefined, data: { kidId?: unknown; username?: unknown }): Promise<{ username: string }> {
  const parent = await assertParent(d, auth);
  await limitParentTool(d, 'set', parent.uid);
  if (typeof data.kidId !== 'string' || !ID_RE.test(data.kidId)) throw new HttpsError('invalid-argument', 'Bad player id.');
  await assertParentVerified(d, parent.uid);
  return claimUsername(d, parent.uid, data.kidId, data.username);
}

// ---------- devices ----------

/** The browser and device family from a user-agent string, for the label a grown-up sees: "iPad Safari". Never the raw string. */
export function deviceLabel(ua: unknown): string {
  const s = typeof ua === 'string' ? ua : '';
  const os = /iPad/.test(s) ? 'iPad' : /iPhone|iPod/.test(s) ? 'iPhone' : /Android/.test(s) ? 'Android' : /CrOS/.test(s) ? 'Chromebook' : /Windows/.test(s) ? 'Windows' : /Macintosh|Mac OS X/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '';
  const browser = /EdgiOS|Edg\//.test(s) ? 'Edge' : /CriOS|Chrome\//.test(s) ? 'Chrome' : /FxiOS|Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' ') || 'Browser';
}

/** Records a good sign-in on the device: firstSeen once, lastSeen and the kid every time. The label is set once, so a grown-up's rename stays. */
async function recordDevice(d: Deps, familyUid: string, kidId: string, deviceId: string, userAgent: unknown): Promise<void> {
  const ref = deviceRef(d, familyUid, deviceId);
  const now = nowOf(d);
  await d.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) tx.update(ref, { lastSeen: now, kids: FieldValue.arrayUnion(kidId) });
    else tx.set(ref, { firstSeen: now, lastSeen: now, kids: [kidId], label: deviceLabel(userAgent) });
  });
}

// ---------- kidSignIn ----------

export interface SignInInput {
  /** The typed username. L2 clients send this. */
  username?: unknown;
  /** The typed display name. Clients before L2 send this: the legacy path. */
  name?: unknown;
  /** 4 digits, or 4 picture letters a to i. */
  pin?: unknown;
  /** Alias of `pin` for a picture passcode. */
  picturePin?: unknown;
  /** Random id the client keeps in localStorage. Missing or malformed skips the device bucket (until L4). */
  deviceId?: unknown;
  ip: string | undefined;
  userAgent?: unknown;
  /** App Check verdict, for the log line only. */
  app?: 'valid' | 'missing';
}

/**
 * Sign-in by username (the usernames index), or by display name through the legacy path while players still lack usernames.
 * Counts the attempt in every bucket before it checks the passcode, refunds on success, migrates a v1 hash to v2 on a correct
 * passcode, and answers every miss with one message and one scrypt.
 */
export async function kidSignIn(d: Deps, input: SignInInput): Promise<{ token: string; remember: boolean }> {
  const typed = typeof input.username === 'string' ? input.username : input.name;
  const pin = input.pin ?? input.picturePin;
  // `pin` is 4 digits, or 4 picture letters a to i. Both take the same path, the same counters and the same scrypt.
  const isPicture = typeof pin === 'string' && PICTURE_RE.test(pin);
  if (typeof typed !== 'string' || typeof pin !== 'string' || !typed.trim() || typed.length > 40 || !(PIN_RE.test(pin) || isPicture)) {
    throw new HttpsError('invalid-argument', 'Type your username and a 4-digit PIN.');
  }
  const nameKey = normalizeName(typed);
  const usernameKey = USERNAME_RE.test(nameKey) ? nameKey : null;
  const deviceId = typeof input.deviceId === 'string' && DEVICE_RE.test(input.deviceId) ? input.deviceId : null;
  const ip = input.ip || 'unknown';

  // The username index first, so a username that equals another player's display name wins. A miss falls back to today's name path.
  let row = usernameKey ? await findByUsername(d, usernameKey) : null;
  let legacy = false;
  if (!row) {
    row = (await findRows(d, nameKey))[0] ?? null;
    legacy = row !== null;
  }
  const fam = row ? { familyUid: row.familyUid } : {};

  // Every path counts exactly one strike bucket (5 in a row), so six wrong tries get the same answers whether the name is a
  // username, a legacy display name of a kid with or without a username, or unknown: nothing shows which names exist.
  const buckets: Bucket[] = [{ ref: ipCounter(d, ip), ...LIMITS.ip, ...fam }];
  if (deviceId) buckets.push({ ref: deviceCounter(d, deviceId), ...LIMITS.device, ...fam });
  let strikeRef = dnCounter(d, nameKey);
  if (row && !legacy && usernameKey) {
    strikeRef = userCounter(d, usernameKey);
  } else {
    // The legacy name path, or an unknown name: the 10 per hour name bucket counts both alike.
    buckets.push({ ref: nameCounter(d, nameKey), ...LIMITS.name, ...fam });
    // A kid who has a username strikes under it, so the display name is no way around its lock. Otherwise the typed name keys the bucket.
    const own = row ? (await familyUsernames(d, row.familyUid)).get(row.kidId) : undefined;
    if (own) strikeRef = userCounter(d, own);
  }
  buckets.push({ kind: 'strike', ref: strikeRef, ...fam });
  if (row) buckets.push({ ref: familyCounter(d, row.familyUid), ...LIMITS.family });

  const entryId = randomBytes(8).toString('hex');
  if (!(await reserve(d, buckets, entryId))) throw new HttpsError('resource-exhausted', LOCKED_MESSAGE);

  // An unknown name still pays for one scrypt, so timing does not reveal which names exist.
  // A picture tried on a kid with no picture PIN, like an unknown name, pays one scrypt and fails the same way.
  const secret = row ? (isPicture ? row.pic : row.digit) : null;
  const derived = secret ? (secret.v === 2 ? await hashV2(d, pin, secret.salt) : await hashV1(pin, secret.salt)) : await scryptAsync(pin, DUMMY_SALT);
  const ok = timingSafeEqual(derived, secret ? secret.hash : DUMMY_HASH) && secret !== null;
  if (!ok || !row || !secret) throw new HttpsError('permission-denied', MISMATCH_MESSAGE);

  // Correct passcode on a v1 row: write v2 in the refund transaction. A wrong passcode never gets here.
  let migrate: Migration | undefined;
  if (secret.v === 1) {
    const salt = randomBytes(16);
    migrate = { rowRef: row.rowRef, picture: isPicture, oldHash: secret.hash, salt, hash: await hashV2(d, pin, salt) };
  }
  await refund(d, buckets, entryId, migrate);

  // L3. A grown-up forgot this device: the right passcode no longer opens it. Checked only after the passcode verified and its
  // entry was refunded, so a stranger cannot use the answer to learn which usernames exist, and the player's own counters stay clean.
  const [famDoc, devDoc] = await Promise.all([familyRef(d, row.familyUid).get(), deviceId ? deviceRef(d, row.familyUid, deviceId).get() : Promise.resolve(null)]);
  if (devDoc?.data()?.revoked === true) {
    logLine(d, { event: 'kidSignIn', outcome: 'revoked-device', legacy, fam: sha(row.familyUid).slice(0, 16), app: input.app ?? 'missing' });
    throw new HttpsError('failed-precondition', DEVICE_FORGOTTEN_MESSAGE);
  }

  if (deviceId) {
    try {
      await recordDevice(d, row.familyUid, row.kidId, deviceId, input.userAgent);
    } catch (err) {
      // A device record is a convenience for the grown-up. It never blocks a player who typed the right passcode.
      console.error('kidSignIn: device record failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  // The line carries a hash of the family only: no name, no kid id, no username. L4 starts when 7 days show no legacy: true.
  logLine(d, { event: 'kidSignIn', outcome: 'ok', legacy, fam: sha(row.familyUid).slice(0, 16), app: input.app ?? 'missing' });
  const token = await d.auth.createCustomToken(`kid_${row.kidId}`, { role: 'kid', familyUid: row.familyUid, kidId: row.kidId });
  // School mode (a family setting, off by default): nothing is remembered on this device.
  return { token, remember: famDoc.data()?.schoolMode !== true };
}

// ---------- passcodeKind and signinMode (L2) ----------

/**
 * passcodeKind is public (no sign-in), so it has its own buckets, in their own key space (pk_): spraying it can never lock a
 * sign-in. Every call counts and none refunds. Sized for a classroom behind one NAT: 30 players type a username once each.
 */
export const KIND_LIMITS = {
  ip: { max: 120, windowMs: 5 * 60_000 },
  device: { max: 60, windowMs: 5 * 60_000 },
} as const;
export const KIND_LOCKED_MESSAGE = 'Too many tries. Wait a minute and try again.';

const kindIpCounter = (d: Deps, ip: string) => d.db.doc(`pinIndex/${GLOBAL}/attempts/pk_ip_${sha(ip).slice(0, 32)}`);
const kindDeviceCounter = (d: Deps, deviceId: string) => d.db.doc(`pinIndex/${GLOBAL}/attempts/pk_dev_${sha(deviceId).slice(0, 32)}`);

export interface PasscodeKindInput {
  username?: unknown;
  deviceId?: unknown;
  ip: string | undefined;
  app?: 'valid' | 'missing';
}

/**
 * Which pad a player types on: 'digits' or 'pictures'. A player with a picture passcode gets 'pictures'. Every other name,
 * known or not, malformed or not, gets the same shape from the same work: 4 reads (the index, the registry, the kid, the row)
 * and one HMAC. An unknown name gets a kind from a keyed hash of the name, so the answer is stable per name and a miss looks
 * like a hit. The pepper is the key, so nobody can predict a miss offline.
 */
export async function passcodeKind(d: Deps, input: PasscodeKindInput): Promise<{ kind: 'digits' | 'pictures' }> {
  if (typeof input.username !== 'string' || input.username.length > 64) throw new HttpsError('invalid-argument', 'Type your username.');
  if (!d.pepper) throw new HttpsError('internal', 'Sign-in is not set up.');
  const key = normalizeName(input.username);
  const deviceId = typeof input.deviceId === 'string' && DEVICE_RE.test(input.deviceId) ? input.deviceId : null;
  const buckets: Bucket[] = [{ ref: kindIpCounter(d, input.ip || 'unknown'), ...KIND_LIMITS.ip }];
  if (deviceId) buckets.push({ ref: kindDeviceCounter(d, deviceId), ...KIND_LIMITS.device });
  if (!(await reserve(d, buckets, randomBytes(8).toString('hex')))) throw new HttpsError('resource-exhausted', KIND_LOCKED_MESSAGE);

  const coin = createHmac('sha256', d.pepper).update(`passcodeKind:${key}`).digest()[0]! % 2 === 0 ? 'digits' : 'pictures';
  // A malformed name reads a placeholder in place of the index doc, so even that costs the same.
  const claim = (await usernameRef(d, USERNAME_RE.test(key) ? key : GLOBAL).get()).data() as { familyUid?: unknown; kidId?: unknown } | undefined;
  const found = claim && typeof claim.familyUid === 'string' && typeof claim.kidId === 'string' ? { familyUid: claim.familyUid, kidId: claim.kidId } : null;
  // The same 4 reads for every name: a miss reads ids that do not exist ("_global" is never a family, a kid or a username).
  const fam = found?.familyUid ?? GLOBAL;
  const kid = found?.kidId ?? GLOBAL;
  const [registry, kidDoc, row] = await Promise.all([parentRef(d, fam).get(), d.db.doc(`families/${fam}/kids/${kid}`).get(), d.db.doc(`pinIndex/${fam}/kids/${kid}`).get()]);
  if (!found || !registry.exists || !kidDoc.exists || !row.exists) return { kind: coin };
  return { kind: rowOf(found.familyUid, found.kidId, row.ref, row.data()!).pic ? 'pictures' : 'digits' };
}

/** How long a config/app read is reused. Bounds the reads a public caller can cause to 1 per instance per window. */
const MODE_TTL_MS = 30_000;
let modeCache: { at: number; value: { signin2: boolean; pilot: boolean } } | null = null;
export const resetSigninModeCache = () => {
  modeCache = null;
};

/**
 * The first-screen switch, readable with no sign-in (config/app is readable only when signed in, and the first screen is not).
 * config/app.signin2: true shows the two doors to every device, 'pilot' only to devices that opted in on this device, anything
 * else (or a missing doc) is off. A read that fails answers off, so the screen players know today stays the fallback.
 */
export async function signinMode(d: Deps): Promise<{ signin2: boolean; pilot: boolean }> {
  const now = nowOf(d);
  if (modeCache && now - modeCache.at < (d.modeTtlMs ?? MODE_TTL_MS) && now >= modeCache.at) return modeCache.value;
  let value = { signin2: false, pilot: false };
  try {
    const v = (await d.db.doc('config/app').get()).data()?.signin2;
    value = { signin2: v === true, pilot: v === 'pilot' };
  } catch (err) {
    console.error('signinMode: config read failed', { error: err instanceof Error ? err.message : String(err) });
    return value;
  }
  modeCache = { at: now, value };
  return value;
}

// ---------- setKidPin ----------

export async function setKidPin(d: Deps, auth: AuthContext | undefined, data: { kidId?: unknown; pin?: unknown }, ip?: string): Promise<{ ok: true }> {
  const parent = await assertParent(d, auth);
  const { kidId, pin } = data;
  if (typeof kidId !== 'string' || !ID_RE.test(kidId)) throw new HttpsError('invalid-argument', 'Bad player id.');
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw new HttpsError('invalid-argument', 'The PIN must be 4 digits.');

  // Before anything that looks at the parent PIN: a caller who has not typed it recently learns nothing about it.
  await assertParentVerified(d, parent.uid);

  const kidRef = d.db.doc(`families/${parent.uid}/kids/${kidId}`);
  const kidSnap = await kidRef.get();
  if (!kidSnap.exists) throw new HttpsError('not-found', 'That player does not exist.');
  const name = String(kidSnap.data()?.name ?? '');
  const nameKey = normalizeName(name);
  if (!nameKey) throw new HttpsError('invalid-argument', 'The player needs a name first.');

  if (await isParentPin(d, parent.uid, pin)) throw new HttpsError('invalid-argument', 'Pick a PIN that is different from the parent PIN.');

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
  const hash = await hashV2(d, pin, salt);
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
    tx.set(rowRef, { nameKey, salt: salt.toString('hex'), hash: hash.toString('hex'), v: 2, updatedAt: nowOf(d) }, { merge: true });
    if (releaseOld) tx.delete(releaseOld);
  });
  await kidRef.update({ hasPin: true });
  await clearKidLocks(d, parent.uid, nameKey, ip, kidId);
  return { ok: true };
}

// ---------- setKidPicturePin ----------

/**
 * Sets the picture PIN of one of the caller's kids. Parents only. The kid must already have a digit PIN (the row and the
 * name claim exist), so the digit PIN keeps working and a picture is an extra way in. Hashed (v2, peppered scrypt) with a fresh
 * 16-byte salt exactly like setKidPin, stored in the same server-only row. The kid doc gets one flag, hasPicturePin,
 * so the parent screen can show it. The picture itself is never stored or logged.
 */
export async function setKidPicturePin(d: Deps, auth: AuthContext | undefined, data: { kidId?: unknown; picture?: unknown }, ip?: string): Promise<{ ok: true }> {
  const parent = await assertParent(d, auth);
  const { kidId, picture } = data;
  if (typeof kidId !== 'string' || !ID_RE.test(kidId)) throw new HttpsError('invalid-argument', 'Bad player id.');
  if (typeof picture !== 'string' || !PICTURE_RE.test(picture)) throw new HttpsError('invalid-argument', 'Pick 4 pictures.');
  await assertParentVerified(d, parent.uid);
  const kidRef = d.db.doc(`families/${parent.uid}/kids/${kidId}`);
  if (!(await kidRef.get()).exists) throw new HttpsError('not-found', 'That player does not exist.');
  const rowRef = d.db.doc(`pinIndex/${parent.uid}/kids/${kidId}`);
  const row = await rowRef.get();
  if (!row.exists) throw new HttpsError('failed-precondition', 'Set a PIN for this player first.');
  const salt = randomBytes(16);
  const hash = await hashV2(d, picture, salt);
  await rowRef.update({ pic: { salt: salt.toString('hex'), hash: hash.toString('hex'), v: 2, updatedAt: nowOf(d) } });
  await kidRef.update({ hasPicturePin: true });
  await clearKidLocks(d, parent.uid, String(row.data()?.nameKey ?? ''), ip, kidId);
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
  /** The same players by id, with when each lock ends (the portal's Lockouts view). */
  lockedKids: { kidId: string; until: number }[];
  /** Device ids whose own counter is locked. */
  lockedDevices: string[];
}

async function familyBuckets(d: Deps, uid: string) {
  const rows = await d.db.collection(`pinIndex/${uid}/kids`).get();
  const usernames = await familyUsernames(d, uid);
  const names = rows.docs.map((r) => ({ kidId: r.id, nameKey: String(r.data().nameKey), username: usernames.get(r.id) ?? null }));
  const ips = await d.db.collection(`pinIndex/${GLOBAL}/attempts`).where('families', 'array-contains', uid).get();
  return { names, ipDocs: ips.docs.filter((x) => x.id.startsWith('ip_')), deviceIds: await familyDeviceIds(d, uid) };
}

export async function kidLockStatus(d: Deps, auth: AuthContext | undefined): Promise<LockStatus> {
  const parent = await assertParent(d, auth);
  const now = nowOf(d);
  const fam = readCounter((await familyCounter(d, parent.uid).get()).data());
  const failures = fam.entries.filter((e) => e.at > now - LIMITS.family.windowMs).length;
  const { names, ipDocs, deviceIds } = await familyBuckets(d, parent.uid);
  const lockedPlayers: string[] = [];
  const lockedKids: { kidId: string; until: number }[] = [];
  for (const n of names) {
    const byName = readCounter((await nameCounter(d, n.nameKey).get()).data());
    const strikeRefs = n.username ? [userCounter(d, n.username), dnCounter(d, n.nameKey)] : [dnCounter(d, n.nameKey)];
    const byUser = await Promise.all(strikeRefs.map(async (r) => readCounter((await r.get()).data())));
    const until = Math.max(byName.lockedUntil, ...byUser.map((c) => c.lockedUntil));
    if (until > now) {
      lockedPlayers.push(n.nameKey);
      lockedKids.push({ kidId: n.kidId, until });
    }
  }
  const ipLocked = ipDocs.some((x) => readCounter(x.data()).lockedUntil > now);
  const lockedDevices: string[] = [];
  for (let i = 0; i < deviceIds.length; i += 300) {
    const ids = deviceIds.slice(i, i + 300);
    const snaps = await d.db.getAll(...ids.map((id) => deviceCounter(d, id)));
    snaps.forEach((x, j) => {
      if (readCounter(x.data()).lockedUntil > now) lockedDevices.push(ids[j]!);
    });
  }
  const lockedUntil = Math.max(fam.lockedUntil, 0);
  return { locked: fam.lockedUntil > now || lockedPlayers.length > 0 || ipLocked || lockedDevices.length > 0, failures, lockedUntil, lockedPlayers, lockedKids, lockedDevices };
}

export async function unlockKidSignIn(d: Deps, auth: AuthContext | undefined): Promise<{ ok: true }> {
  const parent = await assertParent(d, auth);
  const { names, ipDocs, deviceIds } = await familyBuckets(d, parent.uid);
  const refs = [
    familyCounter(d, parent.uid),
    ...names.map((n) => nameCounter(d, n.nameKey)),
    ...names.map((n) => dnCounter(d, n.nameKey)),
    ...names.flatMap((n) => (n.username ? [userCounter(d, n.username)] : [])),
    ...deviceIds.map((id) => deviceCounter(d, id)),
    ...ipDocs.map((x) => x.ref),
  ];
  await deleteAll(d, refs);
  return { ok: true };
}

// ---------- the grown-up PIN ----------

const PARENT_VERIFY_WINDOW_MS = 30 * 60_000;
/** A Google sign-in opens the 1st and 2nd lock only. */
const PARENT_REOPEN_MAX_STRIKES = 3;
const parentPinRef = (d: Deps, uid: string) => d.db.doc(`parentPins/${uid}`);
const familyRef = (d: Deps, uid: string) => d.db.doc(`families/${uid}`);
/** One strike bucket per parent uid, in its own key space (par_): no kid, family or portal Unlock reset derives this key. */
const parentCounter = (d: Deps, uid: string) => d.db.doc(`pinIndex/${GLOBAL}/attempts/par_${sha(uid).slice(0, 32)}`);

const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

function parentPinOf(data: unknown): string {
  const pin = (data as { pin?: unknown } | null | undefined)?.pin;
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw new HttpsError('invalid-argument', 'The PIN must be 4 digits.');
  return pin;
}

/**
 * A caller who holds a parent's Google session but has not typed the grown-up PIN in the last 30 minutes may not use any call that
 * compares a PIN with it, or that sets a PIN. A parent with no PIN has nothing to guard. This runs before any such comparison, so no
 * answer depends on the PIN and no try goes uncounted: the only counted way to test a guess is checkParentPin.
 */
async function assertParentVerified(d: Deps, uid: string): Promise<void> {
  const [fam, row] = await Promise.all([familyRef(d, uid).get(), parentPinRef(d, uid).get()]);
  if (!row.exists && typeof fam.data()?.pinHash !== 'string') return;
  const at = row.data()?.verifiedAt;
  const now = nowOf(d);
  if (!(typeof at === 'number' && at <= now && now - at < PARENT_VERIFY_WINDOW_MS)) throw new HttpsError('failed-precondition', PARENT_STALE_MESSAGE);
}

/** The v2 row of a parent, when it is well formed. */
function parentSecret(row: FirebaseFirestore.DocumentData | undefined): Secret | null {
  if (!row || row.v !== 2 || typeof row.salt !== 'string' || typeof row.hash !== 'string') return null;
  return { salt: Buffer.from(row.salt, 'hex'), hash: Buffer.from(row.hash, 'hex'), v: 2 };
}

/** True when `pin` is this parent's PIN, by the v2 row or by a legacy hash. Used to keep a kid PIN different from it. */
async function isParentPin(d: Deps, uid: string, pin: string): Promise<boolean> {
  const [fam, row] = await Promise.all([familyRef(d, uid).get(), parentPinRef(d, uid).get()]);
  const legacy = fam.data()?.pinHash;
  if (typeof legacy === 'string' && legacy === parentPinHash(uid, pin)) return true;
  const secret = parentSecret(row.data());
  return secret !== null && sameBytes(await hashV2(d, pin, secret.salt), secret.hash);
}

/**
 * A Google sign-in after the lock opens it while the bucket has fewer than PARENT_REOPEN_MAX_STRIKES strikes: the token's
 * auth_time is later than the moment the lock was set. It clears the lock and the wrong-try count and keeps the strikes. One sign-in
 * opens one lock. From the 3rd lock on only the timed lock ends it, because on a family iPad a Google sign-in is one tap and would
 * hand a kid 5 more guesses per tap.
 */
async function reopenAfterSignIn(d: Deps, ref: FirebaseFirestore.DocumentReference, authTimeSec: number | undefined): Promise<void> {
  if (typeof authTimeSec !== 'number') return;
  await d.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const raw = snap.data();
    if (!raw) return;
    const c = readCounter(raw);
    if (c.lockedUntil > nowOf(d) && c.strikes < PARENT_REOPEN_MAX_STRIKES && authTimeSec * 1000 > c.strikeAt) tx.set(ref, { ...raw, lockedUntil: 0, lockedBy: null, fails: 0 });
  }, TX_OPTS);
}

/**
 * Checks the grown-up PIN of the calling parent. Returns {ok} and never the reason. Every try counts in the one bucket of this
 * uid before anything is read, whether the parent has a v2 row, only the old pinHash, or no PIN at all, and every counted try pays
 * one scrypt, so neither the answers nor the lock timing show which of the three a uid is. A right PIN refunds its try.
 * A right PIN on the old pinHash writes the v2 row and deletes pinHash in one transaction. A wrong one never gets that far.
 */
export async function checkParentPin(d: Deps, auth: AuthContext | undefined, data: { pin?: unknown }): Promise<{ ok: boolean }> {
  const parent = await assertParent(d, auth);
  const pin = parentPinOf(data);
  const bucket: Bucket = { kind: 'strike', ref: parentCounter(d, parent.uid), keepStrikes: true };
  await reopenAfterSignIn(d, bucket.ref, parent.authTime);
  const entryId = randomBytes(8).toString('hex');
  if (!(await reserve(d, [bucket], entryId))) throw new HttpsError('resource-exhausted', LOCKED_PARENT_MESSAGE);

  const rowRef = parentPinRef(d, parent.uid);
  const famRef = familyRef(d, parent.uid);
  const [rowSnap, famSnap] = await Promise.all([rowRef.get(), famRef.get()]);
  const secret = parentSecret(rowSnap.data());
  const legacy = famSnap.data()?.pinHash;
  const legacyHash = typeof legacy === 'string' && /^[0-9a-f]{64}$/.test(legacy) ? Buffer.from(legacy, 'hex') : null;

  let ok: boolean;
  if (secret) ok = sameBytes(await hashV2(d, pin, secret.salt), secret.hash);
  else {
    // The old hash and no hash at all both pay the one scrypt a v2 row costs.
    await scryptAsync(pin, DUMMY_SALT);
    ok = legacyHash !== null && sameBytes(Buffer.from(parentPinHash(parent.uid, pin), 'hex'), legacyHash);
  }
  if (!ok) return { ok: false };

  await refund(d, [bucket], entryId);
  const now = nowOf(d);
  if (secret) {
    await rowRef.update({ verifiedAt: now });
    // An old pinHash that lingers next to a v2 row is dead weight, and it would keep the family doc unreadable.
    if (famSnap.data()?.pinHash !== undefined) await famRef.set({ pinHash: FieldValue.delete(), hasPin: true }, { merge: true });
    return { ok: true };
  }
  const salt = randomBytes(16);
  const hash = await hashV2(d, pin, salt);
  const migrated = await d.db.runTransaction(async (tx) => {
    const [r, f] = await Promise.all([tx.get(rowRef), tx.get(famRef)]);
    // Only while nothing changed since the check: a v2 row written meanwhile wins, and the old hash is the one that verified.
    if (r.exists || f.data()?.pinHash !== legacy) return false;
    tx.set(rowRef, { salt: salt.toString('hex'), hash: hash.toString('hex'), v: 2, updatedAt: now, verifiedAt: now });
    tx.set(famRef, { pinHash: FieldValue.delete(), hasPin: true }, { merge: true });
    return true;
  }, TX_OPTS);
  if (migrated) return { ok: true };
  // Lost a race: another call wrote the v2 row first. Check this PIN against it, so a right PIN never shows as wrong.
  const winner = parentSecret((await rowRef.get()).data());
  return { ok: winner !== null && sameBytes(await hashV2(d, pin, winner.salt), winner.hash) };
}

/**
 * Sets or changes the grown-up PIN of the calling parent. The first PIN needs nothing more. A parent who already has one
 * (a v2 row or the old pinHash) must have checked it with checkParentPin in the last 30 minutes, so someone at a signed-in device
 * who has not typed the PIN cannot replace it. It never opens a lock: a locked parent is refused, and the lock bucket is not touched.
 */
export async function setParentPin(d: Deps, auth: AuthContext | undefined, data: { pin?: unknown }): Promise<{ ok: true }> {
  const parent = await assertParent(d, auth);
  const pin = parentPinOf(data);
  const salt = randomBytes(16);
  const hash = await hashV2(d, pin, salt);
  const rowRef = parentPinRef(d, parent.uid);
  const famRef = familyRef(d, parent.uid);
  await d.db.runTransaction(async (tx) => {
    const [r, f, c] = await Promise.all([tx.get(rowRef), tx.get(famRef), tx.get(parentCounter(d, parent.uid))]);
    const now = nowOf(d);
    if (readCounter(c.data()).lockedUntil > now) throw new HttpsError('resource-exhausted', LOCKED_PARENT_MESSAGE);
    const had = r.exists || typeof f.data()?.pinHash === 'string';
    const verifiedAt = r.data()?.verifiedAt;
    if (had && !(typeof verifiedAt === 'number' && verifiedAt <= now && now - verifiedAt < PARENT_VERIFY_WINDOW_MS)) {
      throw new HttpsError('failed-precondition', PARENT_STALE_MESSAGE);
    }
    tx.set(rowRef, { salt: salt.toString('hex'), hash: hash.toString('hex'), v: 2, updatedAt: now, verifiedAt: had ? now : 0 });
    tx.set(famRef, { pinHash: FieldValue.delete(), hasPin: true, ...(f.exists && typeof f.data()?.createdAt === 'number' ? {} : { createdAt: now }) }, { merge: true });
  }, TX_OPTS);
  return { ok: true };
}
