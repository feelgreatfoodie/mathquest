import { defineConfig } from '@playwright/test';

// Emulator-backed e2e: Auth, Firestore and Functions emulators (project demo-e2e) plus a dev server in firestore mode wired to them.
// `npm run test:e2e:emulator`. The server uses E2E_LANDING_PORT (default 5198), the same port the main config gives its firestore-mode server.
const LANDING_PORT = Number(process.env.E2E_LANDING_PORT) || 5198;

export default defineConfig({
  testDir: 'e2e/emulator',
  testMatch: '**/*.emulator.ts',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${LANDING_PORT}`,
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  projects: [{ name: 'chrome', use: { channel: process.env.CI ? undefined : 'chrome' } }],
  webServer: {
    command: `VITE_DATA_MODE= VITE_USE_EMULATORS=true VITE_FIREBASE_API_KEY=fake-e2e-key VITE_FIREBASE_AUTH_DOMAIN=demo-e2e.firebaseapp.com VITE_FIREBASE_PROJECT_ID=demo-e2e VITE_FIREBASE_APP_ID=1:1:web:e2e npx vite --port ${LANDING_PORT} --strictPort`,
    port: LANDING_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
