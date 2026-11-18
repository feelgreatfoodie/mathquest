import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type Auth,
} from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

const env = import.meta.env;

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

/** "local" stores progress on this device only (no sign-in). */
export const dataMode: 'firestore' | 'local' =
  env.VITE_DATA_MODE === 'local' || !firebaseConfigured ? 'local' : 'firestore';

const FUNCTIONS_REGION = 'us-west1';

let cached: { app: FirebaseApp; auth: Auth; db: Firestore } | null = null;

export function getFirebase() {
  if (cached) return cached;
  const app = initializeApp(config);
  const auth = getAuth(app);
  // IndexedDB cache: reads and writes keep working offline and sync when the iPad reconnects.
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (env.VITE_USE_EMULATORS === 'true') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  cached = { app, auth, db };
  return cached;
}

export async function signInParent(): Promise<void> {
  const { auth } = getFirebase();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

function callable<I, O>(name: string) {
  const { app } = getFirebase();
  const fns = getFunctions(app, FUNCTIONS_REGION);
  if (env.VITE_USE_EMULATORS === 'true') connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  return httpsCallable<I, O>(fns, name);
}

/** First name + PIN to the kidSignIn function, then sign this device in as that kid. */
export async function signInKid(name: string, pin: string): Promise<void> {
  const res = await callable<{ name: string; pin: string }, { token: string }>('kidSignIn')({ name, pin });
  await signInWithCustomToken(getFirebase().auth, res.data.token);
}

/** Registers this Google account as a parent (idempotent). Throws "Math Quest is full right now." at the cap. */
export async function registerParent(): Promise<void> {
  await callable<Record<string, never>, { ok: true }>('registerParent')({});
}

export async function setKidPin(kidId: string, pin: string): Promise<void> {
  await callable<{ kidId: string; pin: string }, { ok: true }>('setKidPin')({ kidId, pin });
}

/** Sets the picture PIN of a kid who already has a digit PIN (4 icons, the letters a to i). Parents only. */
export async function setKidPicturePin(kidId: string, picture: string): Promise<void> {
  await callable<{ kidId: string; picture: string }, { ok: true }>('setKidPicturePin')({ kidId, picture });
}

export interface KidLockStatus {
  locked: boolean;
  failures: number;
  lockedUntil: number;
  lockedPlayers: string[];
}

export async function kidLockStatus(): Promise<KidLockStatus> {
  return (await callable<Record<string, never>, KidLockStatus>('kidLockStatus')({})).data;
}

export async function unlockKidSignIn(): Promise<void> {
  await callable<Record<string, never>, { ok: true }>('unlockKidSignIn')({});
}

/** The kid claims on the current session, or null for a parent (Google) session. */
export async function kidClaims(): Promise<{ familyUid: string; kidId: string } | null> {
  const user = getFirebase().auth.currentUser;
  if (!user) return null;
  const { claims } = await user.getIdTokenResult();
  return claims.role === 'kid' && typeof claims.familyUid === 'string' && typeof claims.kidId === 'string'
    ? { familyUid: claims.familyUid, kidId: claims.kidId }
    : null;
}

export async function signOutParent(): Promise<void> {
  await fbSignOut(getFirebase().auth);
}
