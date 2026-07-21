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
	// Klein gehalten, damit die Tests (echte Timer/rAF) schnell durchlaufen -
	// die Standard-Dauer (1s) wird separat unten getestet.
	zoomStateTransitionDuration: 0.1,
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

// Regression: zoomStateTransitionDuration ist in SEKUNDEN, aber
// requestAnimationFrame-Zeitstempel sind in MILLISEKUNDEN - ohne
// die ms->s-Umrechnung in tick() war der Uebergang nach < 1ms fertig,
// UNABHAENGIG vom Reglerwert (per manueller Browser-Messung gefunden -
// dieser Test allein haette den Bug unter jsdom NICHT zuverlaessig
// gefangen, siehe docs/Alternative Zoom-Steuerung,md).
test('zoomStateTransitionDuration wird als SEKUNDEN interpretiert (ms/s-Regression)', async () => {
	configStore.set({
		...BASE,
		edgeZoomControlMode: true,
		zoomState: 'flaechentreu',
		zoomEngagement: 0,
		abstraction: 0,
		zoomStateTransitionDuration: 1.0,
	});
	configStore.update((c) => ({ ...c, zoomState: 'rand' }));
	await new Promise((r) => setTimeout(r, 150));
	let early = get(configStore).zoomEngagement;
	expect(early).toBeGreaterThan(0); // Uebergang hat begonnen
	expect(early).toBeLessThan(0.5); // aber nach 150ms von 1000ms bei weitem nicht fertig
	await waitUntil(() => Math.abs(get(configStore).zoomEngagement - 1) < 0.01, 3000);
}, 10000);

// Regression: der erste Treiber (Ease-Ramp, bei Retargeting auf s=0
// zurueckgesetzt) erzeugte beim schnellen Umschalten sichtbare "Blitze"
// (User-Feedback) - Geschwindigkeit sprang bei jedem Retargeting auf 0.
// Der Geschwindigkeits-Integrator darf beim Umschalten MITTEN in einer
// Bewegung keinen abrupten Wert-Sprung zeigen (Wert bleibt C0-stetig,
// da "von" immer der aktuelle Live-Wert ist).
test('schnelles Umschalten (Retargeting mitten in der Bewegung) bleibt wertstetig', async () => {
	configStore.set({
		...BASE,
		edgeZoomControlMode: true,
		zoomState: 'flaechentreu',
		zoomEngagement: 0,
		abstraction: 0,
		zoomStateTransitionDuration: 0.5,
	});
	configStore.update((c) => ({ ...c, zoomState: 'gleichmaessig' })); // abstraction -> 1
	await new Promise((r) => setTimeout(r, 150)); // mitten in der Bewegung
	let valueBeforeRetarget = get(configStore).abstraction;
	expect(valueBeforeRetarget).toBeGreaterThan(0.01); // Bewegung ist tatsaechlich im Gange

	configStore.update((c) => ({ ...c, zoomState: 'rand' })); // abstraction -> 0, Richtungswechsel
	await new Promise((r) => setTimeout(r, 20)); // EIN winziger Schritt nach dem Retargeting
	let valueAfterRetarget = get(configStore).abstraction;
	// Kein Sprung: nach nur 20ms kann sich der Wert nur graduell aendern.
	expect(Math.abs(valueAfterRetarget - valueBeforeRetarget)).toBeLessThan(0.1);

	await waitUntil(() => Math.abs(get(configStore).abstraction) < 0.01, 3000);
}, 10000);
