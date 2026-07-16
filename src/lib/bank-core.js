// ============================================================================
// BANK-CORE.JS - Gemeinsame Quelle für den Bank-Algorithmus
// ============================================================================
// Diese Datei ist die EINZIGE Quelle der Wahrheit für:
//   1. Den Auswahl-/Schneide-Algorithmus der Bank (createBankSimulation)
//   2. Die Kompaktierung ("Zeilen/Spalten ausblenden")
//
// Sowohl das Haupttool (wurzel2_v28.html) als auch das Algorithmus-Spiel-Tool
// (selection_strategy_prototype.html) binden GENAU DIESEN Code ein (per
// Build-Schritt einkopiert, siehe build.py). Aenderungen hier gelten
// automatisch fuer beide - keine manuelle Synchronisation mehr noetig.
//
// Bewusst OHNE globale Variablen: alles ist entweder in der von
// createBankSimulation() zurueckgegebenen, gekapselten Instanz, oder als
// reine Funktion mit expliziten Parametern - dadurch koennen mehrere
// Instanzen (z.B. verschiedene Zoom-Stufen zum Vergleich) nebeneinander
// existieren, ohne sich gegenseitig zu stoeren.
// ============================================================================

import { computeSegmentBlend } from './smoothing.js';

// ---------------------------------------------------------------------------
// TEIL 1: Bank-Algorithmus (Auswahl-Strategie "isolation" + Schneide-Strategie
// "centroid_far" + Streifen-Enden-Filter - die im Algorithmus-Spiel-Tool
// gefundene beste Kombination, siehe Gespraechsverlauf).
// ---------------------------------------------------------------------------
//
// WICHTIG zur Zeitachse: Der Algorithmus arbeitet intern ausschliesslich mit
// einem monoton wachsenden Integer-"Tick" (jede tatsaechliche ENTNAHME ist
// ein Tick; Schneiden allein verbraucht keinen eigenen Tick). Das ist die
// gleiche Zeitachse wie im Algorithmus-Spiel-Tool.
//
// Das Haupttool hat ZUSAETZLICH eine kontinuierliche Animationszeit fuer die
// Flug-Animation. Die Bruecke zwischen beiden ist eine bijektive Abbildung
// (siehe TEIL 3: buildTickTimeMapping) - der Algorithmus selbst muss davon
// nichts wissen, er liefert nur die Tick-Nummer jeder Entnahme mit zurueck.

