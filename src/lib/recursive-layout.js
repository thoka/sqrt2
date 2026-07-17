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

// Blatt-Exit (User-Invariante, siehe REST-PRECISION-PLAN Teil D + DEBUG-
// INSPECT-SPEC.md "Nächster Schritt" Punkt 3): sichtbarer Rest endet HART bei
// taken_time - kein Ease-Out mehr (ein früherer Versuch mit sanftem
// Ausblenden bis `te` brachte laut Debug-Kanal-Messung keine Verbesserung der
// Bank/Rest-Drift, die Diskrepanz sitzt in der Compiler-Zeitgebung, nicht in
// diesem Layout). Ein Stück, das NIE entnommen wurde (taken_time=Infinity),
// bleibt für immer bei designter Größe - das IST der sichtbare Rest.
// GRENZE INKLUSIV (`t <= taken_time`, nicht `<`): ein entnommenes Blatt ist
// bei GENAU taken_time noch in Design-Größe sichtbar (siehe Kommentar oben
// an bankOriginState() in TargetBankCanvas.svelte: `flightQueryTime` fragt
// für gewöhnliche Blätter exakt taken_time ab, in der Annahme, das Stück
// dort noch zu finden). Bei striktem `<` verschwindet das Stück eine
// Instanz VOR seiner eigenen Abflug-Abfrage - findRect()/bankOriginState()
// finden es dann NIE, und die Flug-Animation startet ersatzweise bei (0,0)
// statt an der tatsächlich gerenderten Position (gefunden im Gespräch: mit
// striktem `<` fliegen ALLE gewöhnlichen Blätter vom Ursprung los). Alle
// Rest-Widget-/Zahlentafel-Filter (`t < p.taken_time`) müssen dieselbe
// inklusive Grenze verwenden, sonst bricht das Testkriterium "Bank-Zähler
// == Bank-Visualisierung" exakt in diesem einen Zeitpunkt (z.B. per
// Tick-Sprung erreichbar, siehe ControlPanel.svelte tickToTime()).
function leafEffectiveSize(piece, t) {
	if (!isFinite(piece.taken_time) || t <= piece.taken_time) {
		return { w: piece.w, h: piece.h };
	}
	return { w: 0, h: 0 };
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
export function layoutBox(piece, t, originX, originY, out, stats) {
	if (stats) {
		stats.visited = (stats.visited || 0) + 1;
		if (stats.ids) stats.ids.add(piece.id);
	}

	// GRENZE INKLUSIV (`t > te`, nicht `>=`): `te` ist stets >= taken_time
	// (te = taken_time + delaySnapshot + transitionTicks, siehe bank-core.js).
	// Fallen beide durch eine tick->time-Plateau (mehrere Ticks auf denselben
	// Zeitpunkt gemappt, siehe buildTickTimeMapping) exakt zusammen (te ===
	// taken_time), muss dieser äußere Bulk-Prune-Check bei GENAU diesem
	// Zeitpunkt NOCH NICHT greifen - sonst prunt er das Blatt, BEVOR
	// leafEffectiveSize() seine eigene (jetzt inklusive) taken_time-Grenze
	// überhaupt auswerten kann (gefunden im Gespräch: brach die "fliegt exakt
	// bei der gerenderten Rest-Position los"-Garantie für genau diesen Fall).
	if (t < piece.born_time || t > piece.te) {
		return { w: 0, h: 0, mass: 0, momentX: 0, momentY: 0 };
	}

	let isActive = piece.children.length > 0 && t >= piece.cut_time;
	if (!isActive) {
		let { w, h } = leafEffectiveSize(piece, t);
		if (w <= 0 || h <= 0) return { w: 0, h: 0, mass: 0, momentX: 0, momentY: 0 };
		let mass = w * h;
		// leafEffectiveSize liefert ab taken_time bereits Groesse 0 (sichtbarer
		// Rest endet bei taken_time, synchron zum alten Rest-Modell). Die
		// Bank zeichnet das Stueck also ab taken_time nicht mehr.
		if (out) out.push({ piece, x: originX, y: originY, w, h });
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
		let res = layoutBox(child, t, cx, cy, out, stats);
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
export function layoutVisible(root, t, margin = 0.05, stats) {
	let rects = [];
	let frame = layoutBox(root, t, 0, 0, rects, stats);
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
