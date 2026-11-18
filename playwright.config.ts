import { defineConfig } from '@playwright/test';

// iPad-size run on system Chrome against the local dev server (localStorage data, no Firebase).
// `npm run test:e2e`. SCREENSHOTS=1 also writes the PNGs under docs/screenshots/.
const PORT = 5199;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  webServer: {
    command: `VITE_DATA_MODE=local npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
