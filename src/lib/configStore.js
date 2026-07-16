// configStore/playbackStore als eigene Module (TOOLING_SPEC.md Phase 2),
// separat von stores.js, damit der asynchrone Compile-Orchestrator
// configStore importieren kann, OHNE dass ein zirkulärer Import entsteht
// (stores.js re-exportiert den Orchestrator, der wieder configStore braucht).
import { writable } from 'svelte/store';

// Default-Werte gespiegelt aus den `value`-Attributen der bisherigen
// Inputs in sqrt2.html - keine Verhaltensänderung, nur eine zweite
// Quelle für denselben Startzustand.
export const configStore = writable({
	base: 10,
	depth: 16,
	transformMode: 'S',
	bankZoomThresholdPowers: 0,
	autoZoomMinPx: 3,
	zoomSpeedCoef: 0.012,
	compactionEnabled: false,
	compactionTransitionTicks: 3,
	lineWidth: 0.3,
	pauseDuration: 1.5,
	playSpeed: 2.0,
	modeAB: 0.0,
});

export const playbackStore = writable({
	time: 0.0,
	isPlaying: false,
	direction: 1,
});
