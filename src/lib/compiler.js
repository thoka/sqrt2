// Reine Compiler-Logik aus sqrt2.html extrahiert (TOOLING_SPEC.md Phase 1).
// Kein DOM-Zugriff hier: Config rein, kompilierter Zustand raus - das macht
// diese Funktion sowohl per node --test testbar als auch später (Phase 2)
// als deterministische Basis für den derived `compiledStore` wiederverwendbar.
import {
	buildSystem,
	buildTickTimeMapping,
	computeCompactionWaypoints,
	makeCompactedLogicalRectLookup,
	computeCompactionFitStates,
} from './bank-core.js';

// TEIL C (REST-PRECISION-PLAN): Zoom nutzt kompaktierte Geometrie, damit der
// kleinste sichtbare Rest auch bei extremem Zoom groß genug skaliert wird.
// Die Kompaktierungs-Wegpunkte werden dafür IMMER berechnet (unabhängig vom
// compactionEnabled Render-Modus) - der Zoom-Framing braucht sie zwingend.
const ZOOM_COMPACTION_TRANSITION_TICKS = 3;
import { buildMonotoneSpline, buildDampedFilterBundle } from './smoothing.js';

// TEIL B (REST-PRECISION-PLAN): robuste Differenz zweier Stück-Positionen
// über den gemeinsamen Vorfahren. Statt der rohen, bereits gerundeten
// Float64-x-Werte p.x - q.x (Auslöschung bei tief geschachtelten,
// benachbarten Stücken) werden die kurzen, gutkonditionierten
// localOffsetX/Y-Ketten vom tiefsten gemeinsamen Vorfahren aufsummiert.
// parentMap: id -> piece. Reine Funktion, worker-tauglich (keine Closures).
export function relativePosition(p, q, parentMap, BASE) {
	// Pfad von p bzw. q zur Wurzel (inkl. localOffsetX/Y je Knoten).
	let pathP = [];
	for (let cur = p; cur; cur = parentMap.get(cur.parent_id)) pathP.push(cur);
	let pathQ = [];
	for (let cur = q; cur; cur = parentMap.get(cur.parent_id)) pathQ.push(cur);
	// Gemeinsamen Vorfahren von unten (Wurzel = letztes Element) finden.
	let i = pathP.length - 1,
		j = pathQ.length - 1;
	while (i >= 0 && j >= 0 && pathP[i].id === pathQ[j].id) {
		i--;
		j--;
	}
	// pathP/pathQ sind blatt->wurzel geordnet (path[0] = Blatt). i / j
	// zeigen auf den tiefsten gemeinsamen Vorfahren (LCA) selbst; die Knoten
	// UNTERHALB des LCA sind path[0..i] bzw. path[0..j].
	//
	// Jeder Knoten traegt den ganzzahligen Rasterindex localOffsetX/Y
	// (0..BASE-1, O(1), siehe bank-core.js). Die echte Position eines
	// Knotens ist die Faltung von WURZEL (e=letztes) nach BLATT (e=0):
	//   x = ((...(i_root)/BASE + i_{L-2})/BASE + ... + i_0)/BASE
	// also  fx = (fx + localOffset[e]) / BASE  von WURZEL nach BLATT - das
	// gewichtet das BLATT (direkt am Ort) mit BASE^-1 (groesster Beitrag),
	// den ROOT mit BASE^-L (kleinster), exakt und ohne Float-Ausloeschung,
	// rein Float (kein BigInt). Wir falten JEDE Kette bis zur WURZEL; die
	// gemeinsamen oberen Ebenen beider Stuecke sind identisch und heben
	// sich in rel.dx = foldP - foldQ exakt weg.
	function fold(path) {
		let fx = 0,
			fy = 0;
		for (let e = path.length - 1; e >= 0; e--) {
			fx = (fx + path[e].localOffsetX) / BASE;
			fy = (fy + path[e].localOffsetY) / BASE;
		}
		return { fx, fy };
	}
	let a = fold(pathP);
	let b = fold(pathQ);
	return { dx: a.fx - b.fx, dy: a.fy - b.fy };
}

