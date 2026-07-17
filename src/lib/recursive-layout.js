// ============================================================================
// RECURSIVE-LAYOUT.JS - Teil D des REST-PRECISION-PLANs
// ============================================================================
// Rekursives Box-in-Boxes-Modell: ersetzt die zweistufige Architektur aus
// Teil C (computeCompactionWaypoints() vorberechnen, dann pro Frame per
// makeCompactedLogicalRectLookup() interpolieren) durch EINE reine, pro
// Frame neu ausgewertete Funktion von `t` - keine Wegpunkte, kein separater
// Ahnen-Walk (siehe relativePosition() in compiler.js, Teil B).
//
// bank_pieces (bank-core.js) ist bereits der Baum, den dieses Modell
// braucht: jeder Schnitt teilt einen Parent in genau BASE Kinder entlang
// EINER Achse (`piece.dir`, additiv in bank-core.js gesetzt). Zusätzlich
// additiv: `piece.te` (Zeitpunkt, ab dem ein Stück/Teilbaum vollständig
// verschwunden ist - bei Blättern beim Entnehmen eingefroren, bei geteilten
// Stücken bottom-up als max(te) der Kinder, siehe computeSubtreeTe() in
// bank-core.js).
//
// Zustandsmaschine pro Box, rein aus `t` abgeleitet:
//   t < born_time                          -> nicht gestartet, Größe 0.
//   t >= te                                -> beendet, Größe 0 (Pruning:
//                                              kein Abstieg in Kinder nötig,
//                                              te ist bereits das Maximum
//                                              über den ganzen Teilbaum).
//   hat Kinder UND t >= cut_time           -> geteilt: effektive Größe
//                                              rekursiv aus den Kindern
//                                              (Summe entlang `dir`, Maximum
//                                              quer dazu).
//   sonst (Blatt, oder geteilt aber        -> volle designte Größe, außer im
//   t < cut_time)                             3-Phasen-Exit eines bereits
//                                              entnommenen Blatts (siehe
//                                              leafEffectiveSize()).
// ============================================================================
import { smoothstep } from './smoothing.js';

// Blatt-Exit, 3 Phasen (User-Vorgabe, siehe REST-PRECISION-PLAN Teil D):
//   [taken_time, taken_time+delaySnapshot)  - designte Größe bleibt stehen
//                                              (Lücke sichtbar, keine
//                                              Kompaktierung).
//   [taken_time+delaySnapshot, te)          - C¹-Ease designte Größe -> 0
//                                              (smoothstep, Nullsteigung an
//                                              beiden Enden).
//   t >= te                                 - 0 (wird vom Aufrufer schon vor
//                                              dem Aufruf dieser Funktion
//                                              geprunt, siehe layoutBox()).
// Ein Stück, das NIE entnommen wurde (taken_time=Infinity), bleibt für immer
// bei designter Größe - das IST der sichtbare Rest.
function leafEffectiveSize(piece, t) {
	if (!isFinite(piece.taken_time) || t < piece.taken_time) {
		return { w: piece.w, h: piece.h };
	}
	let holdEnd = piece.taken_time + piece.delaySnapshot;
	if (t < holdEnd) return { w: piece.w, h: piece.h };
	// Math.max(..., 1e-9): defensiv gegen transitionSnapshot=0 (te===holdEnd)
	// - dieser Zweig wird dann ohnehin nie erreicht (t<holdEnd deckt schon
	// alles t<te ab), die Guard verhindert nur eine 0/0-Division in
	// exotischen Konfigurationen (Testkriterium "keine NaN/Infinity").
	let s = smoothstep((t - holdEnd) / Math.max(piece.te - holdEnd, 1e-9));
	return { w: piece.w * (1 - s), h: piece.h * (1 - s) };
}

