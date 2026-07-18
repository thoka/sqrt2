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

// Blatt-Exit (siehe docs/INTERFACE-TODO.md "BUG: Lücke hart ausblenden"):
// die Sichtbarkeit wird bei taken_time AUSGESCHALTET, ABER die Lücke (das
// Rechteck) soll WEICH VERSCHWINDEN - ein C1-Ease-Out, KEIN harter C0-
// Sprung (das wäre ein echter Bug und nicht spezifikationsgemäß). ZWEI
// Phasen, abgeleitet aus den Stück-Feldern (beide in u_time, s.
// finalizeCompiled() in compiler.js):
//   Hold   : t <= taken_time              -> volle Design-Größe
//             taken_time < t <= gapHoldEnd_u -> volle Größe (Lücke bleibt)
//   Compact: gapHoldEnd_u < t < te        -> C1-Ease volle Größe -> 0
//             t >= te                        -> 0 (unsichtbar)
// Die Phasengrenzen: taken_time (u_time) und te = taken_time + gapHoldTicks
// + transitionTicks (u_time). gapHoldEnd_u = taken_time + gapHoldTicks
// (u_time) ist der Knoten zwischen Hold und Compact - in finalizeCompiled()
// aus dem Tick-Raum berechnet und am Stück als `gapHoldEnd_u` abgelegt.
// C1-Stetigkeit: die Compact-Phase nutzt smoothstep s*s*(3-2s) (Ableitung
// 0 an BEIDEN Enden), daher kein Kink bei gapHoldEnd_u (volle Größe,
// Steigung 0) UND kein Kink bei te (0, Steigung 0). Damit ist die ganze
// Exit-Kurve C1 - entspricht CLAUDE.md "stetige Ableitung".
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

// EINMAL definierter Interpolator für den Lücke->0-Übergang:
// Eingabe s = normierter Fortschritt DURCH die Compact-Phase
// (s=0 bei Compact-Beginn/gapHoldEnd_u, s=1 bei te), Ausgabe der
// ease-Faktor. Reine smoothstep (C1, Ableitung 0 an BEIDEN Enden ->
// keine Kinks bei gapHoldEnd_u noch bei te). Die Phasengrenzen
// (taken_time, gapHoldEnd_u, te) werden draußen frei skaliert/verschoben
// (s. leafEffectiveSize) - der Interpolator SELBST wird nicht neu
// berechnet, nur seine (skalierte) Eingabe s.
export function gapEase(s) {
	if (s <= 0) return 0;
	if (s >= 1) return 1;
	return s * s * (3.0 - 2.0 * s);
}

