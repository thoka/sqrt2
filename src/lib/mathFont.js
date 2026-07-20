// mathFont.js — bindet MathJax' eigenen CHTML-Font ein (siehe
// src/assets/fonts/NOTICE.md, docs/MATHJAX_METRICS.md "MathJax-Fonts"),
// damit `mathCanvasRenderer.js` echte MathJax-Glyphen zeichnet (Ziffern,
// Klammern, Schrägstrich) statt einer System-Monospace-Näherung - behebt
// insbesondere "Klammern viel zu fett" (docs/Beschriftung.md): MathJax'
// eigene Klammer-Glyphe ist deutlich schlanker als die der meisten
// System-Monospace-Fonts bei gleicher Schriftgröße.
//
// NUR die "Main"-Schriftdatei (Ziffern/Klammern/Schrägstrich/lateinische
// Buchstaben) wird gebraucht - nicht das komplette MathJax-Font-Set.
// Lokal gebündelt (nicht von der CDN geladen): das Exponat läuft ohne
// verlässliche Internetverbindung, siehe NOTICE.md.
import fontUrl from '../assets/fonts/MathJax_Main-Regular.woff?url';

export const MATH_FONT_FAMILY = 'MJXMain';
// Fallback-Kette: solange der Font noch laedt (oder im (in diesem Projekt
// nie genutzten) Fall eines Browsers ohne FontFace-API) wird die normale
// System-Monospace-Schrift verwendet - sieht etwas anders aus, ist aber nie
// unlesbar/leer.
export const MATH_FONT_STACK = `${MATH_FONT_FAMILY}, ui-monospace, monospace`;

let loadPromise = null;

// Laedt den Font EINMALIG (weitere Aufrufe liefern dieselbe Promise) und
// registriert ihn in `document.fonts`. Canvas-`ctx.font` mit `MATH_FONT_STACK`
// nutzt ihn automatisch, sobald geladen - kein weiterer Umbau am Renderer
// noetig, nur der naechste Zeichen-Aufruf (naechster Frame) greift dann.
export function ensureMathFont() {
	if (loadPromise) return loadPromise;
	if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
		return (loadPromise = Promise.resolve(false));
	}
	const face = new FontFace(MATH_FONT_FAMILY, `url(${fontUrl})`);
	loadPromise = face
		.load()
		.then((loaded) => {
			document.fonts.add(loaded);
			return true;
		})
		.catch(() => false);
	return loadPromise;
}
