// Persistente Tests für src/lib/stores.js (TOOLING_SPEC.md Phase 2) -
// laufen via `pnpm test` (node:test). svelte/store ist reines JS ohne
// Kompilierschritt, daher hier direkt testbar wie jedes andere Modul -
// kein vitest/jsdom nötig (das ist nur für *.svelte-Komponenten reserviert,
// siehe CLAUDE.md "Svelte-Komponenten-Tests").
//
// HINWEIS: seit ASYNC-COMPILE-PLAN ist compiledStore asynchron (Worker /
// Fallback in compileOrchestrator.js). In node (kein Worker) liefert der
// synchrony Fallback bei runCompile() sofort ein Ergebnis - daher starten
// wir hier einen Compile und warten auf den Store, statt get() direkt zu
// erwarten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { configStore, playbackStore, compiledStore, runCompile } from '../../src/lib/stores.js';

// Wartet, bis compiledStore ein Ergebnis hält (asynchroner Fallback in node).
async function waitForCompiled() {
	if (get(compiledStore)) return get(compiledStore);
	await new Promise((resolve) => {
		const unsub = compiledStore.subscribe((c) => {
			if (c) {
				unsub();
				resolve(c);
			}
		});
	});
	return get(compiledStore);
}

test('compiledStore liefert nach Compile ein gültiges Ergebnis', async () => {
	configStore.set({
		base: 10,
		depth: 3,
		transformMode: 'S',
		bankZoomThresholdPowers: 0,
		zoomSpeedCoef: 0.012,
		compactionEnabled: false,
		compactionTransitionTicks: 3,
	});
	runCompile();
	let r1 = await waitForCompiled();
	assert.ok(r1.TOTAL_STEPS > 0);
	assert.strictEqual(r1.bank_pieces.length > 0, true);
});

test('compiledStore reagiert auf configStore-Änderungen (asynchron)', async () => {
	configStore.set({
		base: 10,
		depth: 3,
		transformMode: 'S',
		bankZoomThresholdPowers: 0,
		zoomSpeedCoef: 0.012,
		compactionEnabled: false,
		compactionTransitionTicks: 3,
	});
	runCompile();
	let before = await waitForCompiled();
	configStore.update((c) => ({ ...c, depth: before.axes[before.axes.length - 1].exp + 2 }));
	runCompile();
	let after = await waitForCompiled();
	assert.notStrictEqual(before.TOTAL_STEPS, after.TOTAL_STEPS);
	// Aufräumen: Default wiederherstellen.
	configStore.set({
		base: 10,
		depth: 16,
		transformMode: 'S',
		bankZoomThresholdPowers: 0,
		zoomSpeedCoef: 0.012,
		compactionEnabled: false,
		compactionTransitionTicks: 3,
	});
	runCompile();
	await waitForCompiled();
});

test('compiledStore bleibt bei unveränderten Nicht-Compile-Feldern (z.B. targetDisplayLevel) unverändert', async () => {
	configStore.set({
		base: 10,
		depth: 3,
		transformMode: 'S',
		bankZoomThresholdPowers: 0,
		zoomSpeedCoef: 0.012,
		compactionEnabled: false,
		compactionTransitionTicks: 3,
	});
	runCompile();
	let before = await waitForCompiled();
	configStore.update((c) => ({ ...c, targetDisplayLevel: 0.75 }));
	runCompile();
	let after = await waitForCompiled();
	assert.strictEqual(before.TOTAL_STEPS, after.TOTAL_STEPS);
	assert.strictEqual(before.MAX_TIME, after.MAX_TIME);
	configStore.update((c) => ({ ...c, targetDisplayLevel: 0.0 }));
});

test('playbackStore ist von configStore/compiledStore unabhängig (eigene Schicht, siehe Spec 3.1)', async () => {
	configStore.set({
		base: 10,
		depth: 3,
		transformMode: 'S',
		bankZoomThresholdPowers: 0,
		zoomSpeedCoef: 0.012,
		compactionEnabled: false,
		compactionTransitionTicks: 3,
	});
	runCompile();
	let compiledBefore = await waitForCompiled();
	playbackStore.update((p) => ({ ...p, time: 5, isPlaying: true, direction: -1 }));
	assert.deepStrictEqual(get(playbackStore), { time: 5, isPlaying: true, direction: -1 });
	assert.strictEqual(get(compiledStore).TOTAL_STEPS, compiledBefore.TOTAL_STEPS);
	assert.strictEqual(get(compiledStore).MAX_TIME, compiledBefore.MAX_TIME);
	playbackStore.set({ time: 0, isPlaying: false, direction: 1 });
});