function createBankSimulation(BASE, N_MAX, squareSplit) {
	squareSplit = squareSplit || 'fixed'; // 'fixed' oder 'alternating'
	let baseBig = BigInt(BASE);
	let n_arr = [1];
	let P_int = 1n;
	for (let m = 1; m <= N_MAX; m++) {
		let target = 2n * baseBig ** BigInt(2 * m);
		let best_n = 0n;
		for (let t = baseBig - 1n; t >= 0n; t--) {
			let c = P_int * baseBig + t;
			if (c * c <= target) {
				best_n = t;
				break;
			}
		}
		n_arr.push(Number(best_n));
		P_int = P_int * baseBig + best_n;
	}
	let axes = [{ exp: 0 }];
	for (let m = 1; m <= N_MAX; m++) for (let c = 0; c < n_arr[m]; c++) axes.push({ exp: m });
	let TOTAL_STEPS = axes.length;

	let global_id = 0;
	let bank_pieces = [
		{
			id: global_id++,
			parent_id: null,
			k: 0,
			x: 0,
			y: 0,
			w: 1,
			h: 1,
			born_time: 0,
			cut_time: Infinity,
			taken_time: Infinity,
			children: [],
		},
	];
	let tick = 1;

	// den Enden (siehe Gespraechsverlauf: verhindert unnoetige Loecher).
	function filterToStripEnds(candidates) {
		let byParent = new Map();
		for (let p of candidates) {
			if (!byParent.has(p.parent_id)) byParent.set(p.parent_id, []);
			byParent.get(p.parent_id).push(p);
		}
		let result = [];
		for (let [pid, group] of byParent) {
			if (group.length <= 2) {
				result.push(...group);
				continue;
			}
			let varyX = group.some((p) => p.x !== group[0].x);
			group.sort((a, b) => (varyX ? a.x - b.x : a.y - b.y));
			result.push(group[0], group[group.length - 1]);
		}
		return result;
	}

	// Anzahl direkt beruehrender, zur gleichen Zeit sichtbarer Nachbarn.
	function isolationScore(p, atTick) {
		let touch = 0;
		const EPS = 1e-9;
		for (let q of bank_pieces) {
			if (q.id === p.id) continue;
			if (!(atTick >= q.born_time && atTick < q.cut_time && atTick < q.taken_time)) continue;
			let touchX =
				(Math.abs(p.x + p.w - q.x) < EPS || Math.abs(q.x + q.w - p.x) < EPS) &&
				!(p.y + p.h <= q.y + EPS || q.y + q.h <= p.y + EPS);
			let touchY =
				(Math.abs(p.y + p.h - q.y) < EPS || Math.abs(q.y + q.h - p.y) < EPS) &&
				!(p.x + p.w <= q.x + EPS || q.x + q.w <= p.x + EPS);
			if (touchX || touchY) touch++;
		}
		return touch;
	}

	function getPieceFromBank(target_k) {
		let available = filterToStripEnds(
			bank_pieces.filter(
				(p) => p.k === target_k && p.taken_time === Infinity && p.cut_time === Infinity,
			),
		);
		if (available.length > 0) {
			available.sort((a, b) => isolationScore(a, tick) - isolationScore(b, tick));
			let chosen = available[0];
			chosen.taken_time = tick;

			let usedTick = tick;
			tick++;
			return { piece: chosen, tick: usedTick };
		}

		let parents = filterToStripEnds(
			bank_pieces.filter(
				(p) => p.k < target_k && p.taken_time === Infinity && p.cut_time === Infinity,
			),
		);
		if (parents.length === 0) throw 'Bank ist leer! Iterationstiefe überschreitet Vorrat.';

		let visible = bank_pieces.filter((p) => p.taken_time === Infinity && p.cut_time === Infinity);
		let ccx = 0,
			ccy = 0,
			cwsum = 0;
		for (let p of visible) {
			let w = p.w * p.h;
			ccx += (p.x + p.w / 2) * w;
			ccy += (p.y + p.h / 2) * w;
			cwsum += w;
		}
		if (cwsum > 0) {
			ccx /= cwsum;
			ccy /= cwsum;
		} else {
			ccx = 0.5;
			ccy = 0.5;
		}
		function edgeDist(p) {
			let dx = Math.max(p.x - ccx, 0, ccx - (p.x + p.w));
			let dy = Math.max(p.y - ccy, 0, ccy - (p.y + p.h));
			return Math.hypot(dx, dy);
		}
		parents.sort((a, b) => b.k - a.k || edgeDist(b) - edgeDist(a)); // am weitesten vom Schwerpunkt zuerst
		let best_parent = parents[0];

		best_parent.cut_time = tick;

		const EPS = 1e-9;
		let is_vert_cut;
		if (best_parent.w > best_parent.h + EPS) is_vert_cut = true;
		else if (best_parent.h > best_parent.w + EPS) is_vert_cut = false;
		else {
			// Exaktes Quadrat: echte freie Wahl, keine Groessenauswirkung.
			if (squareSplit === 'fixed') is_vert_cut = true;
			else is_vert_cut = (best_parent.k / 2) % 2 === 0;
		}
		let cw = is_vert_cut ? best_parent.w / BASE : best_parent.w;
		let ch = is_vert_cut ? best_parent.h : best_parent.h / BASE;
		for (let i = 0; i < BASE; i++) {
			let child = {
				id: global_id++,
				parent_id: best_parent.id,
				k: best_parent.k + 1,
				x: best_parent.x + (is_vert_cut ? i * cw : 0),
				y: best_parent.y + (is_vert_cut ? 0 : i * ch),
				w: cw,
				h: ch,
				born_time: best_parent.cut_time,
				cut_time: Infinity,
				taken_time: Infinity,
				children: [],
			};
			bank_pieces.push(child);
			best_parent.children.push(child);
		}
		return getPieceFromBank(target_k);
	}

	return {
		BASE,
		N_MAX,
		axes,
		TOTAL_STEPS,
		bank_pieces, // Referenz - wird von getPieceFromBank mutiert
		getPieceFromBank, // (target_k) -> {piece, tick}
		get currentTick() {
			return tick;
		},
	};
}

