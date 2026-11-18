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
  reporter: [['list']],
  // Visual baselines live beside the specs, one folder, no platform suffix (system Chrome on macOS).
  snapshotPathTemplate: '{testDir}/__baselines__/{arg}{ext}',
  expect: { toHaveScreenshot: { threshold: 0.1, maxDiffPixelRatio: 0.001, animations: 'disabled' } },
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
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
