import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, type Plugin } from 'vitest/config';

// The build number: seconds since the epoch when this bundle was built (APP_BUILD overrides it for the release
// script's tests). The bundle compares it with config/app.minVersion; dist/version.json carries the same number
// for scripts/set-min-version.mjs, which sets minVersion after the deploy.
const BUILD = Number(process.env.APP_BUILD) || Math.floor(Date.now() / 1000);

function versionJson(): Plugin {
  return {
    name: 'mathquest-version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build: BUILD })}\n` });
    },
  };
}

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(BUILD) },
  plugins: [
    react(),
    versionJson(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
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
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
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
});
