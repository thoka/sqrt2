// autoZoomLevel.js - gemeinsame Log-Abbildung fuer die Auto-Zoom-"Staerke"
// (die Mindestpixelgroesse, ab der eine Ziffernstelle als gerade noch
// lesbar gilt). Eine Ziffernstelle kann ueber mehrere Groessenordnungen
// hinweg relevant werden (0.001px .. 100px) - Wahrnehmung von Groessen-
// Schwellwerten folgt Verhaeltnissen, nicht Differenzen (Weber-Fechner),
// daher eine Log-Skala. EINE Quelle fuer diese Abbildung, genutzt von
// ControlPanel.svelte (Regler-Anzeige) UND TargetBankCanvas.svelte
// (Render-Berechnung) - siehe docs/Alternative Zoom-Steuerung,md fuer die
// Entwurfsdiskussion (Zerlegung in engagement x level).
//
// "level" selbst braucht KEINEN Sonderfall fuer 0 mehr (anders als die
// fruehere autoZoomMinPx-Eingabe mit ihrem Snap-auf-0-am-linken-Anschlag):
// "ist Auto-Zoom ueberhaupt aktiv" ist eine eigene, lineare Groesse
// (configStore.zoomEngagement), diese Abbildung deckt nur noch "wie
// aggressiv, wenn aktiv" ab - ein reiner Log-Bereich ohne Null-Grenzfall.
export const AUTO_ZOOM_LEVEL_LO_PX = 0.001;
export const AUTO_ZOOM_LEVEL_HI_PX = 100;
const SPAN = Math.log(AUTO_ZOOM_LEVEL_HI_PX / AUTO_ZOOM_LEVEL_LO_PX);

// level (0..1) -> Pixel (log-skaliert).
export function levelToPx(level) {
	return AUTO_ZOOM_LEVEL_LO_PX * Math.exp(level * SPAN);
}

// Pixel -> level (0..1), geklemmt - Umkehrfunktion, z.B. um einen
// gewuenschten Default-Pixelwert in einen Store-Default umzurechnen.
export function pxToLevel(px) {
	return Math.max(
		0,
		Math.min(1, Math.log(Math.max(AUTO_ZOOM_LEVEL_LO_PX, px) / AUTO_ZOOM_LEVEL_LO_PX) / SPAN),
	);
}
