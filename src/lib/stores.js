// Zustands-Stores (TOOLING_SPEC.md Phase 2). Drei Schichten nach
// Änderungsfrequenz/Reichweite getrennt (siehe Spec Abschnitt 3.1):
// configStore/playbackStore sind die künftig fensterübergreifend
// synchronisierten Stores (BroadcastChannel-Adapter folgt in Phase 5,
// hier bewusst noch nicht angebunden); compiledStore ist rein lokal
// abgeleitet, NIE über einen Transport übertragen (siehe Spec: das Neu-
// Berechnen aus dem kleinen configStore ist schnell/deterministisch,
// die Übertragung der riesigen bank_pieces-Ergebnisse wäre es nicht).
import { writable, derived } from 'svelte/store';
import { compileSystem } from './compiler.js';

// Default-Werte gespiegelt aus den `value`-Attributen der bisherigen
// Inputs in sqrt2.html - keine Verhaltensänderung, nur eine zweite
// Quelle für denselben Startzustand (der DOM-Adapter in sqrt2.html
// bleibt in Phase 2 unverändert, siehe Spec-Tabelle Phase 2 "noch keine
// UI-Änderung").
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

// derived statt eines manuell verdrahteten subscribe(): läuft automatisch
// bei jeder configStore-Änderung neu, genau wie das bisherige
// compileSystem()-nach-Input-Change in sqrt2.html - nur deklarativ statt
// über verstreute addEventListener-Aufrufe (siehe Spec Abschnitt 3.1,
// "reiner, deterministischer, schneller Funktionsaufruf").
export const compiledStore = derived(configStore, ($config) => compileSystem($config));