// ---------------------------------------------------------------------------
// TEIL 1b: Shell-Konstruktion (bestimmt, in welcher Reihenfolge und mit
// welcher Ziel-Groesse getPieceFromBank aufgerufen wird - simuliert den
// echten Aufbau des Ziel-Quadrats schalenweise).
// ---------------------------------------------------------------------------
//
// Fuer Positionen am "oberen Rand" einer Schale (is_top) gibt es zwei
// Betriebsarten, ueber cellMode gewaehlt - beide nutzen denselben
// Auswahl-/Schneide-Algorithmus, unterscheiden sich nur darin, WIE VIELE
// Stuecke pro Rand-Zelle aus der Bank geholt werden:
//
//  - 'subdivide' (Default, "Zerschneiden"/Montessori-Stil): es werden BASE
//    Stuecke der NAECHSTEN, feineren Ebene (k+1) entnommen statt eines
//    einzelnen Stuecks der Ebene k - der Rand einer Schale entspricht immer
//    der naechsten Ziffern-Stelle (siehe README Abschnitt 6). Wird das
//    ausgelassen (wie einst versehentlich beim Portieren auf bank-core.js
//    passiert), verschiebt sich die gesamte Entnahme-Reihenfolge und das
//    Ergebnis sieht spuerbar "unruhiger" aus, obwohl der Auswahl-/
//    Schneide-Algorithmus selbst unveraendert ist. Das ist der Modus, den
//    das Algorithmus-Spiel-Tool (selection_strategy_prototype.html) nutzt.
//  - 'morph' ("Strecken"): nimmt ein einzelnes Stueck der Ebene k direkt aus
//    der Bank (keine Unterteilung) - das Stueck wird beim Rendern in die
//    Zielzelle gestreckt/gemorpht. Das nutzt das Haupttool im Morphing-
//    Flugmodus (siehe sqrt2.html).
//
// Jeder getPieceFromBank()-Aufruf wird als "Event" mit Gitterposition (u,v),
// Gruppengroesse (count) und Index innerhalb der Gruppe (i) zurueckgegeben -
// das gibt Aufrufern (z.B. dem Haupttool) genug Information, um daraus ihre
// eigene Animations-/Render-Pipeline zu bauen, ohne die Schalen-Konstruktion
// selbst zu duplizieren.
export function buildSystem(BASE, N_MAX, squareSplit, cellMode) {
	cellMode = cellMode || 'subdivide';
	let sim = createBankSimulation(BASE, N_MAX, squareSplit);
	let events = [];
	for (let S = 1; S < sim.TOTAL_STEPS; S++) {
		let shell = [];
		for (let v = 0; v < S; v++) shell.push({ u: S, v: v, is_top: false });
		for (let u = 0; u < S; u++) shell.push({ u: u, v: S, is_top: true });
		shell.push({ u: S, v: S, is_top: false });
		for (let sp of shell) {
			let k = sim.axes[sp.u].exp + sim.axes[sp.v].exp;
			if (sp.is_top && cellMode === 'subdivide') {
				for (let i = 0; i < BASE; i++) {
					let { piece, tick } = sim.getPieceFromBank(k + 1);
					events.push({ u: sp.u, v: sp.v, is_top: true, k: k + 1, piece, tick, i, count: BASE });
				}
			} else {
				let { piece, tick } = sim.getPieceFromBank(k);
				events.push({ u: sp.u, v: sp.v, is_top: sp.is_top, k, piece, tick, i: 0, count: 1 });
			}
		}
	}
	let local_max_time = sim.currentTick - 1;
	return { sim, local_max_time, events };
}

// ---------------------------------------------------------------------------
// TEIL 2: Kompaktierung ("Zeilen/Spalten ausblenden")
// ---------------------------------------------------------------------------
// Reine Funktionen, keine Abhaengigkeit von einer bestimmten Bank-Instanz -
// nehmen bank_pieces jeweils als Parameter entgegen.

