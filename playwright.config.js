import { defineConfig, devices } from '@playwright/test';

// E2E-Konfiguration fuer die neue Coding-Instanz (siehe TOOLING_ENV_SPEC.md §3).
// Hebt die "kein Browser"-Blockade der alten Sandbox auf: startet einen
// Vite-Preview-Server ueber das gebauter dist/ und prueft das Haupttool
// (Canvas-Rendering + Rest-Widget + Steuerung) real im Chromium.
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173/sqrt2.html',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
