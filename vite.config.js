import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // Mehrseiten-App (index.html + remote-control.html): KEIN SPA-Fallback,
  // damit unbekannte/clean-URLs nicht stumm auf index.html umgeleitet
  // werden (sonst "index für alle Pfade"). Nur reale .html-Dateien werden
  // ausgeliefert, der Rest antwortet mit 404.
  appType: 'mpa',
  base: process.env.GITHUB_PAGES ? '/sqrt2/' : '/',
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        remoteControl: resolve(import.meta.dirname, 'remote-control.html'),
      },
    },
  },
  // https://svelte.dev/docs/svelte/testing - unter Vitest muss Svelte in den
  // Browser-Build statt den SSR-Build auflösen, sonst schlägt mount() fehl.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js'],
  },
});