// PHYSIKALISCHES MODELL (Gesprächsverlauf - siehe auch CLAUDE.md
// "Automatisierte Parameteränderungen"): Kompaktierung darf sich nicht wie
// ein reines Prefix-Sum-"Förderband" verhalten (alter Ansatz: Gruppe 0
// bleibt immer bei Koordinate 0 fix, JEDE Lücke schließt sich, indem ALLES
// danach - unabhängig von dessen Größe - nach vorne rutscht). Das ließ
// beliebig GROSSE Flächen mitreißen, nur weil irgendwo VOR ihnen ein
// winziges Stück verschwand ("große Elemente werden sehr schnell bewegt").
//
// Stattdessen: die zusammenhängende Gruppe mit der GRÖSSTEN Gesamtfläche
// ("Masse") ist der ANKER und bleibt an ihrer ROHEN (unveränderten)
// Koordinate - alle anderen Gruppen werden LÜCKENLOS an sie herangerückt
// (links vom Anker rückwärts, rechts vorwärts aufgereiht). Große Flächen
// bekommen dadurch "am wenigsten Beschleunigung": sie SIND meist der Anker
// (bewegen sich gar nicht) oder liegen nah an ihm (kurzer Restweg), während
// eine Kaskade kleiner Stücke den Löwenanteil der Bewegung übernimmt.
//
// Wichtig: das ist bewusst zustandslos (wie der Rest von bank-core.js,
// siehe Datei-Kopfkommentar) - KEINE über die Zeit mitgeführte Ist-Position
// pro Stück nötig. Der Anker wird bei JEDEM Aufruf frisch aus den ROHEN
// (p.x/p.y) Koordinaten der gerade sichtbaren Stücke bestimmt. Das reicht,
// weil die Ankergruppe zwischen zwei benachbarten Wegpunkten fast immer aus
// DENSELBEN Stücken besteht (eine einzelne Entnahme betrifft meist nur eine
// kleine Nachbargruppe) - deren aus p.x/p.y berechnete Rohposition ändert
// sich nie, die Ankerposition bleibt also "for free" über Wegpunkte hinweg
// stabil, ganz ohne Zustand mitzuführen. Wechselt die schwerste Gruppe
// tatsächlich einmal (selten), ist das wie jeder andere Kompaktierungs-
// Schritt einfach ein weiterer, ganz normal weich überblendeter Wegpunkt.
//
// Rückgabe: `compact` bildet weiterhin roh->kompaktiert ab, aber der
// Wertebereich beginnt NICHT mehr zwingend bei 0 (der Anker kann irgendwo
// liegen) - `minCoord`/`totalOccupied` beschreiben den tatsächlichen
// [minCoord, minCoord+totalOccupied]-Bereich, siehe computeCompactionFitStates()
// weiter unten für die (davon losgelöste) Zentrierung/Skalierung.
export function buildCompactionMap(pieces, axis) {
	let intervals = pieces.map((p) => {
		let lo = axis === 'x' ? p.x : p.y;
		let hi = axis === 'x' ? p.x + p.w : p.y + p.h;
		return { lo, hi, mass: p.w * p.h };
	});
	intervals.sort((a, b) => a.lo - b.lo);
	let merged = [];
	for (let iv of intervals) {
		if (merged.length === 0 || iv.lo > merged[merged.length - 1].hi + 1e-9) {
			merged.push({ lo: iv.lo, hi: iv.hi, mass: iv.mass });
		} else {
			let g = merged[merged.length - 1];
			g.hi = Math.max(g.hi, iv.hi);
			g.mass += iv.mass;
		}
	}
	if (merged.length === 0) {
		return { compact: (x) => x, totalOccupied: 1e-9, minCoord: 0 };
	}

	let anchorIdx = 0;
	for (let i = 1; i < merged.length; i++)
		if (merged[i].mass > merged[anchorIdx].mass) anchorIdx = i;

	let compactedStart = new Array(merged.length);
	compactedStart[anchorIdx] = merged[anchorIdx].lo;
	let cursor = merged[anchorIdx].hi;
	for (let i = anchorIdx + 1; i < merged.length; i++) {
		compactedStart[i] = cursor;
		cursor += merged[i].hi - merged[i].lo;
	}
	let maxCoord = cursor;
	cursor = merged[anchorIdx].lo;
	for (let i = anchorIdx - 1; i >= 0; i--) {
		cursor -= merged[i].hi - merged[i].lo;
		compactedStart[i] = cursor;
	}
	let minCoord = cursor;

	function compact(coord) {
		for (let i = 0; i < merged.length; i++) {
			if (coord >= merged[i].lo - 1e-9 && coord <= merged[i].hi + 1e-9) {
				return compactedStart[i] + Math.max(0, coord - merged[i].lo);
			}
		}
		for (let i = 0; i < merged.length; i++) if (coord < merged[i].lo) return compactedStart[i];
		return maxCoord;
	}
	return { compact, totalOccupied: Math.max(maxCoord - minCoord, 1e-9), minCoord };
}