// Top-down-Rekursion: der Abstieg IST der Walk (siehe Datei-Kopfkommentar).
// Liefert die effektive Größe + Moment/Masse dieses Teilbaums (lokale
// Einheitskoordinaten im Koordinatensystem des AUFRUFERS, `originX/Y` ist
// die vom Aufrufer vergebene Position dieser Box). `out`, wenn übergeben,
// sammelt {piece,x,y,w,h} für jede tatsächlich sichtbare (w>0 && h>0) Box -
// das sind entweder echte Blätter oder noch nicht geschnittene Stücke; eine
// GETEILTE, aktive Box selbst wird nie direkt gezeichnet, nur ihre Kinder.
// `stats`, wenn übergeben, zählt besuchte Knoten (stats.visited++) und
// sammelt optional deren id in stats.ids (falls als Set übergeben) - für den
// Pruning-Korrektheits-/Performance-Test (siehe recursive-layout.test.js).
// `hideFading` (default false): wenn true, werden Blätter in der Ease-Phase
// (siehe leafEffectiveSize() - NACH der Hold-Phase, während sie Richtung 0
// schrumpfen) NICHT in `out` aufgenommen - sie tragen weiterhin ihre
// (schrumpfende) Größe zur Positionierung der Geschwister bei (Kompaktierung
// bleibt wirksam), werden aber selbst nicht mehr gezeichnet. Gefunden im
// Gespräch: eine sichtbar schrumpfende Box wirkte wie ein Kompaktierungs-
// Fehler ("Teile fliegen/kompaktieren zu früh") - das eigentliche Schließen
// der Lücke (Nachbarn rücken nach) bleibt davon unberührt, nur das
// verblassende Stück selbst verschwindet jetzt sofort nach der Hold-Phase
// statt sichtbar zu schrumpfen. findRect() (unten) nutzt bewusst NICHT
// dieses Flag (Default false) - eine Herkunfts-Positions-Abfrage muss ein
// Stück unabhängig von seiner Sichtbarkeits-Phase finden können.
export function layoutBox(piece, t, originX, originY, out, stats, hideFading = false) {
	if (stats) {
		stats.visited = (stats.visited || 0) + 1;
		if (stats.ids) stats.ids.add(piece.id);
	}

	if (t < piece.born_time || t >= piece.te) {
		return { w: 0, h: 0, mass: 0, momentX: 0, momentY: 0 };
	}

	let isActive = piece.children.length > 0 && t >= piece.cut_time;
	if (!isActive) {
		let { w, h } = leafEffectiveSize(piece, t);
		if (w <= 0 || h <= 0) return { w: 0, h: 0, mass: 0, momentX: 0, momentY: 0 };
		let mass = w * h;
		let fading =
			hideFading && isFinite(piece.taken_time) && t >= piece.taken_time + piece.delaySnapshot;
		if (out && !fading) out.push({ piece, x: originX, y: originY, w, h });
		return { w, h, mass, momentX: mass * (originX + w / 2), momentY: mass * (originY + h / 2) };
	}

	// Geteilt & aktiv: Kinder entlang `dir` per Präfixsumme packen (Lücken
	// bereits entnommener/verblassender Geschwister schließen sich dadurch
	// automatisch) - quer dazu bleibt der Ursprung (originX/originY)
	// gemeinsam für alle Kinder (dieselbe Kante wie beim ursprünglichen
	// Schnitt, siehe bank-core.js is_vert_cut-Konstruktion). Überlappung ist
	// per Konstruktion ausgeschlossen: der Cursor wächst monoton (jedes
	// mainDelta >= 0), kein Kind bekommt je eine kleinere Position als sein
	// Vorgänger + dessen Breite.
	let alongX = piece.dir === 'x';
	let cursor = alongX ? originX : originY;
	let crossMax = 0;
	let mass = 0,
		momentX = 0,
		momentY = 0;
	for (let child of piece.children) {
		let cx = alongX ? cursor : originX;
		let cy = alongX ? originY : cursor;
		let res = layoutBox(child, t, cx, cy, out, stats, hideFading);
		let mainDelta = alongX ? res.w : res.h;
		let crossDelta = alongX ? res.h : res.w;
		cursor += mainDelta;
		if (crossDelta > crossMax) crossMax = crossDelta;
		mass += res.mass;
		momentX += res.momentX;
		momentY += res.momentY;
	}
	let mainSize = cursor - (alongX ? originX : originY);
	let w = alongX ? mainSize : crossMax;
	let h = alongX ? crossMax : mainSize;
	return { w, h, mass, momentX, momentY };
}

