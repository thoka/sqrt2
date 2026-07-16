import { defineConfig, devices } from '@playwright/test';

// E2E-Konfiguration fuer die neue Coding-Instanz (siehe TOOLING_ENV_SPEC.md §3).
// Hebt die "kein Browser"-Blockade der alten Sandbox auf: startet einen
// Vite-Preview-Server ueber das gebauter dist/ und prueft das Haupttool
// (Canvas-Rendering + Rest-Widget + Steuerung) real im Chromium.
export default defineConfig({
	testDir: './tests/e2e',
	timeout: 30000,
	expect: { timeout: 10000 },
	fullyParallel: true,
	reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
	use: {
		// baseURL wird auf den preview-Server (Port 4173) gesetzt.
		baseURL: 'http://localhost:4173/',
		headless: true,
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		// Fester Port 4173 (passend zur baseURL url), strictPort verhindert
		// silent fail wenn der Port belegt ist. reuseExistingServer:false,
		// damit zwei parallele E2E-Runs nicht denselben fremden Server nehmen.
		command: 'node_modules/.bin/vite preview --port 4173 --strictPort',
		url: 'http://localhost:4173/',
		reuseExistingServer: false,
		timeout: 60000,
	},
});