// BUGFIX (Teile rutschen zu früh nach): ein einzelner Wegpunkt-Tick
// GAP_CLOSE_DELAY_TICKS nach dem Entstehen einer Lücke reicht NICHT, um
// jede Bewegung bis dahin zu verhindern - computeSegmentBlend() blendet
// STETIG zwischen zwei benachbarten Wegpunkten, d.h. selbst ein Segment
// [T, T+GAP_CLOSE_DELAY_TICKS] (offen -> geschlossen) zeigt schon WÄHREND
// dieser Zeit spürbare Bewegung, nicht erst am Ende (Steigung ist nur
// GENAU bei s=0 exakt Null, für jedes s>0 schon spürbar von Null
// verschieden). Für "gar keine Bewegung, bis mindestens GAP_CLOSE_DELAY_TICKS
// vergangen sind" braucht es STATTDESSEN zwei Wegpunkte mit IDENTISCHEM
// ("noch offen") Zustand im Abstand GAP_CLOSE_DELAY_TICKS - ein Segment
// zwischen zwei GLEICHEN Zuständen bleibt exakt flach (Blend-Ergebnis hängt
// nicht von s ab, wenn Start- und Endwert gleich sind), UNABHÄNGIG davon
// wie breit es ist. Die eigentliche (weiterhin sanfte) Überblendung findet
// erst DANACH statt, im Segment [T+GAP_CLOSE_DELAY_TICKS,
// T+GAP_CLOSE_DELAY_TICKS+transitionTicks].
//
// transitionTicks (Parameter statt fester Konstante - "einstellbar viele
// Ticks", Gesprächsverlauf): wie lange diese ANSCHLIESSENDE Überblendung
// selbst dauert. Der Start-Verzug (GAP_CLOSE_DELAY_TICKS) bleibt bewusst
// fest bei 1 - nur die Dauer der eigentlichen Bewegung ist einstellbar.
// Größere Werte verteilen die Kompaktierungs-Bewegung über mehr Ticks
// (ruhiger, aber "hinkt" länger hinter der tatsächlichen Entnahme her) -
// bleibt für JEDEN Wert sicher (Nichtüberlappung), siehe computeSegmentBlend().
//
// Das entnommene Stück selbst bleibt bis zum Schließen als "Platzhalter"
// reserviert (rein rechnerisch für die Kompaktierung - es wird dabei NICHT
// tatsächlich gezeichnet, siehe die Sichtbarkeits-Prüfung in
// sqrt2.html/selection_strategy_prototype.html, die weiterhin exakt bei
// taken_time endet).
const GAP_CLOSE_DELAY_TICKS = 1;
const DEFAULT_GAP_CLOSE_TRANSITION_TICKS = 8;

export function computeCompactionAt(
	bank_pieces,
	tickValue,
	transitionTicks = DEFAULT_GAP_CLOSE_TRANSITION_TICKS,
) {
	let visible = bank_pieces.filter(
		(p) =>
			tickValue >= p.born_time &&
			tickValue < p.cut_time &&
			tickValue < p.taken_time + GAP_CLOSE_DELAY_TICKS + transitionTicks,
	);
	if (visible.length === 0)
		return { mapX: (x) => x, mapY: (y) => y, totalW: 1, totalH: 1, minX: 0, minY: 0 };
	let mapX = buildCompactionMap(visible, 'x');
	let mapY = buildCompactionMap(visible, 'y');
	return {
		mapX: mapX.compact,
		mapY: mapY.compact,
		totalW: mapX.totalOccupied,
		totalH: mapY.totalOccupied,
		// minX/minY: der Anker (schwerste Gruppe, siehe buildCompactionMap)
		// kann irgendwo liegen, der kompaktierte Bereich beginnt daher NICHT
		// mehr zwingend bei 0 - computeCompactionFitStates() braucht diese
		// tatsächliche Untergrenze, um korrekt zu zentrieren.
		minX: mapX.minCoord,
		minY: mapY.minCoord,
	};
}

