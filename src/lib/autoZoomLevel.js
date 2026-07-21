import { writable } from 'svelte/store';

// autoZoomLevel.js - gemeinsame Log-Abbildung fuer die Auto-Zoom-"Staerke"
// (die Mindestpixelgroesse, ab der eine Ziffernstelle als gerade noch
// lesbar gilt). Wahrnehmung von Groessen-Schwellwerten folgt Verhaeltnissen,
// nicht Differenzen (Weber-Fechner), daher eine Log-Skala. EINE Quelle fuer
// diese Abbildung, genutzt von ControlPanel.svelte (Regler-Anzeige) UND
// TargetBankCanvas.svelte (Render-Berechnung) - siehe docs/Alternative
// Zoom-Steuerung,md fuer die Entwurfsdiskussion.
//
// "level" braucht KEINEN Sonderfall fuer 0 (das deckt configStore.
// zoomEngagement ab, siehe dort) - die feste Untergrenze hier ist daher
// bewusst 1px (nicht kleiner sinnvoll unterscheidbar), keine Notwendigkeit
// fuer Sub-Pixel-Werte mehr.
//
// Die OBERGRENZE ist NICHT fest (frueher AUTO_ZOOM_LEVEL_HI_PX=100px),
// sondern die tatsaechlich maximal erreichbare Breite (bei vollem Zoom,
// t_AB=1) fuer die aktuelle Konfiguration/Fenstergroesse - siehe
// `maxAutoZoomWidthPx()` in TargetBankCanvas.svelte. Ein fester Deckel
// erzeugte zwei Bugs (siehe docs/Alternative Zoom-Steuerung,md): einen
// TOTEN Regelbereich (Deckel liegt bei vielen Schalen weit UNTER dem
// tatsaechlichen Maximum) und eine unzureichende Gleichmaessigkeit bei
// wenigen Schalen (Deckel liegt dort weit DARUEBER, der Regler erreicht
// t_AB=1 nie exakt). Der Maximalwert haengt NICHT von der Animationszeit
// ab (nur von Basis/Tiefe/Fenstergroesse) - bleibt daher waehrend einer
// laufenden Wiedergabe stabil (C1/monoton "geschenkt", siehe Kopfkommentar
// in TargetBankCanvas.svelte).
export const AUTO_ZOOM_LEVEL_MIN_PX = 1;

// Fallback-Maximalwert, BEVOR der erste Frame gerendert wurde (Canvas noch
// nicht gemountet) - beliebiger, aber sinnvoll grosser Platzhalter, damit
// ControlPanel vor dem ersten renderFrame() keinen NaN/Infinity anzeigt.
const FALLBACK_MAX_PX = 100;

// Von TargetBankCanvas.svelte pro Frame aktualisiert (nur bei tatsaechlicher
// Aenderung geschrieben - siehe maxAutoZoomWidthPx()/renderFrame() dort,
// kein Store-Churn bei jedem Frame), von ControlPanel.svelte gelesen (fuer
// das px-Readout des "Auto-Zoom: Staerke"-Reglers).
export const autoZoomMaxPxStore = writable(FALLBACK_MAX_PX);

// level (0..1) -> Pixel (log-skaliert zwischen MIN_PX und maxPx).
export function levelToPx(level, maxPx = FALLBACK_MAX_PX) {
	let hi = Math.max(maxPx, AUTO_ZOOM_LEVEL_MIN_PX * 1.001);
	let span = Math.log(hi / AUTO_ZOOM_LEVEL_MIN_PX);
	return AUTO_ZOOM_LEVEL_MIN_PX * Math.exp(level * span);
}

// Pixel -> level (0..1), geklemmt - Umkehrfunktion von levelToPx().
export function pxToLevel(px, maxPx = FALLBACK_MAX_PX) {
	let hi = Math.max(maxPx, AUTO_ZOOM_LEVEL_MIN_PX * 1.001);
	let span = Math.log(hi / AUTO_ZOOM_LEVEL_MIN_PX);
	return Math.max(
		0,
		Math.min(1, Math.log(Math.max(AUTO_ZOOM_LEVEL_MIN_PX, px) / AUTO_ZOOM_LEVEL_MIN_PX) / span),
	);
}
