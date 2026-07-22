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
	zoomSpeedCoef: 0.012,
	compactionEnabled: false,
	compactionTransitionTicks: 3,
	lineWidth: 0.3,
	pauseDuration: 1.5,
	playSpeed: 2.0,
	// Ziel-Darstellung: Aktivierung (linear, 0=aus/1=an) + Staerke
	// (log-skaliert ueber levelToPx(), siehe targetDisplayLevel.js) -
	// ersetzt das fruehere Regler-Paar modeAB/autoZoomMinPx (siehe
	// docs/Alternative Ziel-Darstellung-Steuerung.md). Die resultierende
	// Basisverzerrung ("modeAB") ist damit KEIN eigenstaendiges Store-Feld
	// mehr, sondern wird in TargetBankCanvas.svelte JEDEN Frame aus
	// diesen beiden Werten berechnet.
	targetDisplayEngagement: 1.0,
	// targetDisplayLevel bezieht sich auf eine dynamische Ober-/Untergrenze
	// (1px .. tatsaechlich maximal erreichbare Breite, siehe
	// targetDisplayLevel.js/ maxTargetDisplayWidthPx() in
	// TargetBankCanvas.svelte) - ein fester px-Default ergibt daher keinen
	// Sinn mehr, stattdessen ein neutraler mittlerer Regler-Default.
	targetDisplayLevel: 0.5,
	// Abstraktion: manueller, von Ziel-Darstellung UNABHAENGIGER Regler,
	// der die Basisverzerrung Richtung 1 erzwingt ("Modus B" aus dem
	// urspruenglichen README - macht die Stellenwert-Struktur sichtbar),
	// unabhaengig davon, ob das fuer die Lesbarkeit noetig waere.
	// Kombiniert sich mit dem Ziel-Darstellung-Ergebnis per max() in
	// TargetBankCanvas.svelte - linearer Regler bewusst ohne Formkurve
	// (siehe docs/Alternative Ziel-Darstellung-Steuerung.md: erst am
	// Regler pruefen, ob eine Kurve noetig ist).
	abstraction: 0.0,

	// Alternative Rand-Ziel-Darstellung-Steuerung (siehe docs/Alternative
	// Ziel-Darstellung-Steuerung.md "Schalter-Tweening"): statt der drei
	// einzelnen Regler (Aktivierung/Abstraktion; targetDisplayLevel bleibt
	// unabhaengig davon immer als Regler sichtbar) nur 3 diskrete
	// Zustaende zur Auswahl, weich animiert beim Wechsel (src/lib/
	// targetDisplayStateTween.js). Jetzt DEFAULT AN (TODO.md "Steuerung":
	// "neue Umschaltung über Zustände zum Default machen") - die
	// klassischen 2(+1)-Regler bleiben ueber die Admin-Checkbox weiterhin
	// erreichbar.
	edgeTargetDisplayControlMode: true,
	// 'flaechentreu' | 'rand' | 'gleichmaessig' - nur wirksam, wenn
	// edgeTargetDisplayControlMode true ist.
	targetDisplayState: 'rand',
	// Dauer (Sekunden) fuer einen KOMPLETTEN Uebergang zwischen 2 Zustaenden
	// (src/lib/targetDisplayStateTween.js) - Regler "Zustands-Übergang:
	// Dauer" im Animation-Tab, Bereich 0..10s. Uebergaenge duerfen ruhig
	// lange dauern (User-Klarstellung) - "ersichtlicher, wann der neue
	// Zustand erreicht wurde" wird stattdessen durch den abrupten,
	// mechanischen Stopp des Trapez-Geschwindigkeitsprofils (trapStep() in
	// targetDisplayStateTween.js) erreicht, nicht durch eine kuerzere Dauer.
	targetDisplayStateTransitionDuration: 1.0,
	// Flug-Morph: Teile drehen (true) oder nur strecken (false)
	flightRotation: true,
	// Transparenz fliegender Stücke (0 = unsichtbar, 1 = deckend)
	flyingAlpha: 0.59,
	// Ab dieser Wiedergabe-Geschwindigkeit (playSpeed) wird die Flug-Animation
	// (Bank -> Ziel) abgeschaltet - Stücke erscheinen dann direkt an ihrer
	// Zielposition statt sichtbar zu fliegen (bei hoher Geschwindigkeit ist
	// der Flug ohnehin nicht mehr wahrnehmbar, nur noch ein Ruckeln).
	flightAnimSpeedThreshold: 3.0,
	// Beschriftung der Ziel-Quadrate (Formel unten / ausgerechneter Wert links)
	showLabels: false,
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