// BUGFIX (Überlappungen): baute früher nur dann einen Waypoint, wenn die
// GESAMTE Bounding-Box-Fläche gegenüber dem letzten Waypoint SCHRUMPFTE
// ("area < lastArea") - gedacht als reine Effizienzmaßnahme (weniger
// Wegpunkte für den Zoom-Faktor). Das übersieht aber, dass sich die
// Kompaktierungs-Abbildung (mapX/mapY) für EINZELNE Stücke bereits ändern
// kann, OHNE dass sich die GESAMTE Fläche ändert (z.B. wenn ein entferntes
// Stück auf einer Achse bereits von einem anderen, weiterhin sichtbaren
// Stück "verdeckt" war) - ein übersprungener Tick lässt dann ein Segment
// entstehen, das einen echten Sichtbarkeits-Wechsel eines nur LOKAL
// betroffenen Nachbarstücks gar nicht als eigenen Wegpunkt kennt. Kombiniert
// mit geteiltem Blend-Gewicht (computeSegmentBlend, siehe getSmoothedCompactedLogicalRect)
// reicht das für Sicherheit nicht aus: das Nachbarstück müsste currently
// noch exakt an SEINER alten Position stehen, obwohl das breite Segment
// längst in Richtung der neuen Anordnung unterwegs ist - siehe
// bank-core-compaction.test.js für den (mit dichtem Zeit-Sampling
// reproduzierten) Regressionstest.
//
// Fix: JEDER Tick, an dem sich die Sichtbarkeit irgendeines Stücks ändert,
// wird zum Wegpunkt (kein Filter mehr) - dank computeSegmentBlend()s
// O(log Wegpunkte)-Auswertung (statt einer vollen Spline-Neuberechnung pro
// Aufruf) ist das performant genug, siehe Messung im Gesprächsverlauf.
export function computeCompactionWaypoints(
	bank_pieces,
	maxTick,
	transitionTicks = DEFAULT_GAP_CLOSE_TRANSITION_TICKS,
) {
	let allTicks = new Set([0]);
	for (let p of bank_pieces) {
		// Zwei Wegpunkte pro entnommenem Stück - siehe die ausführliche
		// Begründung an computeCompactionAt() weiter oben:
		//  - T+GAP_CLOSE_DELAY_TICKS: Zustand "noch offen/reserviert" -
		//    IDENTISCH zum Zustand direkt nach der Entnahme (T), pinnt
		//    also das gesamte Segment davor (egal wie breit) auf exakt
		//    keine Bewegung.
		//  - T+GAP_CLOSE_DELAY_TICKS+transitionTicks (geclampt auf maxTick):
		//    Zustand "geschlossen" - hier (und erst hier) findet die
		//    eigentliche, weiterhin sanfte Überblendung statt, in einem
		//    eigenen, transitionTicks breiten Segment DANACH.
		// Ein Wegpunkt exakt bei T selbst ist NICHT nötig (der Zustand
		// dort ist identisch zu T+GAP_CLOSE_DELAY_TICKS, siehe Filter in
		// computeCompactionAt() - beide liegen im "noch reserviert"-Fenster).
		if (isFinite(p.taken_time)) {
			allTicks.add(p.taken_time + GAP_CLOSE_DELAY_TICKS);
			allTicks.add(Math.min(p.taken_time + GAP_CLOSE_DELAY_TICKS + transitionTicks, maxTick));
		}
		if (isFinite(p.cut_time)) allTicks.add(p.cut_time);
	}
	allTicks.add(maxTick);
	allTicks = Array.from(allTicks).sort((a, b) => a - b);

	return allTicks.map((t) => {
		let comp = computeCompactionAt(bank_pieces, t, transitionTicks);
		let z = Math.min(1 / comp.totalW, 1 / comp.totalH);
		return {
			t,
			mapX: comp.mapX,
			mapY: comp.mapY,
			totalW: comp.totalW,
			totalH: comp.totalH,
			minX: comp.minX,
			minY: comp.minY,
			z,
		};
	});
}

// Liefert die Position eines Stücks im KOMPAKTIERTEN, aber NOCH NICHT
// gezoomten Koordinatenraum (Ursprung bei 0, Ausdehnung bis waypoint.totalW/
// totalH - NICHT auf [0,1] normiert). Der Fit-Zoom (Skalierung + Zentrierung
// aufs [0,1]-Fenster) ist bewusst ZWEI EIGENE Funktionen weiter unten
// (computeCompactionFitStates() + Aufrufer-seitige Dämpfung) - siehe dortigen
// Kommentar für die Begründung dieser Aufteilung.
export function compactedLogicalRectAt(piece, waypoint) {
	let cx = waypoint.mapX(piece.x),
		cy = waypoint.mapY(piece.y);
	let cw = waypoint.mapX(piece.x + piece.w) - cx;
	let ch = waypoint.mapY(piece.y + piece.h) - cy;
	return { x: cx, y: cy, w: cw, h: ch };
}

// Glättet den Kompaktierungs-Sprung zwischen Waypoints per computeSegmentBlend()
// (siehe smoothing.js) - NICHT per buildMonotoneSpline()/buildMonotoneSplineBundle()
// wie andere Stellen in diesem Projekt (getBankTransform, getSmoothedAutoZoomExp).
//
// Grund (wichtige Ausnahme, siehe CLAUDE.md "Automatisierte Parameteränderungen"):
// Kompaktierung positioniert MEHRERE, voneinander abhängige Stücke, deren
// gegenseitige Nichtüberlappung erhalten bleiben MUSS. buildMonotoneSpline()
// optimiert die Tangente JEDES Feldes/Stücks UNABHÄNGIG - zwei Stücke können
// dadurch zum selben Zeitpunkt unterschiedlich weit "fortgeschritten" sein.
// Das brach hier tatsächlich etwas: die ORIGINALE Kompaktierungs-Umsetzung
// (siehe p.html-Historie) nutzte einen kausalen Exponentialkern, dessen
// Gewichte NUR von der Zeit abhängen (nicht vom Stück) - alle Stücke nutzten
// dadurch "for free" dieselben Gewichte. Die Migration auf
// buildMonotoneSplineBundle() (frühere Version dieser Funktion) hat diese
// Eigenschaft gebrochen und zu real reproduzierbaren Überlappungen geführt
// (Regressionstest: bank-core-compaction.test.js).
//
// computeSegmentBlend() stellt das geteilte Gewicht wieder her (EIN s(t) für
// alle Stücke/Felder) - ist dabei aber, anders als der alte Kernel, C¹-stetig
// UND trifft jeden Waypoint exakt (kein TAU/Abkling-Verhalten mehr nötig).
// Voraussetzung: `waypoints` muss WIRKLICH jeden relevanten Tick enthalten
// (siehe computeCompactionWaypoints() - hat früher gefiltert, das war Teil
// desselben Bugs). BEWUSST WEITERHIN EXAKT/SCHNELL (kein TAU) - das
// "Lücken schließen" selbst braucht diese Exaktheit für die
// Nichtüberlappungs-Garantie, siehe computeCompactionFitStates() weiter
// unten für den GEDÄMPFTEN Gegenpart (die Kamera/das Zoom-Fenster).
export function getSmoothedCompactedLogicalRect(piece, waypoints, time) {
	if (waypoints.length === 0) return null;
	return blendLogicalRect(
		piece,
		waypoints,
		waypoints.map((wp) => wp.t),
		time,
	);
}

