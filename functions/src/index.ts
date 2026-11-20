import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/logger';
import { defineSecret } from 'firebase-functions/params';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import * as core from './core.js';
import type { AuthContext, Deps } from './core.js';

initializeApp();

// The pepper that keys every v2 passcode hash. Secret Manager holds it; the runtime account has secretAccessor on it.
// Every function that hashes or verifies a passcode lists it in `secrets`. The emulator reads functions/.secret.local.
const MQ_PIN_PEPPER = defineSecret('MQ_PIN_PEPPER');

// Dedicated runtime service account: Firestore access plus Token Creator on itself, which
// createCustomToken needs to sign kid tokens. The project has no default compute account.
const opts = {
  region: 'us-west1',
  maxInstances: 10,
  serviceAccount: 'mathquest-fn@rezzed-mathquest.iam.gserviceaccount.com',
} as const;

// kidSignIn is the front door at the bell: one warm instance, room for a class of 30.
const signInOpts = { ...opts, minInstances: 1, maxInstances: 20, secrets: [MQ_PIN_PEPPER] };
const pepperOpts = { ...opts, secrets: [MQ_PIN_PEPPER] };

/** `withPepper` only for the functions that list the secret in `secrets`; reading an unbound secret is an error. */
function deps(withPepper = false): Deps {
  const auth = getAuth();
  return {
    db: getFirestore(),
    pepper: withPepper ? MQ_PIN_PEPPER.value() : '',
    // The emulator never reuses the first-screen switch, so an e2e run can flip config/app.signin2 between tests.
    ...(process.env.FUNCTIONS_EMULATOR === 'true' ? { modeTtlMs: 0 } : {}),
    auth: {
      createCustomToken: (uid, claims) => auth.createCustomToken(uid, claims),
    },
  };
}

function authOf(req: CallableRequest): AuthContext | undefined {
  if (!req.auth) return undefined;
  const t = req.auth.token;
  return { uid: req.auth.uid, email: t.email, emailVerified: t.email_verified, provider: t.firebase?.sign_in_provider, authTime: typeof t.auth_time === 'number' ? t.auth_time : undefined };
}

/**
 * App Check, monitor mode: one structured line per call with the verdict, and no enforceAppCheck, so nothing is refused.
 * `req.app` is set only for a valid token. L3 turns enforcement on after 7 days of these lines show the kids' devices passing.
 */
function appVerdict(fn: string, req: CallableRequest): 'valid' | 'missing' {
  const app = req.app ? 'valid' : 'missing';
  logger.info('appcheck', { event: 'appcheck', fn, app });
  return app;
}

const ipOf = (req: CallableRequest) => core.clientIp(req.rawRequest.headers['x-forwarded-for'], req.rawRequest.ip);

export const kidSignIn = onCall(signInOpts, (req) =>
  core.kidSignIn(deps(true), {
    username: req.data?.username,
    name: req.data?.name,
    pin: req.data?.pin,
    picturePin: req.data?.picturePin,
    deviceId: req.data?.deviceId,
    ip: ipOf(req),
    userAgent: req.rawRequest.headers['user-agent'],
    app: appVerdict('kidSignIn', req),
  }),
);
// The first screen's two public callables. Neither needs a sign-in. passcodeKind hashes with the pepper, so it binds the secret.
export const passcodeKind = onCall(pepperOpts, (req) =>
  core.passcodeKind(deps(true), { username: req.data?.username, deviceId: req.data?.deviceId, ip: ipOf(req), app: appVerdict('passcodeKind', req) }),
);
export const signinMode = onCall(opts, (req) => (appVerdict('signinMode', req), core.signinMode(deps())));
export const registerParent = onCall(opts, (req) => (appVerdict('registerParent', req), core.registerParent(deps(), authOf(req))));
export const setKidPin = onCall(pepperOpts, (req) => (appVerdict('setKidPin', req), core.setKidPin(deps(true), authOf(req), req.data ?? {}, ipOf(req))));
export const setKidPicturePin = onCall(pepperOpts, (req) => (appVerdict('setKidPicturePin', req), core.setKidPicturePin(deps(true), authOf(req), req.data ?? {}, ipOf(req))));
export const checkParentPin = onCall(pepperOpts, (req) => (appVerdict('checkParentPin', req), core.checkParentPin(deps(true), authOf(req), req.data ?? {})));
export const setParentPin = onCall(pepperOpts, (req) => (appVerdict('setParentPin', req), core.setParentPin(deps(true), authOf(req), req.data ?? {})));
export const kidLockStatus = onCall(opts, (req) => (appVerdict('kidLockStatus', req), core.kidLockStatus(deps(), authOf(req))));
export const unlockKidSignIn = onCall(opts, (req) => (appVerdict('unlockKidSignIn', req), core.unlockKidSignIn(deps(), authOf(req))));
