import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/sqrt2/' : '/',
  build: {
    rollupOptions: {
      input: {
        sqrt2: resolve(import.meta.dirname, 'sqrt2.html'),
        selectionStrategyPrototype: resolve(import.meta.dirname, 'selection_strategy_prototype.html'),
      },
    },
  },
});
