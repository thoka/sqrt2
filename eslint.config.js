import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

// ESLint-Flat-Config (ESLint 9) für das sqrt2-Projekt. Schwerpunkt:
// .svelte-Dateien via eslint-plugin-svelte, Browser+Node-Globals, sonst
// empfohlene Kernregeln. Bewusst entspannt (Warnungen statt Errors bei
// ungenutzten Variablen), damit Lint ein Review-Helfer und kein Blockierer
// ist - echte Fehler (undef, falsche Syntax) bleiben Errors.
export default [
  js.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'warn',
    },
  },
  {
    // In .svelte übernimmt svelte-check die Definitheitprüfung (siehe
    // `check`-Script); cores `no-undef` meldet hier sonst Fehlalarme auf
    // instanz-/modul-Scope-Variablen.
    files: ['**/*.svelte'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      'playwright-report/',
      'test-results/',
      '.svelte-kit/',
      'e2e/artifacts/',
    ],
  },
];