// Moment/Masse-Schwerpunkt (Σ effektive_Fläche_Kind · Zentrum_Kind, bottom-up
// in layoutBox() mitgeführt) statt Teil Cs diskreter Anker-Wahl ("schwerste
// sichtbare Gruppe") - ersetzt einen möglichen Anker-WECHSEL (Sprunggefahr)
// durch einen stetig wandernden Referenzpunkt (siehe REST-PRECISION-PLAN
// Teil D, Abschnitt "Moment/Masse"). Kamera zentriert auf den Schwerpunkt,
// `halfW`/`halfH` sind trotzdem so bemessen, dass die GESAMTE Bounding-Box
// [0,w]x[0,h] (root.w/root.h sind bereits eine straffe Bounding-Box durch
// Konstruktion, siehe layoutBox()) im [0,1]-Fenster bleibt, auch wenn der
// Schwerpunkt weit von der geometrischen Mitte abweicht.
export function computeZoomFrame(frame, margin = 0.05) {
	const { w, h, mass, momentX, momentY } = frame;
	if (mass <= 0 || w <= 0 || h <= 0) {
		return { z: 1, cx: 0.5, cy: 0.5, offsetX: 0, offsetY: 0 };
	}
	let cx = momentX / mass;
	let cy = momentY / mass;
	let halfW = Math.max(cx, w - cx, 1e-9) * (1 + margin);
	let halfH = Math.max(cy, h - cy, 1e-9) * (1 + margin);
	let z = Math.min(0.5 / halfW, 0.5 / halfH);
	return { z, cx, cy, offsetX: 0.5 - cx * z, offsetY: 0.5 - cy * z };
}

// Komfort-Wrapper: ein Aufruf liefert alle sichtbaren Rects (Rendering) UND
// den daraus abgeleiteten Zoom-Rahmen (Kamera) - eine einzige Traversierung,
// kein doppeltes Layout.
export function layoutVisible(root, t, margin = 0.05, stats, hideFading = false) {
	let rects = [];
	let frame = layoutBox(root, t, 0, 0, rects, stats, hideFading);
	return { rects, frame, zoom: computeZoomFrame(frame, margin) };
}

// Herkunfts-Position EINES bestimmten Stücks zu EINEM festen Zeitpunkt t -
// für die Flug-Animation (render_pipeline in compiler.js/TargetBankCanvas.svelte).
// Ein fliegendes Stück braucht KEINE kontinuierlich mitlaufende Bank-Position
// (es hat die Bank ja verlassen) - nur EINEN wohldefinierten Startpunkt, z.B.
// piece.taken_time (ein Blatt ist dort noch exakt in designter Größe, die
// Hold-Phase hat noch nicht mit dem Schrumpfen begonnen) oder parent.born_time
// (ein noch nicht geschnittenes Stück ist im gesamten Intervall
// [born_time,cut_time) konstant in designter Größe). Reine Wiederverwendung
// von layoutBox() - keine zweite Positions-Berechnung, kein neuer,
// eingefrorener Zustand am Stück nötig (siehe REST-PRECISION-PLAN Teil D,
// Gesprächsverlauf: "man bräuchte nur die id des Herkunftsorts und das Ziel").
export function findRect(root, t, pieceId) {
	let out = [];
	layoutBox(root, t, 0, 0, out);
	return out.find((r) => r.piece.id === pieceId) || null;
}