// compileSystemData(): der TEURE, rein numerische Teil (worker-tauglich).
// Liefert NUR Arrays/Zahlen/Plain-Objects - KEINE Funktionen/Closures, damit
// der Rückgabewert per postMessage (structuredClone) in einen Web Worker
// passiert. buildTickTimeMapping()/buildMonotoneSpline()/buildDampedFilterBundle()
// liefern Closures und werden bewusst NICHT hier, sondern in finalizeCompiled()
// (Main-Thread, billig) gebaut.
export function compileSystemData(config) {
	const {
		base: BASE,
		depth: N_MAX,
		transformMode,
		bankZoomThresholdPowers: BANK_ZOOM_THRESHOLD_POWERS,
		zoomSpeedCoef,
		compactionEnabled,
		compactionTransitionTicks,
	} = config;

	// Beste validierte Kombination fest einprogrammiert (siehe README) -
	// das Haupttool bietet dafür bewusst keine eigene Auswahl an (nur den
	// Flug-Modus). Die Schalen-Konstruktion selbst (welche/wie viele Stücke
	// pro Gitterzelle) kommt aus bank-core.js (buildSystem) - gemeinsam mit
	// dem Test-Tool genutzt, statt einer eigenen Kopie der Schalen-Schleife.
	// cellMode 'morph' (S: Strecken) nimmt ein Stück direkt, 'subdivide'
	// (Z: Zerschneiden) BASE Stücke der nächsten Ebene pro Rand-Zelle -
	// siehe bank-core.js für Details.
	let cellMode = transformMode === 'Z' ? 'subdivide' : 'morph';
	let { sim, events } = buildSystem(BASE, N_MAX, 'fixed', cellMode);
	let axes = sim.axes;
	let TOTAL_STEPS = sim.TOTAL_STEPS;
	let bank_pieces = sim.bank_pieces;

	// n_arr[m] (Ziffer an Stelle m) ergibt sich direkt aus der Anzahl der
	// axes-Einträge mit exp===m - genau so hat bank-core.js sie erzeugt.
	let n_arr = new Array(N_MAX + 1).fill(0);
	for (let a of axes) n_arr[a.exp]++;

	// P_FINAL = Summe aller Achsen-Breiten (b^-exp) inkl. des Basisquadrats
	// (exp=0) - exakt der Wert, den axes[axes.length-1].cumulative früher lieferte.
	let P_FINAL = axes.reduce((sum, a) => sum + Math.pow(BASE, -a.exp), 0);

	// EXAKTE Zahlentafel (Teil A des REST-PRECISION-PLANs): l/l²/R ohne
	// Wurzel, direkt aus Ziffern-Zählung bzw. k-Feld der Bank-Stücke.
	//
	// Nenner:
	//   GRID      = BASE^N_MAX  – Nenner von l (axes[i].exp <= N_MAX immer).
	//   K_MAX     = max(p.k) über ALLE erzeugten Bank-Stücke – der Nenner
	//               von R, ABGELEITET nach dem Bank-Lauf (nicht angenommen:
	//               im subdivide-Modus treten Stücke mit k > N_MAX auf, z.B.
	//               die Ecke k = exp(u)+exp(v) mit u,v bis N_MAX, oder
	//               Rand-Zellen, die p.k+1 fordern).
	//   AREA_SCALE = BASE^K_MAX – Nenner von R (und von hochskaliertem l²
	//               zum Kreuzproben-Vergleich). AREA_SCALE ist ein exaktes
	//               Vielfaches von GRID² (BASE^(K_MAX-2·N_MAX)), die
	//               Skalierung für die Kreuzprobe ist also verlustfreie
	//               Multiplikation, kein Rundungsverlust.
	const GRID = BigInt(BASE) ** BigInt(N_MAX);
	let K_MAX = 0;
	for (let p of bank_pieces) if (p.k > K_MAX) K_MAX = p.k;
	const AREA_SCALE = BigInt(BASE) ** BigInt(K_MAX);

	// GLOBAL_L_PREFIX[S] = Σ_{i<S} BASE^(N_MAX - axes[i].exp), als BigInt.
	// Eine Präfixsumme über die Achsen, ausgewertet bis zum letzten
	// vollständig abgeschlossenen Schalenindex S (siehe computeLiveL()).
	// Einmalig O(TOTAL_STEPS) BigInt-Additionen – NICHT in der heissen
	// isolationScore-Schleife. Pro HUD-Update dann ein reiner Array-Lookup.
	let GLOBAL_L_PREFIX = new Array(TOTAL_STEPS + 1).fill(0n);
	let acc = 0n;
	for (let i = 0; i < TOTAL_STEPS; i++) {
		acc += GRID / BigInt(BASE) ** BigInt(axes[i].exp);
		GLOBAL_L_PREFIX[i + 1] = acc;
	}

	let render_pipeline = [];
	let tickTimePairs = [];
	let global_time = 1.0;
	let local_max_time = 1.0;

	// PATCH V28b: Bugfix "Bank ist leer" bei größerer Tiefe.
	// Vorher wurde global_time zu Beginn jeder Schale S hart auf S*3.0
	// zurueckgesetzt. Eine Schale hat aber (2*S+1) Stuecke, die je 0.15
	// Zeiteinheiten verbrauchen. Sobald (2*S+1)*0.15 > 3.0 ist (ab S~10),
	// lief die Zeit ueber das naechste Reset-Ziel hinaus - der naechste
	// Reset sprang dann RUECKWAERTS in der Zeit. Ausserdem braucht
	// buildTickTimeMapping() weiter unten monoton wachsende t_fly-Werte,
	// um Tick <-> Zeit eindeutig umzurechnen - ein Zeitsprung rueckwaerts
	// wuerde diese Abbildung brechen.
	//
	// Fix: kein absolutes Reset mehr, sondern ein garantiert positiver
	// Abstand ("gap") zum tatsaechlichen Ende der vorherigen Schale.
	// Damit ist global_time global monoton steigend, unabhaengig davon
	// wie viele Stuecke eine Schale enthaelt.
	const SHELL_GAP = 1.0;
	let shell_start_time = new Array(TOTAL_STEPS).fill(0);

	// events (aus bank-core.js buildSystem) sind bereits in der exakten
	// Entnahme-Reihenfolge sortiert. Eine Rand-Zelle im Zerschneiden-Modus
	// erscheint als `count` aufeinanderfolgende Events mit derselben
	// Gitterposition (u,v) - diese werden hier zu EINER Zerschneiden-Gruppe
	// (Z_source/Z_ghost/Z_micro) zusammengefasst, die anderen (count===1)
	// direkt zu S_macro/Z_direct.
	let lastS = 0;
	let idx = 0;
	while (idx < events.length) {
		let e = events[idx];
		let S = Math.max(e.u, e.v);
		if (S !== lastS) {
			global_time += SHELL_GAP;
			shell_start_time[S] = global_time;
			lastS = S;
		}

		if (e.count === 1) {
			let t_fly = global_time;
			tickTimePairs.push({ tick: e.tick, time: t_fly });
			if (e.is_top) {
				render_pipeline.push({ type: 'S_macro', bp: e.piece, u: e.u, v: e.v, time_fly: t_fly });
			} else {
				render_pipeline.push({ type: 'Z_direct', bp: e.piece, u: e.u, v: e.v, time_fly: t_fly });
			}
			local_max_time = Math.max(local_max_time, t_fly + 1.0);
			global_time += 0.15;
			idx++;
		} else {
			// Zerschneiden-Gruppe: das ganze Elternstück wird sichtbar
			// "aufgeschnitten" (Z_source -> Z_micro) und beim Zurückspulen
			// wieder "verschmolzen" (Z_ghost). BEKANNTER OFFENER BUG (siehe
			// README Abschnitt 8): die Rück-Verschmelzung ist noch nicht
			// vollständig animiert/verifiziert - absichtlich noch nicht
			// weiter gefixt, siehe Gesprächsverlauf.
			let group = events.slice(idx, idx + e.count);
			let t_cut = global_time - 0.5;
			let t_fly = global_time;
			let t_fuse = global_time + 1.0;
			let parent_bp = bank_pieces.find((p) => p.id === group[0].piece.parent_id);
			render_pipeline.push({ type: 'Z_source', bp: parent_bp, u: e.u, v: e.v, time_cut: t_cut });
			render_pipeline.push({ type: 'Z_ghost', bp: parent_bp, u: e.u, v: e.v, time_fuse: t_fuse });
			for (let g of group) {
				tickTimePairs.push({ tick: g.tick, time: t_cut });
				render_pipeline.push({
					type: 'Z_micro',
					bp: g.piece,
					u: e.u,
					v: e.v,
					i: g.i,
					time_cut: t_cut,
					time_fly: t_fly,
					time_fuse: t_fuse,
				});
			}
			local_max_time = Math.max(local_max_time, t_fuse + 0.5);
			global_time += 0.15;
			idx += e.count;
		}
	}

	// CUT_BORN_LEAD-Versatz wird in finalizeCompiled() angewandt (benötigt
	// die Closure von buildTickTimeMapping). Hier nur die Tick-Paare + die
	// rohen taken_time/cut_time/born_time (noch in Tick-Einheiten) mitführen.
	let raw_bank_pieces = bank_pieces.map((p) => ({
		...p,
		taken_time: p.taken_time,
		cut_time: p.cut_time,
		born_time: p.born_time,
	}));

	// Auto-Zoom-Checkpoints (rein numerisch): pro Schale S der Exponent.
	let auto_zoom_checkpoints = [];
	for (let S = 0; S < TOTAL_STEPS; S++) {
		auto_zoom_checkpoints.push({ t: shell_start_time[S], exp: axes[S].exp });
	}

	// PATCH V32/V39: Bank-Zoom-Checkpoints aus echten Entnahme-Zeitpunkten,
	// auf MAX_CHECKPOINTS heruntergesampelt. t-Werte hier noch in Tick-Raum
	// (roh), werden in finalizeCompiled() nach Zeit umgerechnet.
	const MAX_CHECKPOINTS = 400;

	let eventTimesSet = new Set([0]);
	for (let p of bank_pieces) {
		if (isFinite(p.taken_time)) eventTimesSet.add(p.taken_time);
	}
	eventTimesSet.add(local_max_time);
	let eventTimesTicks = Array.from(eventTimesSet).sort((a, b) => a - b);
	if (eventTimesTicks.length > MAX_CHECKPOINTS) {
		let sampled = [];
		for (let i = 0; i < MAX_CHECKPOINTS; i++) {
			sampled.push(
				eventTimesTicks[Math.floor((i * (eventTimesTicks.length - 1)) / (MAX_CHECKPOINTS - 1))],
			);
		}
		eventTimesTicks = Array.from(new Set(sampled));
	}

	// Kompaktierung (nur numerisch; Closure-Bau in finalizeCompiled()).
	let compaction_waypoints = null;
	if (compactionEnabled) {
		let transitionTicks = compactionTransitionTicks;
		if (!(transitionTicks >= 0)) transitionTicks = 3;
		compaction_waypoints = computeCompactionWaypoints(bank_pieces, local_max_time, transitionTicks);
	}

	// TEIL C: Zoom-Wegpunkte werden in finalizeCompiled() berechnet (nach
	// Tick→Zeit-Konversion, da computeCompactionWaypoints Animation-Zeiten
	// braucht). Hier nur den Parameter übergeben.
	return {
		axes,
		TOTAL_STEPS,
		bank_pieces: raw_bank_pieces,
		render_pipeline,
		GLOBAL_N_ARR: n_arr,
		P_FINAL,
		GLOBAL_L_PREFIX,
		GRID,
		K_MAX,
		AREA_SCALE,
		GLOBAL_SHELL_START: shell_start_time,
		tickTimePairs,
		auto_zoom_checkpoints,
		eventTimesTicks,
		compaction_waypoints,
		compactionEnabled,
		MAX_TIME: local_max_time,
		// Felder, die finalizeCompiled() für die Splines/Filter braucht:
		BASE,
		zoomSpeedCoef,
		local_max_time,
		BANK_ZOOM_THRESHOLD_POWERS,
	};
}

