import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { loadEnv } from 'vite';
import { defineConfig, type Plugin } from 'vitest/config';
// @ts-expect-error plain .mjs script, no types
import { buildEnvMessage, buildEnvProblems } from './scripts/build-env.mjs';

// The build number: seconds since the epoch when this bundle was built (APP_BUILD overrides it for the release
// script's tests). The bundle compares it with config/app.minVersion; dist/version.json carries the same number
// for scripts/set-min-version.mjs, which sets minVersion after the deploy.
const BUILD = Number(process.env.APP_BUILD) || Math.floor(Date.now() / 1000);

// The short commit shown in the parent area footer. APP_SHA overrides it; a build with no git says "dev".
function shortSha(): string {
  if (process.env.APP_SHA) return process.env.APP_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'dev';
  } catch {
    return 'dev';
  }
}

function versionJson(): Plugin {
  return {
    name: 'mathquest-version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build: BUILD })}\n` });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // A production build with no Firebase config would ship a bundle that cannot sign a kid in (scripts/build-env.mjs).
  if (command === 'build') {
    const problems: string[] = buildEnvProblems({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...pickViteEnv() });
    if (problems.length) throw new Error(buildEnvMessage(problems));
  }
  return config;
});

/** Variables set in the shell win over .env files, as Vite's own loadEnv does; an empty shell value counts as empty. */
function pickViteEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('VITE_') && v !== undefined) out[k] = v;
  return out;
}

const config = {
  define: { __APP_BUILD__: JSON.stringify(BUILD), __APP_SHA__: JSON.stringify(shortSha()) },
  plugins: [
    react(),
    versionJson(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'fonts/*.woff2'],
      manifest: {
        name: 'Math Quest',
        short_name: 'Math Quest',
        description: 'Adaptive times tables and fractions practice, built as a dungeon game.',
        theme_color: '#141726',
        background_color: '#141726',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Firebase auth helper pages must always hit the network.
        navigateFallbackDenylist: [/^\/__\//],
      },
    }),
  ],
  // The Firebase SDK (auth + Firestore with offline cache) is most of the bundle; it is
  // precached by the service worker, so it loads once per release.
  build: { chunkSizeWarningLimit: 1100 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'functions/test/clientip.test.ts'],
  },
};
