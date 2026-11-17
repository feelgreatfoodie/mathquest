import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import * as core from './core.js';
import type { AuthContext, Deps } from './core.js';

initializeApp();

// Dedicated runtime service account: Firestore access plus Token Creator on itself, which
// createCustomToken needs to sign kid tokens. The project has no default compute account.
const opts = {
  region: 'us-west1',
  maxInstances: 5,
  serviceAccount: 'mathquest-fn@rezzed-mathquest.iam.gserviceaccount.com',
} as const;

function deps(): Deps {
  const auth = getAuth();
  return {
    db: getFirestore(),
    auth: {
      createCustomToken: (uid, claims) => auth.createCustomToken(uid, claims),
    },
  };
}

function authOf(req: CallableRequest): AuthContext | undefined {
  if (!req.auth) return undefined;
  const t = req.auth.token;
  return { uid: req.auth.uid, email: t.email, emailVerified: t.email_verified, provider: t.firebase?.sign_in_provider };
}

export const kidSignIn = onCall(opts, (req) =>
  core.kidSignIn(deps(), { name: req.data?.name, pin: req.data?.pin, ip: req.rawRequest.ip }),
);
export const registerParent = onCall(opts, (req) => core.registerParent(deps(), authOf(req)));
export const setKidPin = onCall(opts, (req) => core.setKidPin(deps(), authOf(req), req.data ?? {}));
export const kidLockStatus = onCall(opts, (req) => core.kidLockStatus(deps(), authOf(req)));
export const unlockKidSignIn = onCall(opts, (req) => core.unlockKidSignIn(deps(), authOf(req)));