function blendLogicalRect(piece, waypoints, times, time) {
	let { lo, hi, s } = computeSegmentBlend(times, time);
	let rA = compactedLogicalRectAt(piece, waypoints[lo]);
	let rB = compactedLogicalRectAt(piece, waypoints[hi]);
	return {
		x: rA.x * (1 - s) + rB.x * s,
		y: rA.y * (1 - s) + rB.y * s,
		w: rA.w * (1 - s) + rB.w * s,
		h: rA.h * (1 - s) + rB.h * s,
	};
}

// getSmoothedCompactedLogicalRect() leitet `times` (die reinen Zeitpunkte
// der Waypoints, für computeSegmentBlend()s binäre Suche) bei JEDEM Aufruf
// neu aus `waypoints` ab - bei tausenden Waypoints (jetzt der Normalfall,
// siehe computeCompactionWaypoints() ohne Filter) gemessen ein echtes
// Performance-Problem: 16.4ms/Frame statt 0.075ms/Frame bei 64 sichtbaren
// Stücken und ~17000 Waypoints (Tiefe 16, Zerschneiden-Modus) - der
// eigentliche pro-Aufruf-Blend selbst ist dagegen mit O(log Waypoints)
// vernachlässigbar (siehe CLAUDE.md/Memory "Measure before optimizing").
// makeCompactedLogicalRectLookup(waypoints) berechnet `times` nur EINMAL
// (nicht mehr pro Stück wie die frühere, komplexere Cache-Variante - hier
// reicht das, weil computeSegmentBlend() selbst schon O(log n) ist).
export function makeCompactedLogicalRectLookup(waypoints) {
	if (waypoints.length === 0) return () => null;
	let times = waypoints.map((wp) => wp.t);
	return function (piece, time) {
		return blendLogicalRect(piece, waypoints, times, time);
	};
}

// ---------------------------------------------------------------------------
// Fit-Zoom fürs kompaktierte Ziel-Fenster - BEWUSST von den Logical-Rects
// oben entkoppelt und NICHT hier gedämpft.
// ---------------------------------------------------------------------------
// "Die Bewegungen der Bank sind weiterhin viel zu schnell, wenn die
// Kompaktierung angewendet wird" (Gesprächsverlauf): computeSegmentBlend()
// oben ist bewusst SCHNELL/exakt (jeder Wegpunkt sofort, für die
// Nichtüberlappungs-Garantie nötig) - GENAU DESHALB darf der Fit-Zoom NICHT
// aus denselben, dicht getakteten Wegpunkten exakt berechnet werden, sonst
// "zittert" die Kamera bei jeder einzelnen Entnahme mit. Klassisches
// Kamera/Content-Split (wie ein "Smooth Camera Follow" in einer Game-
// Engine): das Ziel-Fenster bekommt eine EIGENE, LANGSAMERE Zeitkonstante.
//
// Sicherheit: Das kompaktierte Ergebnis füllt IMMER exakt [minX, minX+totalW]
// x [minY, minY+totalH] (buildCompactionMap() ankert an der schwersten
// Gruppe, siehe TEIL 2 oben - minX/minY sind daher NICHT mehr zwingend 0,
// anders als vor der massegewichteten Umstellung). Der Mittelpunkt ist
// entsprechend minX+totalW/2, minY+totalH/2 - dieselbe Art "wandernder
// Schwerpunkt" wie beim unkompaktierten Bank-Zoom (siehe getBankTransform()
// in sqrt2.html), nur jetzt auch für die Kompaktierung. Da JEDE gemeinsame
// (für alle Stücke gleiche) affine Skalierung+Verschiebung Nichtüberlappung
// unter sich bewahrt (Kernidee: zwei disjunkte Rechtecke bleiben unter
// derselben linearen Abbildung disjunkt), ist es für die Sicherheit
// UNERHEBLICH, wie träge/exakt dieser Fit-Zoom ist - Aufrufer können ihn
// beliebig (z.B. mit smoothing.js buildDampedFilterBundle()) dämpfen, ohne
// die oben bewiesene Nichtüberlappungs-Garantie zu gefährden. Bewusst NICHT
// hier in bank-core.js gedämpft (reine Algorithmus-Bibliothek, keine
// Animations-/Zeitkonstanten-Entscheidungen, siehe Datei-Kopfkommentar).
export function computeCompactionFitStates(waypoints) {
	return waypoints.map((wp) => ({
		t: wp.t,
		z: wp.z,
		offsetX: 0.5 - (wp.minX + wp.totalW / 2) * wp.z,
		offsetY: 0.5 - (wp.minY + wp.totalH / 2) * wp.z,
	}));
}

