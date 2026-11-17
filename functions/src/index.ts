import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineString } from 'firebase-functions/params';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import * as core from './core.js';
import type { AuthContext, Deps } from './core.js';

initializeApp();

// Parent emails, comma separated. Set in functions/.env (gitignored); `npm run deploy` checks it.
const allowedEmails = defineString('ALLOWED_EMAILS');

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
      getUser: async (uid) => {
        const u = await auth.getUser(uid);
        return { email: u.email, emailVerified: u.emailVerified };
      },
    },
    allowedEmails: allowedEmails
      .value()
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };
}

function authOf(req: CallableRequest): AuthContext | undefined {
  if (!req.auth) return undefined;
  const t = req.auth.token;
  return { uid: req.auth.uid, email: t.email, emailVerified: t.email_verified };
}

export const kidSignIn = onCall(opts, (req) =>
  core.kidSignIn(deps(), { name: req.data?.name, pin: req.data?.pin, ip: core.clientIp(req.rawRequest.headers['x-forwarded-for'], req.rawRequest.ip) }),
);
export const setKidPin = onCall(opts, (req) => core.setKidPin(deps(), authOf(req), req.data ?? {}));
export const kidLockStatus = onCall(opts, (req) => core.kidLockStatus(deps(), authOf(req)));
export const unlockKidSignIn = onCall(opts, (req) => core.unlockKidSignIn(deps(), authOf(req)));
