// Test für src/lib/zoomStateTween.js - braucht requestAnimationFrame (rAF),
// das node:test (tests/unit/) nicht bereitstellt - deshalb hier unter
// src/**/*.test.js, wo vitest mit jsdom-Environment (inkl. rAF) läuft, obwohl
// zoomStateTween.js selbst keine Svelte-Komponente ist (siehe vite.config.js
// `test.include`, CLAUDE.md "Svelte-Komponenten-Tests" gilt sinngemäß: die
// Wahl des Runners richtet sich danach, welche Umgebung das Modul braucht,
// nicht danach, ob es eine .svelte-Datei ist).
import { test, expect } from 'vitest';
import { get } from 'svelte/store';
import { configStore } from './configStore.js';
import { initZoomStateTween } from './zoomStateTween.js';

const BASE = {
	...get(configStore),
	edgeZoomControlMode: false,
	zoomState: 'rand',
	randZoomLevel: 0.0,
	modeAB: 0.0,
	autoZoomMinPx: 3,
};

async function waitUntil(predicate, timeoutMs = 8000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error('waitUntil: Timeout, Bedingung nie erfüllt');
		}
		await new Promise((r) => setTimeout(r, 30));
	}
}

// initZoomStateTween() ist idempotent (globaler configStore-Singleton) -
// einmal für die ganze Testdatei registrieren.
initZoomStateTween();

test('Wechsel nach "gleichmaessig" animiert modeAB->1 und autoZoomMinPx->100', async () => {
	configStore.set({ ...BASE, modeAB: 0.9, autoZoomMinPx: 50 });
	configStore.update((c) => ({ ...c, edgeZoomControlMode: true, zoomState: 'gleichmaessig' }));

	await waitUntil(() => {
		let c = get(configStore);
		return Math.abs(c.modeAB - 1) < 0.01 && Math.abs(c.autoZoomMinPx - 100) < 1;
	});
}, 10000);

test('Wechsel nach "flaechentreu" animiert modeAB->0 und autoZoomMinPx->0', async () => {
	configStore.set({
		...BASE,
		edgeZoomControlMode: true,
		zoomState: 'gleichmaessig',
		modeAB: 1,
		autoZoomMinPx: 100,
	});
	configStore.update((c) => ({ ...c, zoomState: 'flaechentreu' }));

	await waitUntil(() => {
		let c = get(configStore);
		return Math.abs(c.modeAB) < 0.01 && Math.abs(c.autoZoomMinPx) < 1;
	});
}, 10000);

test('Zustand "rand" animiert modeAB zum gemerkten randZoomLevel, nicht auf 0', async () => {
	configStore.set({
		...BASE,
		edgeZoomControlMode: true,
		zoomState: 'flaechentreu',
		modeAB: 0,
		autoZoomMinPx: 0,
		randZoomLevel: 0.62,
	});
	configStore.update((c) => ({ ...c, zoomState: 'rand' }));

	await waitUntil(() => {
		let c = get(configStore);
		return Math.abs(c.modeAB - 0.62) < 0.01 && Math.abs(c.autoZoomMinPx - 3) < 0.5;
	});
}, 10000);

test('edgeZoomControlMode=false stoppt weitere automatische Updates', async () => {
	configStore.set({
		...BASE,
		edgeZoomControlMode: true,
		zoomState: 'gleichmaessig',
		modeAB: 0,
		autoZoomMinPx: 0,
	});
	// Übergang anstoßen, aber NICHT bis zum Ende warten.
	await new Promise((r) => setTimeout(r, 100));
	configStore.update((c) => ({ ...c, edgeZoomControlMode: false }));
	let frozen = get(configStore).modeAB;
	await new Promise((r) => setTimeout(r, 300));
	expect(get(configStore).modeAB).toBe(frozen);
}, 10000);