// Kombiniert einen (typischerweise schnellen) Logical-Rect-Lookup mit einem
// (typischerweise gedämpften) Fit-Zoom-Lookup zum fertigen, auf [0,1]
// projizierten Rechteck - reiner Komfort, beide Hälften bleiben unabhängig
// austauschbar/testbar. `fitZoomAt(time)` muss `{z, offsetX, offsetY}`
// liefern (z.B. `buildDampedFilterBundle(computeCompactionFitStates(waypoints), ['z','offsetX','offsetY'], tau).at`).
export function applyCompactionFit(logicalRect, fitZoom) {
	return {
		x: fitZoom.offsetX + logicalRect.x * fitZoom.z,
		y: fitZoom.offsetY + logicalRect.y * fitZoom.z,
		w: logicalRect.w * fitZoom.z,
		h: logicalRect.h * fitZoom.z,
	};
}

// ---------------------------------------------------------------------------
// TEIL 3: Bijektive Tick <-> Zeit Abbildung (fuer das Haupttool)
// ---------------------------------------------------------------------------
// Das Haupttool hat zusaetzlich zur Tick-Zaehlung eine kontinuierliche
// Animationszeit (fuer die Flug-Animation). buildTickTimeMapping() erstellt
// aus einer Liste von (tick, action_time)-Paaren (in der Reihenfolge, in der
// getPieceFromBank sie geliefert hat) eine bijektive Abbildung in beide
// Richtungen.
export function buildTickTimeMapping(tickTimePairs) {
	let sorted = tickTimePairs.slice().sort((a, b) => a.tick - b.tick);
	let tickToTimeArr = [0]; // Index 0 = Tick 0 = Zeitpunkt 0 (vor der ersten Entnahme)
	for (let p of sorted) tickToTimeArr[p.tick] = p.time;

	function tickToTime(t) {
		let lo = Math.max(0, Math.min(tickToTimeArr.length - 1, Math.floor(t)));
		let hi = Math.min(tickToTimeArr.length - 1, lo + 1);
		let frac = t - lo;
		if (hi >= tickToTimeArr.length) return tickToTimeArr[tickToTimeArr.length - 1];
		return tickToTimeArr[lo] + (tickToTimeArr[hi] - tickToTimeArr[lo]) * frac;
	}

	function timeToTick(time) {
		// binäre Suche im monoton wachsenden tickToTimeArr
		let lo = 0,
			hi = tickToTimeArr.length - 1;
		if (time <= tickToTimeArr[0]) return 0;
		if (time >= tickToTimeArr[hi]) return hi;
		while (hi - lo > 1) {
			let mid = (lo + hi) >> 1;
			if (tickToTimeArr[mid] <= time) lo = mid;
			else hi = mid;
		}
		let span = tickToTimeArr[hi] - tickToTimeArr[lo];
		let frac = span > 1e-12 ? (time - tickToTimeArr[lo]) / span : 0;
		return lo + frac;
	}

	return { tickToTime, timeToTick, maxTick: tickToTimeArr.length - 1 };
}

export { createBankSimulation };

// Fuer Node-Tests (require) UND direkte Einbindung per <script> gleichermassen nutzbar:
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		createBankSimulation,
		buildSystem,
		buildCompactionMap,
		computeCompactionAt,
		computeCompactionWaypoints,
		compactedLogicalRectAt,
		getSmoothedCompactedLogicalRect,
		makeCompactedLogicalRectLookup,
		computeCompactionFitStates,
		applyCompactionFit,
		buildTickTimeMapping,
	};
}
