// Test für src/lib/zoomStateTween.js - braucht requestAnimationFrame (rAF),
// das node:test (tests/unit/) nicht bereitstellt - deshalb hier unter
// src/**/*.test.js, wo vitest mit jsdom-Environment (inkl. rAF) läuft (siehe
// CLAUDE.md "Svelte-Komponenten-Tests": die Wahl des Runners richtet sich
// danach, welche Umgebung das Modul braucht, nicht danach, ob es eine
// .svelte-Datei ist).
import { test, expect } from 'vitest';
import { get } from 'svelte/store';
import { configStore } from './configStore.js';
import { initZoomStateTween } from './zoomStateTween.js';

const BASE = {
	...get(configStore),
	edgeZoomControlMode: false,
	zoomState: 'rand',
	zoomEngagement: 1.0,
	abstraction: 0.0,
	zoomLevel: 0.5,
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

test('Wechsel nach "gleichmaessig" animiert abstraction->1, laesst engagement unveraendert', async () => {
	configStore.set({ ...BASE, zoomEngagement: 0.3, abstraction: 0 });
	configStore.update((c) => ({ ...c, edgeZoomControlMode: true, zoomState: 'gleichmaessig' }));

	await waitUntil(() => Math.abs(get(configStore).abstraction - 1) < 0.01);
	// engagement wurde von diesem Zustand nicht angefasst.
	expect(get(configStore).zoomEngagement).toBeCloseTo(0.3, 1);
}, 10000);

test('Wechsel nach "flaechentreu" animiert engagement->0 UND abstraction->0', async () => {
	configStore.set({
		...BASE,
		edgeZoomControlMode: true,
		zoomState: 'gleichmaessig',
		zoomEngagement: 1,
		abstraction: 1,
	});
	configStore.update((c) => ({ ...c, zoomState: 'flaechentreu' }));

	await waitUntil(() => {
		let c = get(configStore);
		return Math.abs(c.zoomEngagement) < 0.01 && Math.abs(c.abstraction) < 0.01;
	});
}, 10000);

test('Wechsel nach "rand" animiert engagement->1, abstraction->0', async () => {
	configStore.set({
		...BASE,
		edgeZoomControlMode: true,
		zoomState: 'flaechentreu',
		zoomEngagement: 0,
		abstraction: 0,
	});
	configStore.update((c) => ({ ...c, zoomState: 'rand' }));

	await waitUntil(() => {
		let c = get(configStore);
		return Math.abs(c.zoomEngagement - 1) < 0.01 && Math.abs(c.abstraction) < 0.01;
	});
}, 10000);

test('zoomLevel wird vom Treiber nie angefasst', async () => {
	configStore.set({ ...BASE, edgeZoomControlMode: true, zoomState: 'rand', zoomLevel: 0.73 });
	configStore.update((c) => ({ ...c, zoomState: 'gleichmaessig' }));
	await new Promise((r) => setTimeout(r, 200));
	expect(get(configStore).zoomLevel).toBe(0.73);
	configStore.update((c) => ({ ...c, zoomState: 'flaechentreu' }));
	await new Promise((r) => setTimeout(r, 500));
	expect(get(configStore).zoomLevel).toBe(0.73);
});

test('edgeZoomControlMode=false stoppt weitere automatische Updates', async () => {
	configStore.set({
		...BASE,
		edgeZoomControlMode: true,
		zoomState: 'gleichmaessig',
		zoomEngagement: 1,
		abstraction: 0,
	});
	// Übergang anstoßen, aber NICHT bis zum Ende warten.
	await new Promise((r) => setTimeout(r, 100));
	configStore.update((c) => ({ ...c, edgeZoomControlMode: false }));
	let frozen = get(configStore).abstraction;
	await new Promise((r) => setTimeout(r, 300));
	expect(get(configStore).abstraction).toBe(frozen);
}, 10000);