// finalizeCompiled(): der BILLIGE Rest, läuft auf dem Main-Thread. Baut aus
// den rein-numerischen Daten von compileSystemData() die Closures
// (buildTickTimeMapping/buildMonotoneSpline/buildDampedFilterBundle) auf
// bereits vorverdichteten Checkpoint-Arrays - schnell genug, darf auf dem
// Main-Thread passieren. Liefert exakt dieselbe Form wie das alte
// compileSystem().
export function finalizeCompiled(data) {
	const {
		axes,
		TOTAL_STEPS,
		bank_pieces,
		render_pipeline,
		GLOBAL_N_ARR,
		P_FINAL,
		GLOBAL_L_PREFIX,
		GRID,
		K_MAX,
		AREA_SCALE,
		GLOBAL_SHELL_START,
		tickTimePairs,
		auto_zoom_checkpoints,
		eventTimesTicks,
		compaction_waypoints,
		compactionEnabled,
		zoomSpeedCoef,
		local_max_time,
		BANK_ZOOM_THRESHOLD_POWERS,
	} = data;

	// bank-core.js zählt Entnahmen nur als monotonen Integer-Tick (siehe
	// Kommentar oben in bank-core.js, TEIL 3). Die bijektive Abbildung
	// übersetzt jeden Tick zurück in die kontinuierliche Animationszeit
	// dieses Tools; ein kleiner Versatz auf cut_time/born_time reproduziert
	// den alten Vorlauf ("Stück ist schon sichtbar geschnitten, bevor es
	// fliegt"). WICHTIG: dieser Versatz muss strikt kleiner sein als der
	// kleinstmögliche Abstand zwischen zwei aufeinanderfolgenden Ticks
	// (0.15, siehe global_time-Inkremente oben) - sonst kann ein Schnitt-
	// Ereignis aus einem SPÄTEREN Tick durch den Versatz vor die Entnahme
	// eines NAHEN, aber früheren Ticks rutschen und die Sichtbarkeits-
	// Reihenfolge verfälschen (führte zu Bank-Zuständen, die vom Test-Tool
	// bei gleichem Tick abwichen - mit 0.4 empirisch an vielen Ticks
	// reproduzierbar, mit 0.1 an keinem einzigen mehr).
	const CUT_BORN_LEAD = 0.1;
	let ttm = buildTickTimeMapping(tickTimePairs);
	for (let p of bank_pieces) {
		p.taken_time = isFinite(p.taken_time) ? ttm.tickToTime(p.taken_time) : Infinity;
		p.cut_time = isFinite(p.cut_time) ? ttm.tickToTime(p.cut_time) - CUT_BORN_LEAD : Infinity;
		p.born_time = p.born_time === 0 ? 0 : ttm.tickToTime(p.born_time) - CUT_BORN_LEAD;
	}

	// TEIL C: Zoom-Wegpunkte IMMER berechnet (unabhängig vom Render-Modus),
	// damit der Bank-Zoom die kompaktierte Geometrie framen kann. Nutzt die
	// zeitlich weiche Kompaktierung (computeSegmentBlend) als einzige
	// Glätte-Quelle - kein lokales Komprimieren bei Geburt. MUSS nach der
	// Tick→Zeit-Konversion oben passieren (computeCompactionWaypoints braucht
	// Animation-Zeiten, nicht Ticks).
	let zoom_waypoints = computeCompactionWaypoints(
		bank_pieces,
		local_max_time,
		ZOOM_COMPACTION_TRANSITION_TICKS,
	);
	let zoom_rect_lookup = makeCompactedLogicalRectLookup(zoom_waypoints);

	// Auto-Zoom-Ziel (Ziel-Seite): pro Schale S der Exponent der tiefsten in
	// dieser Schale neu sichtbaren Ziffern-Stelle - wächst mit der Animation
	// von 0 (nur Basisquadrat) bis N_MAX, nicht von Anfang an fix auf N_MAX.
	//
	// Nutzt buildMonotoneSpline() (siehe smoothing.js) statt eines kausalen
	// Filters: die Kurve trifft an JEDEM Checkpoint GENAU den dortigen
	// Exponenten - kein Nachhinken mehr. Für eine monoton wachsende
	// Stützpunkt-Folge bleibt die Spline zwischen zwei Checkpoints
	// garantiert innerhalb von deren Werten (Monotonie-Erhalt, siehe
	// smoothing.js) - das allein reicht bereits als Sichtbarkeits-Garantie,
	// siehe smoothing.test.js.
	//
	// { onlyChanges: true }: axes[S].exp wiederholt sich über mehrere
	// Schalen hinweg (bei Basis 10/Tiefe 16 sind nur 15 von 56 Schalen echte
	// Wertwechsel) - ohne diese Option erzwingt jeder Wiederholungspunkt
	// eine Nulltangente (siehe smoothing.js), was jeden Wertwechsel zu einer
	// isolierten Mini-Rampe zwischen "toten" Haltepunkten macht. Die
	// Sichtbarkeits-Garantie bleibt dabei erhalten (siehe
	// smoothing.test.js/auto-zoom-visibility.test.js).
	let GLOBAL_AUTO_ZOOM_CHECKPOINTS = auto_zoom_checkpoints;
	let GLOBAL_AUTO_ZOOM_SPLINE = buildMonotoneSpline(
		GLOBAL_AUTO_ZOOM_CHECKPOINTS.map((c) => ({ t: c.t, v: c.exp })),
		{ onlyChanges: true },
	);

	// PATCH V32: Auto-Zoom für die Bank - Zentrum und Zoom werden pro
	// Checkpoint aus der ECHTEN Bounding-Box (samt ihres eigenen
	// Mittelpunkts) berechnet, statt aus einem festen Zentrum 0.5/0.5 (der
	// Rest verlagert sich systematisch zu einer Seite hin, siehe README).
	// Damit eine Überblendung zwischen zwei verschiedenen Zentren dennoch
	// garantiert sicher bleibt, wird zwischen den fertig transformierten
	// BILDSCHIRM-POSITIONEN interpoliert (siehe getBankTransformed() in
	// sqrt2.html): für einen während des Übergangs sichtbaren Punkt liegt
	// sowohl die alte als auch die neue Position nachweislich in [0,1]
	// (Box-Schachtelung: die Box schrumpft monoton). Da [0,1] konvex ist,
	// liegt JEDE gewichtete Mischung dieser zwei sicheren Positionen
	// ebenfalls in [0,1] - unabhängig davon, wie stark sich das Zentrum
	// zwischen den Checkpoints verschiebt.
	//
	// Checkpoints kommen aus den tatsächlichen Entnahme-Zeitpunkten (viel
	// feinkörniger als "einmal pro Schale"), bei sehr tiefer Rekursion auf
	// eine Obergrenze heruntergesampelt, um die Kompilierzeit zu begrenzen.
	// PATCH V39: Kein Sicherheitsrand mehr (war 0.2) - der Zoom beim
	// Startzustand (volles [0,1]-Quadrat) ist damit exakt 1.0, nachweislich
	// der garantierte MINIMALE Zoom über die gesamte Laufzeit.
	// TEIL C: kleiner Rand, damit der kleinste sichtbare Rest nicht exakt am
	// Pixelrand klebt (er bleibt groß genug sichtbar).
	const ZOOM_MARGIN = 0.05;

	// eventTimes sind jetzt echte Zeit-Werte (Tick -> Zeit via ttm).
	let eventTimes = eventTimesTicks.map((tk) => ttm.tickToTime(tk));

	// TEIL C (REST-PRECISION-PLAN): mit kompaktierter Geometrie werden ALLE
	// sichtbaren Stücke berücksichtigt (kein kThresholdDiff-Filter nötig -
	// die Kompaktierung klumpt die Stücke räumlich zusammen, sodass der
	// Rahmen automatisch kompakt bleibt). Anker = größte Fläche (schwerste
	// Gruppe) für ruhige Kamera, wie buildCompactionMap().
	//
	// TEIL B: robuste Bounding-Box ( Float-Auslöschung bei Tiefe 22+ ):
	// die kompaktierten Rects (zoom_rect_lookup) sind Float-sicher, da sie
	// auf computeSegmentBlend basieren (keine absoluten p.x).
	let bank_zoom_states = new Array(eventTimes.length);
	for (let i = 0; i < eventTimes.length; i++) {
		let t = eventTimes[i];
		let area = 0;
		let visibleNow = bank_pieces.filter(
			(p) => t >= p.born_time && t < p.cut_time && t < p.taken_time,
		);
		if (visibleNow.length === 0) {
			bank_zoom_states[i] = { z: 1, cx: 0.5, cy: 0.5, offsetX: 0, offsetY: 0, area: 1 };
			continue;
		}
		// Anker = schwerste Gruppe (max w*h) für ruhige Kamera.
		// Kompaktierte Geometrie via zoom_rect_lookup (C¹ via computeSegmentBlend).
		let anchor = visibleNow[0];
		let anchorRect = null;
		let bestMass = -1;
		for (let p of visibleNow) {
			area += p.w * p.h;
			let r = zoom_rect_lookup(p, t);
			if (r && r.w * r.h > bestMass) {
				bestMass = r.w * r.h;
				anchor = p;
				anchorRect = r;
			}
		}
		if (!anchorRect) {
			bank_zoom_states[i] = { z: 1, cx: 0.5, cy: 0.5, offsetX: 0, offsetY: 0, area: 1 };
			continue;
		}
		let minRelX = 0,
			maxRelX = 0,
			minRelY = 0,
			maxRelY = 0;
		for (let p of visibleNow) {
			let r = zoom_rect_lookup(p, t);
			if (!r) continue;
			// Relativ zum Anker im kompaktierten Raum (Anker sitzt bei 0,0).
			let relW = anchorRect.w > 0 ? r.w / anchorRect.w : 1;
			let relH = anchorRect.h > 0 ? r.h / anchorRect.h : 1;
			let x0 = (r.x - anchorRect.x) / anchorRect.w;
			let y0 = (r.y - anchorRect.y) / anchorRect.h;
			let x1 = x0 + relW;
			let y1 = y0 + relH;
			if (x0 < minRelX) minRelX = x0;
			if (x1 > maxRelX) maxRelX = x1;
			if (y0 < minRelY) minRelY = y0;
			if (y1 > maxRelY) maxRelY = y1;
		}
		let cx_frame = (minRelX + maxRelX) / 2;
		let cy_frame = (minRelY + maxRelY) / 2;
		// Mittelpunkt IM RELATIVSYSTEM des Ankers (Anker sitzt bei 0,0).
		let cx = cx_frame;
		let cy = cy_frame;
		let halfW = Math.max((maxRelX - minRelX) / 2, 1e-9) * (1 + ZOOM_MARGIN);
		let halfH = Math.max((maxRelY - minRelY) / 2, 1e-9) * (1 + ZOOM_MARGIN);
		let z = Math.min(0.5 / halfW, 0.5 / halfH);
		let offsetX = 0.5 - cx * z,
			offsetY = 0.5 - cy * z;
		bank_zoom_states[i] = { z, cx, cy, offsetX, offsetY, area };
	}

	// buildDampedFilterBundle() statt buildMonotoneSplineBundle(): der
	// Bank-Zoom hat bis zu MAX_CHECKPOINTS=400 dicht getaktete Wegpunkte
	// (oft nur einen Tick auseinander) - eine exakte Spline reagiert auf
	// JEDEN davon sofort, was sich als unruhige/zappelige Bewegung zeigt.
	// Der Bank-Zoom BRAUCHT diese Exaktheit auch gar nicht: sein
	// Sicherheitsbeweis ("Konvexkombination bereits sicherer Positionen
	// bleibt sicher") gilt für JEDE Zeitkonstante TAU, siehe README
	// Abschnitt 6.1 - anders als beim Auto-Zoom-Exponenten oben (dort MUSS
	// jeder Wegpunkt exakt getroffen werden). Der Koeffizient (Anteil von
	// local_max_time) ist einstellbar (zoomSpeedCoef, "Trägheit").
	const BANK_ZOOM_TAU = Math.max(local_max_time * zoomSpeedCoef, 0.5);
	let GLOBAL_BANK_ZOOM_SPLINE = buildDampedFilterBundle(
		eventTimes.map((t, i) => ({ t, ...bank_zoom_states[i] })),
		['z', 'offsetX', 'offsetY', 'area'],
		BANK_ZOOM_TAU,
	);

	// Kompaktierung ("Zeilen/Spalten ausblenden", siehe bank-core.js TEIL 2)
	// - nur berechnet, wenn die Einstellung aktiv ist (nicht kostenlos bei
	// tiefer Rekursion). Ersetzt bei aktiver Kompaktierung den obigen
	// bankT-basierten Auto-Zoom für die Bank-Darstellung vollständig (siehe
	// project() in renderFrame()) - beide Modi sind bewusst gegenseitig
	// exklusiv, analog zum Algorithmus-Spiel-Tool.
	let GLOBAL_COMPACTION_WAYPOINTS = [];
	let GLOBAL_COMPACTION_LOGICAL_LOOKUP = null;
	let GLOBAL_COMPACTION_FIT_SPLINE = null;
	if (compactionEnabled) {
		// transitionTicks einstellbar (siehe README Abschnitt 6.2 "Siebte
		// Voraussetzung") - Default hier niedriger als der Bibliotheks-
		// Default in bank-core.js (weniger Wartezeit bis eine Lücke
		// sichtbar schließt).
		GLOBAL_COMPACTION_WAYPOINTS = compaction_waypoints;
		// Schnell/exakt: "wo steht jedes Stück im kompaktierten Layout"
		// (computeSegmentBlend()-basiert, für die Nichtüberlappungs-
		// Garantie - siehe bank-core.js).
		GLOBAL_COMPACTION_LOGICAL_LOOKUP = makeCompactedLogicalRectLookup(GLOBAL_COMPACTION_WAYPOINTS);
		// Gedämpft: "wie wird das Layout aufs [0,1]-Fenster gezoomt" -
		// dieselbe (einstellbare) Zeitkonstante wie beim regulären
		// Bank-Zoom oben, UNABHÄNGIG von den schnellen Logical-Rects.
		// Sicherheit bleibt erhalten, weil JEDE gemeinsame affine
		// Skalierung+Verschiebung Nichtüberlappung bewahrt, siehe
		// computeCompactionFitStates()-Kommentar.
		GLOBAL_COMPACTION_FIT_SPLINE = buildDampedFilterBundle(
			computeCompactionFitStates(GLOBAL_COMPACTION_WAYPOINTS),
			['z', 'offsetX', 'offsetY'],
			BANK_ZOOM_TAU,
		);
	}

	return {
		axes,
		TOTAL_STEPS,
		bank_pieces,
		render_pipeline,
		GLOBAL_N_ARR,
		P_FINAL,
		GLOBAL_L_PREFIX,
		GRID,
		K_MAX,
		AREA_SCALE,
		GLOBAL_SHELL_START,
		GLOBAL_TTM: ttm,
		GLOBAL_AUTO_ZOOM_CHECKPOINTS,
		GLOBAL_AUTO_ZOOM_SPLINE,
		GLOBAL_BANK_ZOOM_TIMES: eventTimes,
		GLOBAL_BANK_ZOOM: bank_zoom_states,
		GLOBAL_BANK_ZOOM_SPLINE,
		COMPACTION_ENABLED: compactionEnabled,
		GLOBAL_COMPACTION_WAYPOINTS,
		GLOBAL_COMPACTION_LOGICAL_LOOKUP,
		GLOBAL_COMPACTION_FIT_SPLINE,
		// TEIL C: Zoom-Wegpunkte + Rect-Lookup für den Zoom-Pfad (immer
		// berechnet, unabhängig vom compactionEnabled Render-Modus).
		zoom_waypoints,
		zoom_rect_lookup,
		MAX_TIME: local_max_time,
		BASE: data.BASE,
	};
}

