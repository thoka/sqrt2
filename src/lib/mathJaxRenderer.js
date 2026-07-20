// mathJaxRenderer.js — rendert LaTeX-Ausdrücke über ECHTES MathJax
// (@mathjax/src, SVG-Output) zu einem eigenständigen SVG-String. NUR für
// die Achsen-Beschriftung (endliche, kleine Menge an Ausdrücken pro
// Konfiguration, siehe mathJaxLabelCache.js) - NICHT für die Zahlentafel
// (HUD): dort ändert sich der Wert bei JEDEM Frame, ein Cache hilft nichts,
// dafür bleibt src/lib/mathCanvasRenderer.js (eigener, MathJax-freier
// Renderer) zuständig.
//
// WICHTIG: dieses Modul wird NUR dynamisch importiert (`await
// import('./mathJaxRenderer.js')` in mathJaxLabelCache.js), NIE statisch -
// @mathjax/src ist mehrere hundert KB (minifiziert), ein statischer Import
// hätte das ins Haupt-Bundle gezogen und JEDEN Seitenaufruf verlangsamt,
// auch wenn "Beschriftung" nie eingeschaltet wird. Dynamischer Import lässt
// Vite das automatisch in einen eigenen, separat ladbaren Chunk aufteilen -
// geladen nur bei einem echten Cache-Miss (siehe mathJaxLabelCache.js: auch
// ein IndexedDB-Treffer zählt als Treffer, lädt dieses Modul NICHT).
//
// MathJax selbst läuft NUR bei einem Cache-Miss (neuer, noch nie gezeigter
// Ausdruck) - siehe docs/Beschriftung.md Diskussion: "Es spricht nichts
// gegen die Nutzung von MathJax außer Performance. Wenn Caching ausreicht,
// ist das der einfachere Weg." Kein Fallback-Renderer während MathJax noch
// lädt - der Aufrufer wartet einfach (siehe mathJaxLabelCache.js).
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { browserAdaptor } from '@mathjax/src/js/adaptors/browserAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
// Nur das 'base'-Paket wird gebraucht (Brueche \frac, Hoch-/Tiefstellung
// ^/_, \left\right-Klammern) - kein AllPackages-Bundle (ab @mathjax/src v4
// nicht mehr als einzelnes Modul exportiert, sondern Teil des separaten
// "components"-Systems). Seiteneffekt-Import registriert das Paket beim
// gemeinsamen Configuration-Handler (siehe MathJax-Doku "Direct and
// Indirect component-less usage").
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';

let mjDocument = null;

function ensureDocument() {
	if (mjDocument) return mjDocument;
	RegisterHTMLHandler(browserAdaptor());
	const texInput = new TeX({ packages: ['base'] });
	// fontCache:'none' - JEDES SVG traegt seine Pfade vollstaendig selbst
	// (keine <use>-Referenz auf ein gemeinsames, Dokument-weites <defs>) -
	// noetig, weil wir einzelne SVGs ISOLIERT (als eigenstaendige Bilder,
	// losgeloest vom Dokument, auch aus IndexedDB wiederhergestellt)
	// weiterverwenden.
	const svgOutput = new SVG({ fontCache: 'none' });
	mjDocument = mathjax.document(document, { InputJax: texInput, OutputJax: svgOutput });
	return mjDocument;
}

// Rendert `tex` (LaTeX-Quelle) zu einem eigenstaendigen SVG-String (inkl.
// `width`/`height`-Attributen in MathJax' "ex"-Einheit - siehe
// mathJaxSvgImage.js svgStringToImage()). Reiner Rechenschritt, kein
// Bild-Laden (das uebernimmt svgStringToImage(), absichtlich getrennt -
// siehe dortige Moduldoku).
export function renderTexToSvgString(tex) {
	const doc = ensureDocument();
	const node = doc.convert(tex, { display: false });
	const svgEl = node.querySelector('svg');
	if (!svgEl) throw new Error(`MathJax lieferte kein <svg> fuer: ${tex}`);
	return new XMLSerializer().serializeToString(svgEl);
}
