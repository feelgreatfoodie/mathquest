import { defineConfig } from '@playwright/test';

// iPad-size run on system Chrome against the local dev server (localStorage data, no Firebase).
// `npm run test:e2e`. SCREENSHOTS=1 also writes the PNGs under docs/screenshots/.
const PORT = Number(process.env.E2E_PORT) || 5199;
// Second server in firestore mode with no user, so the landing (sign-in) screens render. Fake public ids, no network use.
const LANDING_PORT = Number(process.env.E2E_LANDING_PORT) || 5198;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  workers: 1,
  // CI: list plus an HTML report the workflow uploads when a spec fails.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  // The visual.e2e.ts baselines are macOS system Chrome renders. A Linux render never matches them, so CI skips
  // the toHaveScreenshot comparisons and runs every other assertion in those specs.
  ignoreSnapshots: !!process.env.CI,
  // Visual baselines live beside the specs, one folder, no platform suffix (system Chrome on macOS).
  snapshotPathTemplate: '{testDir}/__baselines__/{arg}{ext}',
  expect: { toHaveScreenshot: { threshold: 0.1, maxDiffPixelRatio: 0.001, animations: 'disabled' } },
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  // Two projects: system Chrome for every spec, and WebKit (the engine of Safari on iPad) for the specs that name it.
  projects: [
    // Locally: system Chrome. CI (ubuntu-latest) installs the Playwright chromium build only.
    { name: 'chrome', use: process.env.CI ? {} : { channel: 'chrome' }, testIgnore: '**/*.webkit.e2e.ts' },
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: '**/*.webkit.e2e.ts' },
  ],
  webServer: [
    {
      command: `VITE_DATA_MODE=local npx vite --port ${PORT} --strictPort`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `VITE_DATA_MODE= VITE_FIREBASE_API_KEY=fake-e2e-key VITE_FIREBASE_AUTH_DOMAIN=demo-e2e.firebaseapp.com VITE_FIREBASE_PROJECT_ID=demo-e2e VITE_FIREBASE_APP_ID=1:1:web:e2e npx vite --port ${LANDING_PORT} --strictPort`,
      port: LANDING_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
