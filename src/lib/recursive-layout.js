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
// `depth` (default 0): nur die ersten MAX_CENTER_DEPTH Ebenen zentrieren
// die Kinder (Lücken gleichmäßig verteilen). Tiefer unten reicht der
// schnelle Prefix-Sum-Pack (die Boxen sind dort so klein, dass es visuell
// keine Rolle spielt).
const MAX_CENTER_DEPTH = 2;
export function layoutBox(piece, t, originX, originY, out, stats, depth = 0) {
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

	// Geteilt & aktiv: Kinder entlang `dir` mittig im verfügbaren Raum
	// anordnen (statt am Origin zu beginnen, was sie nach unten links
	// rutschen lässt) - NUR in den ersten MAX_CENTER_DEPTH Ebenen, wo es
	// visuell relevant ist. Tiefer unten: schneller Prefix-Sum-Pack.
	let alongX = piece.dir === 'x';
	let origin = alongX ? originX : originY;
	let cursor = origin;
	let crossMax = 0;
	let mass = 0,
		momentX = 0,
		momentY = 0;
	let centered = depth < MAX_CENTER_DEPTH;
	if (centered) {
		// Pass 1: Größen pro Kind sammeln (ohne out/stats, nur w/h).
		let childSizes = [];
		let totalAlong = 0;
		for (let child of piece.children) {
			let res = layoutBox(child, t, 0, 0, null, null, depth + 1);
			childSizes.push(alongX ? res.w : res.h);
			totalAlong += alongX ? res.w : res.h;
		}
		// Aktive Indizes + Summe.
		let activeIdxs = [];
		let activeAlong = 0;
		for (let i = 0; i < childSizes.length; i++) {
			if (childSizes[i] > 0) {
				activeIdxs.push(i);
				activeAlong += childSizes[i];
			}
		}
		let nActive = activeIdxs.length;
		let gap = totalAlong - activeAlong;
		let step = gap > 0 && nActive > 1 ? gap / (nActive + 1) : 0;
		// Pass 2: neue Positionen berechnen + rendern.
		let lastActiveEnd = origin;
		for (let i = 0; i < piece.children.length; i++) {
			let child = piece.children[i];
			let mainDelta = childSizes[i];
			let pos;
			if (mainDelta > 0) {
				// Neue Position mit gleichmäßig verteilten Lücken.
				pos = origin + step;
				for (let j = 0; j < nActive; j++) {
					if (activeIdxs[j] >= i) break;
					pos += childSizes[activeIdxs[j]];
					pos += step;
				}
				lastActiveEnd = pos + mainDelta;
			} else {
				pos = cursor;
			}
			let cx = alongX ? pos : originX;
			let cy = alongX ? originY : pos;
			let res = layoutBox(child, t, cx, cy, out, stats, depth + 1);
			mainDelta = alongX ? res.w : res.h;
			let crossDelta = alongX ? res.h : res.w;
			cursor += mainDelta;
			if (crossDelta > crossMax) crossMax = crossDelta;
			mass += res.mass;
			momentX += res.momentX;
			momentY += res.momentY;
		}
		let mainSize = lastActiveEnd - origin;
		let w = alongX ? mainSize : crossMax;
		let h = alongX ? crossMax : mainSize;
		return { w, h, mass, momentX, momentY };
	}
	// Schneller Ein-Pass (tiefe Ebenen): Prefix-Sum-Pack.
	for (let child of piece.children) {
		let cx = alongX ? cursor : originX;
		let cy = alongX ? originY : cursor;
		let res = layoutBox(child, t, cx, cy, out, stats, depth + 1);
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
// `boundX`/`boundY` (default 0): die untere Kante der TATSÄCHLICHEN
// Bounding-Box - normalerweise 0 (layoutBox() packt ab Origin), aber bei
// layoutCentered() (siehe unten) verschoben. Nötig, damit halfW/halfH den
// Abstand von cx zu BEIDEN echten Kanten misst, nicht zu einer angenommenen
// Kante bei 0 - sonst kann `w - cx` negativ werden und der Zoom bricht.
export function computeZoomFrame(frame, margin = 0.05, boundX = 0, boundY = 0) {
	const { w, h, mass, momentX, momentY } = frame;
	if (mass <= 0 || w <= 0 || h <= 0) {
		return { z: 1, cx: 0.5, cy: 0.5, offsetX: 0, offsetY: 0 };
	}
	let cx = momentX / mass;
	let cy = momentY / mass;
	let halfW = Math.max(cx - boundX, boundX + w - cx, 1e-9) * (1 + margin);
	let halfH = Math.max(cy - boundY, boundY + h - cy, 1e-9) * (1 + margin);
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

// Zentriert das GESAMTE sichtbare Ergebnis UNGEWICHTET in der Mitte des
// logischen [0,root.w]x[0,root.h]-Raums, statt es (wie layoutBox() pur) an
// der Ecke (0,0) kleben zu lassen (Gesprächsverlauf: reines Prefix-Sum-
// Packen lässt überlebende Stücke IMMER Richtung originX/Y rutschen -
// "kompaktiert immer nach unten links"; besser zur Mitte hin kompaktieren,
// das hält auch den Massenschwerpunkt zentrierter). EIN zusätzlicher
// O(n)-Nachlauf über die bereits von layoutBox() gesammelten Rects (KEINE
// zweite Traversierung): layoutBox() liefert Größe/Momente korrekt bei
// Origin (0,0), eine konstante Verschiebung aller Rects + eine analytische
// Translations-Korrektur von momentX/momentY (neues Moment = altes Moment +
// Verschiebung × Masse) zentriert das Ergebnis, ohne pro Split-Ebene neu zu
// gewichten. MUSS überall konsistent genutzt werden, wo Bank-Geometrie für
// denselben Zeitpunkt gebraucht wird (Render-Pfad in TargetBankCanvas.svelte,
// findRect() unten, die Kamera-Spline-Vorberechnung in compiler.js) - sonst
// laufen Kamera und tatsächlich gerenderte Position auseinander.
export function layoutCentered(root, t, out, stats, margin = 0.05) {
	let frame = layoutBox(root, t, 0, 0, out, stats);
	if (frame.mass <= 0 || frame.w <= 0 || frame.h <= 0) {
		return { frame, zoom: computeZoomFrame(frame, margin) };
	}
	let shiftX = (root.w - frame.w) / 2;
	let shiftY = (root.h - frame.h) / 2;
	if (out) {
		for (let r of out) {
			r.x += shiftX;
			r.y += shiftY;
		}
	}
	let shiftedFrame = {
		w: frame.w,
		h: frame.h,
		mass: frame.mass,
		momentX: frame.momentX + shiftX * frame.mass,
		momentY: frame.momentY + shiftY * frame.mass,
	};
	return { frame: shiftedFrame, zoom: computeZoomFrame(shiftedFrame, margin, shiftX, shiftY) };
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
// Nutzt layoutCentered() (nicht layoutBox() direkt) - MUSS dieselbe
// Zentrierung wie der Render-Pfad verwenden, sonst startet die Flug-
// Animation an der UNVERSCHOBENEN statt der tatsächlich gerenderten
// Position.
export function findRect(root, t, pieceId) {
	let out = [];
	layoutCentered(root, t, out);
	return out.find((r) => r.piece.id === pieceId) || null;
}
