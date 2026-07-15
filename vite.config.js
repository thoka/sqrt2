import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/sqrt2/' : '/',
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        sqrt2: resolve(import.meta.dirname, 'sqrt2.html'),
        remoteControl: resolve(import.meta.dirname, 'remote-control.html'),
        selectionStrategyPrototype: resolve(import.meta.dirname, 'selection_strategy_prototype.html'),
        svelteSmoke: resolve(import.meta.dirname, 'svelte-smoke.html'),
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
