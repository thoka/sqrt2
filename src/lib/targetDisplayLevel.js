import { writable } from 'svelte/store';

// targetDisplayLevel.js - gemeinsame Log-Abbildung fuer die
// Ziel-Darstellung-"Staerke" (die Mindestpixelgroesse, ab der eine
// Ziffernstelle als gerade noch lesbar gilt). Wahrnehmung von
// Groessen-Schwellwerten folgt Verhaeltnissen, nicht Differenzen
// (Weber-Fechner), daher eine Log-Skala. EINE Quelle fuer diese
// Abbildung, genutzt von ControlPanel.svelte (Regler-Anzeige) UND
// TargetBankCanvas.svelte (Render-Berechnung) - siehe docs/Alternative
// Ziel-Darstellung-Steuerung.md fuer die Entwurfsdiskussion.
//
// "level" braucht KEINEN Sonderfall fuer 0 (das deckt configStore.
// targetDisplayEngagement ab, siehe dort) - die feste Untergrenze hier
// ist daher bewusst 1px (nicht kleiner sinnvoll unterscheidbar), keine
// Notwendigkeit fuer Sub-Pixel-Werte mehr.
//
// Die OBERGRENZE ist NICHT fest (frueher TARGET_DISPLAY_LEVEL_HI_PX=100px),
// sondern die tatsaechlich maximal erreichbare Breite (bei vollem Zoom,
// t_AB=1) fuer die aktuelle Konfiguration/Fenstergroesse - siehe
// `maxTargetDisplayWidthPx()` in TargetBankCanvas.svelte. Ein fester
// Deckel erzeugte zwei Bugs (siehe docs/Alternative
// Ziel-Darstellung-Steuerung.md): einen TOTEN Regelbereich (Deckel liegt
// bei vielen Schalen weit UNTER dem tatsaechlichen Maximum) und eine
// unzureichende Gleichmaessigkeit bei wenigen Schalen (Deckel liegt dort
// weit DARUEBER, der Regler erreicht t_AB=1 nie exakt). Der Maximalwert
// haengt NICHT von der Animationszeit ab (nur von Basis/Tiefe/
// Fenstergroesse) - bleibt daher waehrend einer laufenden Wiedergabe
// stabil (C1/monoton "geschenkt", siehe Kopfkommentar in
// TargetBankCanvas.svelte).
export const TARGET_DISPLAY_LEVEL_MIN_PX = 1;

// Fallback-Maximalwert, BEVOR der erste Frame gerendert wurde (Canvas noch
// nicht gemountet) - beliebiger, aber sinnvoll grosser Platzhalter, damit
// ControlPanel vor dem ersten renderFrame() keinen NaN/Infinity anzeigt.
const FALLBACK_MAX_PX = 100;

// Von TargetBankCanvas.svelte pro Frame aktualisiert (nur bei tatsaechlicher
// Aenderung geschrieben - siehe maxTargetDisplayWidthPx()/renderFrame() dort,
// kein Store-Churn bei jedem Frame), von ControlPanel.svelte gelesen (fuer
// das px-Readout des "Ziel-Darstellung: Staerke"-Reglers).
export const targetDisplayMaxPxStore = writable(FALLBACK_MAX_PX);

// level (0..1) -> Pixel (log-skaliert zwischen MIN_PX und maxPx).
export function levelToPx(level, maxPx = FALLBACK_MAX_PX) {
	let hi = Math.max(maxPx, TARGET_DISPLAY_LEVEL_MIN_PX * 1.001);
	let span = Math.log(hi / TARGET_DISPLAY_LEVEL_MIN_PX);
	return TARGET_DISPLAY_LEVEL_MIN_PX * Math.exp(level * span);
}

// Pixel -> level (0..1), geklemmt - Umkehrfunktion von levelToPx().
export function pxToLevel(px, maxPx = FALLBACK_MAX_PX) {
	let hi = Math.max(maxPx, TARGET_DISPLAY_LEVEL_MIN_PX * 1.001);
	let span = Math.log(hi / TARGET_DISPLAY_LEVEL_MIN_PX);
	return Math.max(
		0,
		Math.min(
			1,
			Math.log(Math.max(TARGET_DISPLAY_LEVEL_MIN_PX, px) / TARGET_DISPLAY_LEVEL_MIN_PX) / span,
		),
	);
}
