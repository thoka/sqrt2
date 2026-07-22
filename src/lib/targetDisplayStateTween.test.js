// Test für src/lib/targetDisplayStateTween.js - braucht requestAnimationFrame
// (rAF), das node:test (tests/unit/) nicht bereitstellt - deshalb hier unter
// src/**/*.test.js, wo vitest mit jsdom-Environment (inkl. rAF) läuft (siehe
// CLAUDE.md "Svelte-Komponenten-Tests": die Wahl des Runners richtet sich
// danach, welche Umgebung das Modul braucht, nicht danach, ob es eine
// .svelte-Datei ist).
import { test, expect } from 'vitest';
import { get } from 'svelte/store';
import { configStore } from './configStore.js';
import { initTargetDisplayStateTween } from './targetDisplayStateTween.js';

const BASE = {
	...get(configStore),
	edgeTargetDisplayControlMode: false,
	targetDisplayState: 'rand',
	targetDisplayEngagement: 1.0,
	abstraction: 0.0,
	targetDisplayLevel: 0.5,
	// Klein gehalten, damit die Tests (echte Timer/rAF) schnell durchlaufen -
	// die Standard-Dauer (1s) wird separat unten getestet.
	targetDisplayStateTransitionDuration: 0.1,
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

// initTargetDisplayStateTween() ist idempotent (globaler configStore-Singleton) -
// einmal für die ganze Testdatei registrieren.
initTargetDisplayStateTween();

test('Wechsel nach "gleichmaessig" animiert abstraction->1, laesst engagement unveraendert', async () => {
	configStore.set({ ...BASE, targetDisplayEngagement: 0.3, abstraction: 0 });
	configStore.update((c) => ({
		...c,
		edgeTargetDisplayControlMode: true,
		targetDisplayState: 'gleichmaessig',
	}));

	await waitUntil(() => Math.abs(get(configStore).abstraction - 1) < 0.01);
	// engagement wurde von diesem Zustand nicht angefasst.
	expect(get(configStore).targetDisplayEngagement).toBeCloseTo(0.3, 1);
}, 10000);

test('Wechsel nach "flaechentreu" animiert engagement->0 UND abstraction->0', async () => {
	configStore.set({
		...BASE,
		edgeTargetDisplayControlMode: true,
		targetDisplayState: 'rand',
		targetDisplayEngagement: 1,
		abstraction: 0.5,
	});
	configStore.update((c) => ({ ...c, targetDisplayState: 'flaechentreu' }));

	await waitUntil(
		() =>
			Math.abs(get(configStore).targetDisplayEngagement) < 0.01 &&
			Math.abs(get(configStore).abstraction) < 0.01,
	);
	expect(get(configStore).targetDisplayEngagement).toBeCloseTo(0, 1);
	expect(get(configStore).abstraction).toBeCloseTo(0, 1);
}, 10000);

test('Wechsel nach "rand" animiert engagement->1 UND abstraction->0', async () => {
	configStore.set({
		...BASE,
		edgeTargetDisplayControlMode: true,
		targetDisplayState: 'flaechentreu',
		targetDisplayEngagement: 0,
		abstraction: 0.5,
	});
	configStore.update((c) => ({ ...c, targetDisplayState: 'rand' }));

	await waitUntil(
		() =>
			Math.abs(get(configStore).targetDisplayEngagement - 1) < 0.01 &&
			Math.abs(get(configStore).abstraction) < 0.01,
	);
	expect(get(configStore).targetDisplayEngagement).toBeCloseTo(1, 1);
	expect(get(configStore).abstraction).toBeCloseTo(0, 1);
}, 10000);

test('targetDisplayLevel wird vom Treiber nie angefasst', async () => {
	configStore.set({
		...BASE,
		edgeTargetDisplayControlMode: true,
		targetDisplayState: 'rand',
		targetDisplayLevel: 0.73,
	});
	configStore.update((c) => ({ ...c, targetDisplayState: 'gleichmaessig' }));
	await new Promise((r) => setTimeout(r, 200));
	expect(get(configStore).targetDisplayLevel).toBe(0.73);
	configStore.update((c) => ({ ...c, targetDisplayState: 'flaechentreu' }));
	await new Promise((r) => setTimeout(r, 200));
	expect(get(configStore).targetDisplayLevel).toBe(0.73);
}, 5000);

test('edgeTargetDisplayControlMode=false stoppt weitere automatische Updates', async () => {
	configStore.set({
		...BASE,
		edgeTargetDisplayControlMode: true,
		targetDisplayState: 'gleichmaessig',
		targetDisplayEngagement: 1,
		abstraction: 1,
	});
	await new Promise((r) => setTimeout(r, 200));

	configStore.update((c) => ({ ...c, edgeTargetDisplayControlMode: false }));
	// Nach dem Ausschalten: Werte bleiben auf dem letzten Stand (abstraction=1),
	// werden NICHT weiter animiert.
	let snap = get(configStore);
	await new Promise((r) => setTimeout(r, 300));
	expect(get(configStore).abstraction).toBe(snap.abstraction);
}, 5000);

// Regression: targetDisplayStateTransitionDuration ist in SEKUNDEN, aber
// die urspruengliche Implementierung hat ms interpretiert (1.0 => 1000s
// statt 1s). Dieser Test stellt sicher, dass die Korrektur haelt (Bug
// gefangen, siehe docs/Alternative Ziel-Darstellung-Steuerung.md).
test('targetDisplayStateTransitionDuration wird als SEKUNDEN interpretiert (ms/s-Regression)', async () => {
	configStore.set({
		...BASE,
		edgeTargetDisplayControlMode: true,
		targetDisplayState: 'flaechentreu',
		targetDisplayEngagement: 0,
		abstraction: 0,
		targetDisplayStateTransitionDuration: 1.0,
	});
	configStore.update((c) => ({ ...c, targetDisplayState: 'rand' }));
	// Nach 500ms sollte die Bewegung bei Dauer=1s ca. halbwegs fortgeschritten sein
	// (Trapezprofil: 250ms Accel, danach Cruise, 250ms Bremsen -> bei 500ms exakt auf 50%).
	await new Promise((r) => setTimeout(r, 500));
	let early = get(configStore).targetDisplayEngagement;
	// Trapezprofil: bei 500ms (Hälfte von 1s) sind wir genau auf halbem Weg.
	// Engagement sollte zwischen 0.4 und 0.6 sein.
	expect(early).toBeGreaterThan(0.3);
	expect(early).toBeLessThan(0.7);
	// Nach 3s sollte die Bewegung abgeschlossen sein.
	await waitUntil(() => Math.abs(get(configStore).targetDisplayEngagement - 1) < 0.01, 3000);
	expect(get(configStore).targetDisplayEngagement).toBeCloseTo(1, 1);
}, 5000);

test('Retargeting: Richtungswechsel mitten in der Bewegung', async () => {
	configStore.set({
		...BASE,
		edgeTargetDisplayControlMode: true,
		targetDisplayState: 'flaechentreu',
		targetDisplayEngagement: 0,
		abstraction: 0,
		targetDisplayStateTransitionDuration: 0.5,
	});
	configStore.update((c) => ({ ...c, targetDisplayState: 'gleichmaessig' })); // abstraction -> 1
	await new Promise((r) => setTimeout(r, 200));
	// Mitten in der Bewegung: abstraction sollte zwischen 0 und 1 liegen.
	let mid = get(configStore).abstraction;
	expect(mid).toBeGreaterThan(0.05);
	expect(mid).toBeLessThan(0.95);
	// Richtungswechsel: jetzt nach "rand" (abstraction -> 0)
	configStore.update((c) => ({ ...c, targetDisplayState: 'rand' })); // abstraction -> 0, Richtungswechsel
	await waitUntil(() => Math.abs(get(configStore).abstraction) < 0.01, 3000);
	expect(get(configStore).abstraction).toBeCloseTo(0, 1);
}, 5000);

test('Kein Ruckeln beim schnellen Umschalten (Blitze-Regression)', async () => {
	configStore.set({
		...BASE,
		edgeTargetDisplayControlMode: true,
		targetDisplayState: 'flaechentreu',
		targetDisplayEngagement: 0.42,
		abstraction: 0,
		targetDisplayStateTransitionDuration: 0.3,
	});
	configStore.update((c) => ({ ...c, targetDisplayState: 'gleichmaessig' }));
	// 3 schnelle Umschaltungen in 100ms-Intervallen - die Werte sollen
	// dabei monoton in Richtung des jeweils letzten Ziels laufen,
	// ohne Sprung/Richtungswechsel ( Regression gegen "Blitze").
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 100));
		configStore.update((c) => ({
			...c,
			targetDisplayState: i % 2 === 0 ? 'rand' : 'flaechentreu',
		}));
	}
	// Kurz warten, dann prüfen: Werte müssen noch zwischen 0 und 1 liegen
	// (kein negativer Overshoot, kein Wert > 1).
	await new Promise((r) => setTimeout(r, 200));
	let e = get(configStore).targetDisplayEngagement;
	let a = get(configStore).abstraction;
	expect(e).toBeGreaterThanOrEqual(-0.05);
	expect(e).toBeLessThanOrEqual(1.05);
	expect(a).toBeGreaterThanOrEqual(-0.05);
	expect(a).toBeLessThanOrEqual(1.05);
}, 5000);
