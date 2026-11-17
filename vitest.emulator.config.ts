import { defineConfig } from 'vitest/config';

// Runs only under the Firestore emulator: `npm run test:emulator`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test-emulator/**/*.test.ts', 'functions/test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
