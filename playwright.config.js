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
	// Kein config.webServer: Playwrights eingebauter Verfügbarkeits-Check
	// (isURLAvailable) setzt keinen socketTimeout und hängt in dieser
	// WSL2-Umgebung für immer, weil Verbindungen zu geschlossenen
	// Loopback-Ports kein ECONNREFUSED liefern (siehe
	// docs/E2E-PLAYWRIGHT-SPEC.md). globalSetup startet den Preview-Server
	// stattdessen selbst und pollt mit fetch()+AbortSignal.timeout.
	globalSetup: './tests/e2e/global-setup.js',
});
