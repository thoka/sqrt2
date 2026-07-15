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
	// host:true -> an alle Interfaces binden (0.0.0.0), damit z.B. Windows 11
	// aus WSL die Dev-/Preview-Server per localhost erreicht (Default ist nur
	// localhost, von ausserhalb des WSL-Gasts nicht erreichbar).
	server: { host: true },
	preview: { host: true },
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
