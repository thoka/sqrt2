// configStore/playbackStore als eigene Module (TOOLING_SPEC.md Phase 2),
// separat von stores.js, damit der asynchrone Compile-Orchestrator
// configStore importieren kann, OHNE dass ein zirkulärer Import entsteht
// (stores.js re-exportiert den Orchestrator, der wieder configStore braucht).
import { writable } from 'svelte/store';
import { parseConfigFromUrl } from './urlState.js';

// Default-Werte gespiegelt aus den `value`-Attributen der bisherigen
// Inputs in sqrt2.html - keine Verhaltensänderung, nur eine zweite
// Quelle für denselben Startzustand.
const DEFAULTS = {
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
	// Flug-Morph: wie stark Drehung der Streckung vorgezogen wird (0 = rein
	// strecken, 1 = max. Drehung wo sinnvoll). Laufzeit-Feld, kein Recompile.
	morphRotWeight: 0.5,
	// Diagnose-Schalter (Stotter-Untersuchung): entkoppeln HUD-/Bank-
	// Update vom Render-Loop, um die Flug-Stotter-Quelle zu isolieren.
	hudUpdateEnabled: true, // Zahlendarstellung (l/l²/R) neu berechnen/typsetten
	bankRenderEnabled: true, // Bank-Canvas (inkl. Flug-Animation) neu zeichnen
};

// URL-Parameter bereits beim Modul-Import auswerten (top-level, BEVOR der
// erste Compile in compileOrchestrator.js startet). Das macht ?base=… &
// Co. browser-unabhängig wirksam - unabhängig davon, ob/zu welchem
// Zeitpunkt App.svelte.onMount feuert (z.B. Firefox-BFCache-Restore,
// bei dem onMount evtl. nicht neu läuft, sodass der spät gesetzte
// URL-Override den bereits laufenden Default-Compile nicht mehr
// überholt). Guarded für Node/SSR (kein window/location).
function initialConfig() {
	if (typeof window === 'undefined' || !window.location) return { ...DEFAULTS };
	try {
		const params = new URLSearchParams(window.location.search);
		return { ...DEFAULTS, ...parseConfigFromUrl(params) };
	} catch {
		return { ...DEFAULTS };
	}
}

export const configStore = writable(initialConfig());

export const playbackStore = writable({
	time: 0.0,
	isPlaying: false,
	direction: 1,
});