// Kompatibilitäts-Wrapper: behält das alte Verhalten 1:1 bei (Node-Kontext
// ohne Worker, Fallback, bestehende Tests).
export function compileSystem(config) {
	return finalizeCompiled(compileSystemData(config));
}

// Laufende Seitenlänge l und Rest R zur Zeit `time`, EXAKT ohne Wurzel
// direkt aus der Simulation abgeleitet (Teil A des REST-PRECISION-PLANs).
// Verstößt damit gegen die alte, falsche Herleitung (R aus Float-Flächen
// summieren, dann l = sqrt(2-R) zurückschließen) - siehe AGENTS.md:
// l wird aus den STELLEN der Simulation abgelesen, R aus der ZÄHLUNG des
// Rests, beide unabhängig, keine eigene Umrechnung.
//
//   l(t)   = Σ_{i=0}^{Step-1} BASE^(-axes[i].exp)   (Präfixsumme über
//             die Achsen bis zur letzten vollständig abgeschlossenen Schale
//             Step - eine TREPPENFUNKTION über abgeschlossene Schalen, keine
//             Interpolation). Als BigInt (mit Nenner GRID=BASE^N_MAX):
//             N_l = GLOBAL_L_PREFIX[Step].
//
//   R(t)   = Σ BASE^(-p.k)  über alle zum Zeitpunkt t sichtbaren
//             Bank-Stücke (gleicher Sichtbarkeits-Filter wie früher). Als
//             BigInt (mit Nenner AREA_SCALE=BASE^K_MAX):
//             N_R = Σ BASE^(K_MAX - p.k).
//
// Beide Nenner und die Präfixsumme kommen aus compileSystemData() - hier
// läuft NUR ein Array-Lookup (l) plus eine Summe über die sichtbaren
// Stücke (R), O(sichtbare Stücke), NICHT die heisse isolationScore-Schleife.
//
// l² = N_l * N_l (exakte BigInt-Multiplikation) - sobald l exakt ist, ist
// auch l² exakt. l und R werden UNABHÄNGIG berechnet (verschiedene
// Quellen: axes-Präfix vs. p.k der sichtbaren Stücke) - die geometrische
// Verwandtschaft (l² + 2·R ≈ 2 bis auf die Tiefen-Abschneidung der
// letzten Ziffernstelle) ist damit ein scharfer Korrektheitstest, KEIN
// Berechnungsweg für R (R wird NICHT als 2 - l² hergeleitet, was
// AGENTS.md für R explizit ausschließt).
//
// Rückgabe: { N_l, N_R, GRID, AREA_SCALE, Step } - alles BigInt bis auf
// Step (Schalenindex). Zur Info: l = N_l/GRID (float), l² = (N_l*N_l)/GRID².
export function computeLiveL(compiled, time, BASE) {
	const {
		GLOBAL_L_PREFIX,
		GRID,
		AREA_SCALE,
		bank_pieces,
		GLOBAL_SHELL_START,
		K_MAX,
		MAX_TIME,
		BASE: BASE_OUT,
	} = compiled;

	// Höchste Schale Step, deren Startzeit erreicht ist. Schale 0 startet bei
	// t=0; jede Schale startet erst, wenn die vorige fertig ist - Schalen
	// 0..Step-1 sind damit garantiert vollständig abgeschlossen.
	// GLOBAL_L_PREFIX[Step] ist die exakte Präfixsumme bis dorthin.
	// Am Animationsende (time >= MAX_TIME) ist die letzte Schale ebenfalls
	// abgeschlossen -> Step = TOTAL_STEPS, die volle Präfixsumme
	// (exakt sqrt(2) bis N_MAX Stellen, siehe Testkriterium 3).
	let Step = 0;
	for (let S = 1; S < GLOBAL_SHELL_START.length; S++) {
		if (time >= GLOBAL_SHELL_START[S]) Step = S;
		else break;
	}
	if (MAX_TIME !== undefined && time >= MAX_TIME) Step = GLOBAL_L_PREFIX.length - 1;
	if (Step > GLOBAL_L_PREFIX.length - 1) Step = GLOBAL_L_PREFIX.length - 1;

	// l exakt: reine Präfixsumme (BigInt), kein Float, keine Wurzel.
	let N_l = GLOBAL_L_PREFIX[Step];

	// R exakt: Summe über sichtbare Bank-Stücke, Nenner AREA_SCALE.
	// Sichtbar: born_time <= t < cut_time UND t < taken_time (noch nicht
	// ins Ziel entnommen). Partitioniert das Einheitsquadrat ohne Überlapp.
	const BASE_BIG = BigInt(BASE_OUT);
	let N_R = 0n;
	for (let p of bank_pieces) {
		if (time >= p.born_time && time < p.cut_time && time < p.taken_time) {
			N_R += AREA_SCALE / BASE_BIG ** BigInt(p.k);
		}
	}

	return { N_l, N_R, GRID, AREA_SCALE, Step };
}