function leafEffectiveSize(piece, t) {
	if (!isFinite(piece.taken_time) || t <= piece.taken_time) {
		return { w: piece.w, h: piece.h };
	}
	// Nie entnommen (gapHoldEnd_u/te = Infinity) -> bleibt für immer sichtbar.
	if (!isFinite(piece.gapHoldEnd_u) || !isFinite(piece.te)) {
		return { w: piece.w, h: piece.h };
	}
	// Hold-Phase: Lücke bleibt bei voller Größe.
	if (t <= piece.gapHoldEnd_u) return { w: piece.w, h: piece.h };
	// Compact-Phase: C1-Ease volle Größe -> 0 (smoothstep, keine Kinks).
	// Eingabe an den Interpolator ist der SKALIERTE Fortschritt
	// s = (t - gapHoldEnd_u) / (te - gapHoldEnd_u) ∈ [0,1].
	if (t >= piece.te) return { w: 0, h: 0 };
	let span = piece.te - piece.gapHoldEnd_u;
	let s = span > 1e-12 ? (t - piece.gapHoldEnd_u) / span : 1;
	let k = 1.0 - gapEase(s);
	return { w: piece.w * k, h: piece.h * k };
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
	// (te = taken_time + gapHoldTicks + transitionTicks, siehe bank-core.js).
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
		// TEIL D (REST-PRECISION-PLAN): Reservierte Slot-Groesse (w/h) wird
		// IMMER geliefert (treibt den Parent-Cursor + Masse), damit die Luecke
		// sichtbar BLEIBT und sich ueber [gapHoldEnd_u, te] C1 schliesst
		// (Nachbarn ruecken weich nach - kein C0-Ruckeln). ABER: das Stueck
		// SELBST wird nur bis taken_time gezeichnet (inklusive Grenze, siehe
		// unten) - ab t > taken_time ist es "entnommen", die Rest-Zaehlung
		// (computeLiveL, Filter `t <= taken_time`) hat es dann schon
		// ausgeblendet. Also: Luecke sichtbar, Teil nicht mehr gezeichnet.
		// INKLUSIVE Grenze `t <= taken_time` (nicht `<`): bei GENAU
		// taken_time muss das Stueck noch gezeichnet werden - flightQueryTime
		// fragt gewoehnliche Blaetter exakt taken_time ab (bankOriginState()),
		// sonst startet die Flug-Animation bei (0,0).
		if (out && t <= piece.taken_time) out.push({ piece, x: originX, y: originY, w, h });
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
		// Pass 1: packen ab Origin, Positionen sammeln.
		let childPositions = []; // {mainDelta, crossDelta, pos} pro Kind
		for (let child of piece.children) {
			let cx = alongX ? cursor : originX;
			let cy = alongX ? originY : cursor;
			let res = layoutBox(child, t, cx, cy, null, null, depth + 1);
			let mainDelta = alongX ? res.w : res.h;
			let crossDelta = alongX ? res.h : res.w;
			childPositions.push({ mainDelta, crossDelta, pos: cursor });
			cursor += mainDelta;
			if (crossDelta > crossMax) crossMax = crossDelta;
			mass += res.mass;
			momentX += res.momentX;
			momentY += res.momentY;
		}
		// Gesamtbreite des Packs und aktive Breite.
		let totalAlong = cursor - origin;
		let activeAlong = 0;
		for (let cp of childPositions) if (cp.mainDelta > 0) activeAlong += cp.mainDelta;
		let gap = totalAlong - activeAlong;
		let shift = gap > 0 ? gap / 2 : 0;
		// Pass 2: mit Verschiebung rendern.
		cursor = origin;
		for (let i = 0; i < childPositions.length; i++) {
			let child = piece.children[i];
			let cp = childPositions[i];
			let pos = cp.pos + shift;
			let cx = alongX ? pos : originX;
			let cy = alongX ? originY : pos;
			let res = layoutBox(child, t, cx, cy, out, stats, depth + 1);
			let mainDelta = alongX ? res.w : res.h;
			let crossDelta = alongX ? res.h : res.w;
			cursor += mainDelta;
			if (crossDelta > crossMax) crossMax = crossDelta;
			mass += res.mass;
			momentX += res.momentX;
			momentY += res.momentY;
		}
		let mainSize = cursor - origin;
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
	// KEIN fixer 1e-9-Floor mehr (Bug, Gespraechsverlauf): w>0/h>0 ist durch
	// den early-return oben bereits garantiert, und cx liegt per Konstruktion
	// immer in [boundX, boundX+w] (gewichteter Schwerpunkt innerhalb der
	// eigenen Bounding-Box) - `(cx-boundX) + (boundX+w-cx) === w > 0`, also
	// ist IMMER mindestens einer der beiden Max-Terme positiv, ganz ohne
	// zusaetzliche Untergrenze. Ein fixer Floor wie beim EPS-Bug oben wird
	// bei genuegend tiefer Rekursion (hier: echte Bounding-Box ~1e-12) zur
	// AKTIVEN Grenze statt zum reinen Div-durch-Null-Schutz - der Zoom bleibt
	// dann weit hinter dem noetigen Wert zurueck, der Rest verschwindet fast
	// vollstaendig (Symptom: "ab einem Tick nichts mehr sichtbar").
	// Zoom-Faktor OHNE Puffer: ein Stück, das den gesamten Bank-Raum
	// [0,1] ausfüllt (z.B. das Wurzel-Stück bei t=0), ergibt z_exact = 1.
	let halfW0 = Math.max(cx - boundX, boundX + w - cx);
	let halfH0 = Math.max(cy - boundY, boundY + h - cy);
	let zExact = Math.min(0.5 / halfW0, 0.5 / halfH0);
	// Der optische Puffer (`margin`) wird NUR beim Hineinzoomen (z_exact
	// > 1) angewandt: er verkleinert die Ansicht leicht, damit um eine
	// kleine, scharf herangezoomte Gruppe Luft bleibt. Füllt das Stück
	// den Raum bereits voll aus (z_exact = 1), gibt es keinen Puffer nach
	// außen - der Zoom bleibt exakt 1, sonst würde das rechte weiße
	// Rest-Quadrat am Anfang auf ~0.95 verkleinert und wäre kleiner als das
	// Ziel-Quadrat (Symptom: "Rand"/"Rest kleiner als Ziel am Anfang").
	let z = zExact > 1 ? zExact / (1 + margin) : zExact;
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

// Tiefster gemeinsamer Elternrest (LCA) einer Menge von Bank-Stücken.
// `pieces`: die Blätter (jedes mit id/parent_id/k), `byId`: id -> piece
// (Map über alle bank_pieces). Reduziert die Blätter paarweise über die
// Baum-Struktur (parent_id) - da k (= Schnitt-/Rekursionstiefe) exakt der
// Baumtiefe entspricht, werden beide Kandidaten erst auf gleiche Tiefe
// gehoben und dann gemeinsam hochgelaufen. Rückgabe: das LCA-piece oder
// null (leere Menge oder keine gemeinsame Wurzel). Der Exponent des
// Rückgabewerts ist `.k`.
export function commonAncestor(pieces, byId) {
	if (!pieces || pieces.length === 0) return null;
	function lca(a, b) {
		while (a && b && a.id !== b.id) {
			if (a.k > b.k) a = byId.get(a.parent_id);
			else if (b.k > a.k) b = byId.get(b.parent_id);
			else {
				a = byId.get(a.parent_id);
				b = byId.get(b.parent_id);
			}
		}
		return a && b && a.id === b.id ? a : null;
	}
	let acc = pieces[0];
	for (let i = 1; i < pieces.length && acc; i++) acc = lca(acc, pieces[i]);
	return acc;
}
