// mathJaxLabelCache.js — Orchestriert MathJax-Rendering (mathJaxRenderer.js)
// + persistenten Cache (mathJaxImageCache.js) für die Achsen-Beschriftung.
// Zwei Cache-Ebenen:
//   1. In-Memory (`memCache`, dieses Modul) - innerhalb einer Sitzung,
//      sofortiger synchroner Zugriff für den Render-Loop.
//   2. IndexedDB (mathJaxImageCache.js) - über Seiten-Reloads hinweg,
//      async befüllt beim ersten Rendern eines Ausdrucks.
//
// Kein Fallback-Renderer während MathJax noch lädt/rendert - der Aufrufer
// (TargetBankCanvas.svelte) prüft `getLabelImage()` (synchron, liefert null
// falls noch nicht bereit) und lässt das Label in diesem Frame einfach weg;
// `requestLabelImage()` stößt das Nachladen an, ein späterer Frame zeigt es
// dann. Siehe docs/Beschriftung.md: "Wir brauchen auch keinen
// Fallback-Renderer ... Solange warten wir einfach."
//
// `mathJaxRenderer.js` (das komplette MathJax-Modul, @mathjax/src - mehrere
// hundert KB) wird bewusst NUR dynamisch importiert, und zwar NUR bei einem
// echten Cache-Miss (auch die IndexedDB-Ebene zaehlt als Treffer) - beim
// "zweiten Aufruf der Seite" (docs/Beschriftung.md), wenn alle Beschriftungen
// schon in IndexedDB liegen, wird MathJax dadurch UEBERHAUPT NICHT geladen.
// svgStringToImage() selbst hat KEINE MathJax-Abhaengigkeit (eigenes,
// leichtgewichtiges Modul, siehe dortige Doku) und wird daher normal
// statisch importiert.
import { svgStringToImage } from './mathJaxSvgImage.js';
import { getPersistedSvg, putPersistedSvg } from './mathJaxImageCache.js';

const memCache = new Map(); // key -> { img, widthEx, heightEx }
const pending = new Set(); // keys, die gerade gerendert/geladen werden

// Synchron - liefert das gecachte Bild oder `null` (noch nicht bereit).
// NIEMALS selbst rendern/warten (siehe Moduldoku).
export function getLabelImage(key) {
	return memCache.get(key) || null;
}

// Stößt asynchron das Rendern (Cache-Miss) bzw. Laden (Cache-Hit, IndexedDB)
// an, falls `key` noch nicht im Speicher-Cache ist und nicht schon in
// Arbeit. Kein Rückgabewert zum Warten - der Aufrufer pollt `getLabelImage()`
// im nächsten Frame erneut. `onReady` (optional) wird aufgerufen, sobald das
// Bild verfügbar ist, damit ein gerade nicht animierender Canvas trotzdem
// einen Redraw bekommt.
export function requestLabelImage(key, tex, onReady) {
	if (memCache.has(key) || pending.has(key)) return;
	pending.add(key);
	(async () => {
		try {
			let svgString = await getPersistedSvg(key);
			let fresh = false;
			if (!svgString) {
				// Cache-Miss (weder Speicher- noch IndexedDB-Cache) - erst JETZT
				// das schwere MathJax-Modul nachladen (siehe Import-Kommentar
				// oben + mathJaxRenderer.js Moduldoku).
				const { renderTexToSvgString } = await import('./mathJaxRenderer.js');
				svgString = renderTexToSvgString(tex);
				fresh = true;
			}
			const entry = await svgStringToImage(svgString);
			memCache.set(key, entry);
			// Persistieren NACH dem Anzeigen anstossen (nicht blockierend) -
			// ein Schreibfehler (z.B. voller Speicher) darf die Anzeige nicht
			// verzoegern.
			if (fresh) putPersistedSvg(key, svgString);
		} catch (e) {
			console.error('[mathJaxLabelCache] Rendern fehlgeschlagen für', key, tex, e);
		} finally {
			pending.delete(key);
			onReady?.();
		}
	})();
}
