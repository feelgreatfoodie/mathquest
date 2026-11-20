import type { FirebaseApp } from 'firebase/app';

/**
 * App Check with reCAPTCHA Enterprise, monitor mode: the functions log a verdict per call and refuse nothing, so a page load
 * without a token still signs in. It starts only when VITE_RECAPTCHA_SITE_KEY is set (a public site key, set in the build
 * env and never committed); an empty or missing key means off, and the app code for it is never fetched. The emulators
 * never use it. Returns true when it started.
 */
export async function initAppCheck(app: FirebaseApp, siteKey: string | undefined, useEmulators: boolean): Promise<boolean> {
  const key = siteKey?.trim();
  if (!key || useEmulators) return false;
  try {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(key), isTokenAutoRefreshEnabled: true });
    return true;
  } catch (err) {
    // Monitor mode must never stop a player from signing in.
    console.warn('App Check did not start', err);
    return false;
  }
}
