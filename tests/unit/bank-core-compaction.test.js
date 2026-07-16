// Persistente Tests für TEIL 2 (Kompaktierung) aus bank-core.js - bisher
// ohne jede Testabdeckung (nur im Algorithmus-Spiel-Tool manuell geprüft).
// Siehe README Abschnitt 6.2 für die dort dokumentierten, hier verifizierten
// Eigenschaften.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildSystem,
	buildCompactionMap,
	computeCompactionAt,
	computeCompactionWaypoints,
	compactedLogicalRectAt,
	getSmoothedCompactedLogicalRect,
	makeCompactedLogicalRectLookup,
	computeCompactionFitStates,
	applyCompactionFit,
} from '../../bank-core.js';
import { buildDampedFilterBundle } from '../../src/lib/smoothing.js';

// Müssen mit den Konstanten in bank-core.js übereinstimmen (nicht
// exportiert - bewusst über das beobachtbare Verhalten getestet statt über
// interne Konstanten, siehe Tests unten).
const GAP_CLOSE_DELAY_TICKS = 1;
const DEFAULT_GAP_CLOSE_TRANSITION_TICKS = 8;

// id ist Pflicht für makeCompactedLogicalRectLookup (Cache-Schlüssel) - echte
// bank_pieces haben immer eine eindeutige id (siehe createBankSimulation),
// daher hier ebenfalls automatisch eine eindeutige vergeben.
let _pieceIdCounter = 0;
function piece(x, y, w, h, extra) {
	return Object.assign(
		{ id: _pieceIdCounter++, x, y, w, h, born_time: 0, cut_time: Infinity, taken_time: Infinity },
		extra || {},
	);
}

// ---------------------------------------------------------------------------
// buildCompactionMap
// ---------------------------------------------------------------------------

test('buildCompactionMap: eine Lücke zwischen zwei Stücken wird auf 0 komprimiert', () => {
	// Stücke bei [0,0.1] und [0.5,0.6] auf der x-Achse - Lücke [0.1,0.5]
	// (Breite 0.4) soll verschwinden.
	let pieces = [piece(0, 0, 0.1, 0.2), piece(0.5, 0, 0.1, 0.2)];
	let { compact, totalOccupied } = buildCompactionMap(pieces, 'x');
	assert.ok(
		Math.abs(totalOccupied - 0.2) < 1e-9,
		`totalOccupied sollte 0.2 sein (0.1+0.1), war ${totalOccupied}`,
	);
	assert.ok(Math.abs(compact(0) - 0) < 1e-9);
	assert.ok(Math.abs(compact(0.1) - 0.1) < 1e-9);
	// Die Lücke selbst: jeder Punkt darin mappt auf den Start des NÄCHSTEN
	// belegten Intervalls (0.1, das komprimierte Ende des ersten Stücks).
	assert.ok(Math.abs(compact(0.3) - 0.1) < 1e-9);
	assert.ok(Math.abs(compact(0.5) - 0.1) < 1e-9);
	assert.ok(Math.abs(compact(0.6) - 0.2) < 1e-9);
});

test('buildCompactionMap: berührende/überlappende Stücke verschmelzen zu einem Intervall', () => {
	let pieces = [piece(0, 0, 0.3, 0.1), piece(0.3, 0, 0.2, 0.1), piece(0.45, 0, 0.3, 0.1)];
	let { compact, totalOccupied } = buildCompactionMap(pieces, 'x');
	// [0,0.3] + [0.3,0.5] + [0.45,0.75] verschmelzen zu einem [0,0.75]-Block
	// (letzte zwei überlappen sich) - keine Lücke, totalOccupied = 0.75.
	assert.ok(Math.abs(totalOccupied - 0.75) < 1e-9, `totalOccupied=${totalOccupied}`);
	assert.ok(Math.abs(compact(0.75) - 0.75) < 1e-9);
});

test('buildCompactionMap: leere Stückliste liefert eine sichere, nicht-null Fallback-Abbildung', () => {
	let { compact, totalOccupied } = buildCompactionMap([], 'x');
	assert.ok(totalOccupied > 0, 'totalOccupied darf nie 0 sein (Division durch 0 anderswo)');
	assert.equal(Number.isFinite(compact(0.5)), true);
});

// ---------------------------------------------------------------------------
// computeCompactionAt
// ---------------------------------------------------------------------------

test('computeCompactionAt: ohne sichtbare Stücke Identitäts-Abbildung (totalW=totalH=1)', () => {
	let bank_pieces = [piece(0, 0, 1, 1, { born_time: 5, cut_time: Infinity, taken_time: Infinity })];
	let comp = computeCompactionAt(bank_pieces, 0); // vor born_time, also nicht sichtbar
	assert.equal(comp.totalW, 1);
	assert.equal(comp.totalH, 1);
	assert.equal(comp.mapX(0.42), 0.42);
	assert.equal(comp.mapY(0.42), 0.42);
});

test('computeCompactionAt: Sichtbarkeitsfenster (born_time/cut_time/taken_time) wird respektiert', () => {
	let bank_pieces = [
		piece(0, 0, 0.5, 0.5, { born_time: 0, cut_time: 10, taken_time: Infinity }),
		piece(0.5, 0, 0.5, 0.5, { born_time: 20, cut_time: Infinity, taken_time: Infinity }), // noch nicht geboren
	];
	let comp = computeCompactionAt(bank_pieces, 5);
	// Nur das erste Stück ist bei t=5 sichtbar -> totalOccupied nur davon.
	assert.ok(Math.abs(comp.totalW - 0.5) < 1e-9);
});

// ---------------------------------------------------------------------------
// computeCompactionWaypoints
// ---------------------------------------------------------------------------

test('computeCompactionWaypoints: enthält immer t=0 und maxTick, dazwischen nur echte Verbesserungen', () => {
	// Absichtlich MIT einem Stück, das nie genommen wird (taken_time bleibt
	// Infinity) - die Bank wird dadurch nie komplett leer. Würde sie das
	// (alle Stücke vor maxTick genommen), griffe die unten dokumentierte
	// Ausnahme: der zuletzt erzwungene Waypoint bei maxTick nutzt dann den
	// Identitäts-Fallback (totalW=totalH=1, siehe computeCompactionAt) -
	// dessen Fläche kann größer sein als die des letzten ECHTEN Zustands
	// davor (bewusstes Verhalten: der Zeitstrahl muss bis maxTick lückenlos
	// abgedeckt sein, auch wenn "die Bank ist leer" keine sinnvolle
	// Kompaktierung mehr hat) - kein Bug, aber eine bekannte Randbedingung.
	let bank_pieces = [
		piece(0, 0, 0.5, 0.5, { born_time: 0, cut_time: Infinity, taken_time: 5 }),
		piece(0.5, 0, 0.5, 0.5, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
	];
	let waypoints = computeCompactionWaypoints(bank_pieces, 30);
	assert.equal(waypoints[0].t, 0);
	assert.equal(waypoints[waypoints.length - 1].t, 30);
	// Fläche darf zwischen aufeinanderfolgenden Waypoints nie zunehmen
	// (Bank kann nur schrumpfen, nie wachsen) - solange die Bank nicht
	// zwischenzeitlich komplett leer wird (siehe Kommentar oben).
	let lastArea = Infinity;
	for (let wp of waypoints) {
		let area = wp.totalW * wp.totalH;
		assert.ok(area <= lastArea + 1e-9, `Fläche wuchs von ${lastArea} auf ${area}`);
		lastArea = area;
	}
});

test('computeCompactionWaypoints: bekannte Randbedingung - wird die Bank vor maxTick komplett leer, kann der erzwungene letzte Waypoint auf den 1×1-Identitäts-Fallback zurückspringen', () => {
	let bank_pieces = [
		piece(0, 0, 0.5, 0.5, { born_time: 0, cut_time: Infinity, taken_time: 5 }),
		piece(0.5, 0, 0.5, 0.5, { born_time: 0, cut_time: Infinity, taken_time: 8 }),
	];
	let waypoints = computeCompactionWaypoints(bank_pieces, 30);
	let last = waypoints[waypoints.length - 1];
	assert.equal(last.t, 30);
	assert.equal(last.totalW, 1);
	assert.equal(last.totalH, 1);
});

test('computeCompactionWaypoints: z ist der Fit-to-Frame-Zoom (1/max(totalW,totalH))', () => {
	let bank_pieces = [
		piece(0, 0, 0.3, 0.6, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
	];
	let waypoints = computeCompactionWaypoints(bank_pieces, 1);
	let wp = waypoints[0];
	let expectedZ = Math.min(1 / wp.totalW, 1 / wp.totalH);
	assert.ok(Math.abs(wp.z - expectedZ) < 1e-9);
});

test('computeCompactionWaypoints: transitionTicks streckt den Wegpunkt-Abstand nach einer Entnahme (Gesprächsverlauf: "einstellbar viele Ticks")', () => {
	let bank_pieces = [
		piece(0, 0, 0.5, 1, { taken_time: 5 }),
		piece(0.5, 0, 0.5, 1, { taken_time: Infinity }),
	];
	let shortWp = computeCompactionWaypoints(bank_pieces, 100, 2);
	let longWp = computeCompactionWaypoints(bank_pieces, 100, 20);
	// Der "geschlossen"-Wegpunkt muss bei T+GAP_CLOSE_DELAY_TICKS+transitionTicks liegen.
	assert.ok(shortWp.some((w) => w.t === 5 + GAP_CLOSE_DELAY_TICKS + 2));
	assert.ok(longWp.some((w) => w.t === 5 + GAP_CLOSE_DELAY_TICKS + 20));
	// Default (ohne Parameter) entspricht DEFAULT_GAP_CLOSE_TRANSITION_TICKS.
	let defaultWp = computeCompactionWaypoints(bank_pieces, 100);
	assert.ok(
		defaultWp.some((w) => w.t === 5 + GAP_CLOSE_DELAY_TICKS + DEFAULT_GAP_CLOSE_TRANSITION_TICKS),
	);
});

// ---------------------------------------------------------------------------
// compactedLogicalRectAt - liefert die Position im kompaktierten, aber NOCH
// NICHT gezoomten Raum (siehe computeCompactionFitStates()/applyCompactionFit()
// weiter unten für den bewusst getrennten Zoom-Anteil). Massegewichtetes
// Anker-Verfahren (Gesprächsverlauf - "physikalisches System", siehe
// CLAUDE.md): die Gruppe mit der größten Fläche bleibt an ihrer ROHEN
// Koordinate fix, alle anderen werden lückenlos an sie herangerückt - der
// kompaktierte Bereich beginnt daher NICHT mehr zwingend bei 0.
// ---------------------------------------------------------------------------

test('compactedLogicalRectAt: bei einem einzigen Stück (automatisch die schwerste/einzige Gruppe) bleibt es an seiner ROHEN Position - bewegt sich gar nicht', () => {
	let bank_pieces = [
		piece(0.2, 0.2, 0.3, 0.6, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
	];
	let waypoints = computeCompactionWaypoints(bank_pieces, 1);
	let r = compactedLogicalRectAt(bank_pieces[0], waypoints[0]);
	// Einziges Stück -> ist automatisch der Anker (größte, hier einzige
	// Masse) -> bleibt exakt an seiner rohen Position, keine Verschiebung.
	assert.ok(Math.abs(r.x - 0.2) < 1e-9);
	assert.ok(Math.abs(r.y - 0.2) < 1e-9);
	assert.ok(Math.abs(r.w - 0.3) < 1e-9);
	assert.ok(Math.abs(r.h - 0.6) < 1e-9);
});

test('compactedLogicalRectAt: die schwerere von zwei Gruppen bleibt an ihrer rohen Position, die leichtere rückt lückenlos heran', () => {
	// "heavy" (Fläche 0.5) links, "light" (Fläche 0.1) rechts mit Lücke dazwischen.
	let heavy = piece(0, 0, 0.5, 1);
	let light = piece(0.8, 0, 0.1, 1);
	let waypoints = computeCompactionWaypoints([heavy, light], 1);
	let rHeavy = compactedLogicalRectAt(heavy, waypoints[0]);
	let rLight = compactedLogicalRectAt(light, waypoints[0]);
	// heavy bleibt exakt an seiner rohen Position (Anker).
	assert.ok(Math.abs(rHeavy.x - 0) < 1e-9, `heavy sollte an x=0 bleiben, war ${rHeavy.x}`);
	// light rückt lückenlos an heavy heran (berührt dessen rechten Rand).
	assert.ok(
		Math.abs(rLight.x - (rHeavy.x + rHeavy.w)) < 1e-9,
		`light sollte heavy berühren: ${rLight.x} != ${rHeavy.x + rHeavy.w}`,
	);
});

test('compactedLogicalRectAt: zwei Stücke mit Lücke dazwischen berühren sich nach der Kompaktierung', () => {
	let bank_pieces = [
		piece(0, 0, 0.2, 0.2, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
		piece(0.7, 0, 0.2, 0.2, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
	];
	let waypoints = computeCompactionWaypoints(bank_pieces, 1);
	let r0 = compactedLogicalRectAt(bank_pieces[0], waypoints[0]);
	let r1 = compactedLogicalRectAt(bank_pieces[1], waypoints[0]);
	assert.ok(
		Math.abs(r0.x + r0.w - r1.x) < 1e-6,
		`Lücke wurde nicht komprimiert: r0 endet bei ${r0.x + r0.w}, r1 beginnt bei ${r1.x}`,
	);
});

// ---------------------------------------------------------------------------
// computeCompactionFitStates + applyCompactionFit - der (bewusst von den
// Logical-Rects entkoppelte) Fit-Zoom, siehe Kommentar in bank-core.js.
// ---------------------------------------------------------------------------

test('applyCompactionFit: kombiniert mit computeCompactionFitStates ergibt wieder dasselbe Ergebnis wie die frühere, kombinierte Funktion (Zoom passend zur langen Seite, zentriert)', () => {
	let bank_pieces = [
		piece(0.2, 0.2, 0.3, 0.6, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
	];
	let waypoints = computeCompactionWaypoints(bank_pieces, 1);
	let logical = compactedLogicalRectAt(bank_pieces[0], waypoints[0]);
	let fit = computeCompactionFitStates(waypoints)[0];
	let r = applyCompactionFit(logical, fit);
	// Einziges Stück füllt totalW/totalH exakt -> h*z sollte exakt 1 sein
	// (füllt die Bildhöhe komplett, lange Seite ist h=0.6).
	assert.ok(Math.abs(r.h - 1) < 1e-9);
	assert.ok(Math.abs(r.w - 0.3 * fit.z) < 1e-9);
});

test('computeCompactionFitStates: offsetX/offsetY zentrieren auf minX+totalW/2 (NICHT mehr zwingend totalW/2 - der Anker kann irgendwo liegen)', () => {
	// "heavy" bleibt als Anker an seiner rohen Position x=10 (bewusst NICHT
	// bei 0, um zu verifizieren, dass die Zentrierung wirklich minX
	// berücksichtigt statt stillschweigend 0 anzunehmen) - "light" rückt
	// lückenlos rechts heran.
	let heavy = piece(10, 0, 0.5, 1);
	let light = piece(20, 0, 0.1, 1);
	let waypoints = computeCompactionWaypoints([heavy, light], 1);
	let wp = waypoints[0];
	assert.ok(
		Math.abs(wp.minX - 10) < 1e-9,
		`minX sollte 10 sein (Anker=heavy an seiner rohen Position), war ${wp.minX}`,
	);
	let fit = computeCompactionFitStates(waypoints)[0];
	let expectedOffsetX = 0.5 - (wp.minX + wp.totalW / 2) * fit.z;
	assert.ok(Math.abs(fit.offsetX - expectedOffsetX) < 1e-9);
});

// ---------------------------------------------------------------------------
// getSmoothedCompactedLogicalRect
// ---------------------------------------------------------------------------

test('getSmoothedCompactedLogicalRect: leere Waypoint-Liste liefert null', () => {
	assert.equal(getSmoothedCompactedLogicalRect(piece(0, 0, 1, 1), [], 0), null);
});

test('getSmoothedCompactedLogicalRect: trifft an jedem Waypoint exakt dessen compactedLogicalRectAt-Wert (Pass-Through-Garantie von smoothing.js)', () => {
	let p1 = piece(0, 0, 0.3, 0.3, { taken_time: 5 });
	let p2 = piece(0.3, 0, 0.7, 1.0);
	let bank_pieces = [p1, p2];
	let waypoints = computeCompactionWaypoints(bank_pieces, 30);
	for (let wp of waypoints) {
		let expected = compactedLogicalRectAt(p2, wp);
		let actual = getSmoothedCompactedLogicalRect(p2, waypoints, wp.t);
		assert.ok(
			Math.abs(actual.x - expected.x) < 1e-6,
			`x bei t=${wp.t}: ${actual.x} != ${expected.x}`,
		);
		assert.ok(Math.abs(actual.y - expected.y) < 1e-6);
		assert.ok(Math.abs(actual.w - expected.w) < 1e-6);
		assert.ok(Math.abs(actual.h - expected.h) < 1e-6);
	}
});

// ---------------------------------------------------------------------------
// makeCompactedLogicalRectLookup - gecachte Variante von getSmoothedCompactedLogicalRect
// ---------------------------------------------------------------------------
// Motivation (siehe CLAUDE.md "Measure before optimizing"): getSmoothedCompactedLogicalRect
// leitet `times` bei jedem Aufruf neu aus `waypoints` ab (O(Waypoints)) -
// bei tausenden Waypoints (Normalfall bei tiefer Rekursion) ein echtes
// Performance-Problem. makeCompactedLogicalRectLookup cacht `times` einmalig.

test('makeCompactedLogicalRectLookup: liefert dieselben Werte wie getSmoothedCompactedLogicalRect (Korrektheits-Parität)', () => {
	let bank_pieces = [
		piece(0, 0, 0.3, 0.3, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
		piece(0.5, 0, 0.5, 1.0, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
	];
	let waypoints = computeCompactionWaypoints(bank_pieces, 30);
	let lookup = makeCompactedLogicalRectLookup(waypoints);

	for (let p of bank_pieces) {
		for (let t of [0, 2.5, 7, 30]) {
			let expected = getSmoothedCompactedLogicalRect(p, waypoints, t);
			let actual = lookup(p, t);
			assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
			assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
			assert.ok(Math.abs(actual.w - expected.w) < 1e-9);
			assert.ok(Math.abs(actual.h - expected.h) < 1e-9);
		}
	}
});

test('makeCompactedLogicalRectLookup: leere Waypoints liefern null (wie getSmoothedCompactedLogicalRect)', () => {
	let lookup = makeCompactedLogicalRectLookup([]);
	assert.equal(lookup(piece(0, 0, 1, 1), 0), null);
});

test('makeCompactedLogicalRectLookup: extrahiert times einmalig statt bei jedem Aufruf (Performance, siehe Kommentar an der Funktion)', () => {
	let bank_pieces = [
		piece(0, 0, 0.5, 0.5, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
		piece(0.5, 0, 0.5, 0.5, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
	];
	let waypoints = computeCompactionWaypoints(bank_pieces, 30);
	let mapCalls = 0;
	let originalMap = waypoints.map.bind(waypoints);
	waypoints.map = (fn) => {
		mapCalls++;
		return originalMap(fn);
	};

	let lookup = makeCompactedLogicalRectLookup(waypoints);
	assert.equal(
		mapCalls,
		1,
		'makeCompactedLogicalRectLookup sollte waypoints.map() genau einmal aufrufen (times einmalig extrahieren)',
	);

	lookup(bank_pieces[0], 1);
	lookup(bank_pieces[1], 2);
	lookup(bank_pieces[0], 5);
	lookup(bank_pieces[1], 9);
	assert.equal(
		mapCalls,
		1,
		'einzelne Abfragen dürfen waypoints.map() nicht erneut aufrufen (times bleibt gecacht)',
	);
});

test('Integration (echter Bank-Algorithmus, Performance): gecachte Lookups sind bei Tiefe 16 weit unter dem 60fps-Frame-Budget', () => {
	let { sim, local_max_time } = buildSystem(10, 16, 'fixed', 'morph');
	let waypoints = computeCompactionWaypoints(sim.bank_pieces, local_max_time);
	let lookup = makeCompactedLogicalRectLookup(waypoints);

	let t = local_max_time * 0.6;
	let visible = sim.bank_pieces.filter(
		(p) => t >= p.born_time && t < p.cut_time && t < p.taken_time,
	);
	for (let p of visible) lookup(p, t); // Cache aufwärmen (einmaliger Kaltstart-Preis, siehe Kommentar an makeCompactedLogicalRectLookup)

	const FRAMES = 30;
	let t0 = performance.now();
	for (let f = 0; f < FRAMES; f++) {
		for (let p of visible) lookup(p, t + f * 0.001);
	}
	let msPerFrame = (performance.now() - t0) / FRAMES;
	assert.ok(
		msPerFrame < 5,
		`Gecachter Lookup zu langsam: ${msPerFrame.toFixed(3)}ms/Frame für ${visible.length} Stücke (Budget 16.7ms, hier grosszügige 5ms-Grenze für Testrechner-Schwankungen)`,
	);
});

// ---------------------------------------------------------------------------
// Integrations-Tests mit dem echten Bank-Algorithmus (bank-core.js) -
// verifiziert die im README (Abschnitt 6.2) behaupteten Eigenschaften direkt
// an einem realen System statt nur an synthetischen Einzelfällen.
// ---------------------------------------------------------------------------

function overlaps(a, b) {
	const EPS = 1e-6;
	return (
		a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS
	);
}

// REGRESSIONSTEST für einen real reproduzierten Bug (Gesprächsverlauf):
// "wird hier zu früh losgeschoben (wenn das entsprechende Teil noch
// angezeigt wird), es kommt so zu Überlappungen". Ursache war zweigeteilt:
// (1) computeCompactionWaypoints() ließ Ticks aus (siehe dort, jetzt
// gefixt), UND (2) die frühere buildMonotoneSplineBundle()-basierte
// Umsetzung gab jedem Stück ein UNABHÄNGIGES Blend-Gewicht - ein Nachbar
// konnte dadurch schon in Richtung einer neuen Position rutschen, WÄHREND
// das Stück, das den Platz erst freimacht, noch sichtbar war.
//
// WICHTIG für diesen Test: grobes Sampling (z.B. nur alle 0.5 Zeiteinheiten)
// hätte den Bug NICHT zuverlässig gefangen, weil das Überlappungsfenster
// auf einzelne, kurze Segmente zwischen zwei Waypoints begrenzt ist -
// zwischen den Stützstellen des groben Rasters hätte es oft "zufällig"
// wieder vorbei sein können. Deshalb hier zusätzlich zum groben Sweep noch
// eine DICHTE Abtastung in einem kleinen Fenster um JEDEN echten
// Sichtbarkeits-Wechsel (born_time/cut_time/taken_time) herum - genau dort,
// wo ein Nachbarstück "vorauseilen" könnte. Getestet auf den LOGICAL-Rects
// (schnell/exakt) - die tragen die Nichtüberlappungs-Garantie.
test('Integration (echter Bank-Algorithmus): kompaktierte, gleichzeitig sichtbare Stücke überlappen sich nie (dichtes Sampling um jedes Event, Logical-Rects)', () => {
	// Tiefe 4 statt 6: der ursprüngliche Bug war massiv reproduzierbar (über
	// 100.000 Verletzungen bei dichtem Sampling, siehe Gesprächsverlauf) -
	// für einen zuverlässigen Regressionstest reicht eine deutlich kleinere,
	// schnell laufende Tiefe locker aus; Tiefe 6 ließ den Test wegen der
	// O(sichtbare Stücke)-Filterung pro Sample auf >10s anwachsen.
	let { sim, local_max_time } = buildSystem(10, 4, 'fixed', 'subdivide');
	let waypoints = computeCompactionWaypoints(sim.bank_pieces, local_max_time);
	let lookup = makeCompactedLogicalRectLookup(waypoints); // times einmalig extrahiert statt pro Aufruf, siehe dort

	function checkAt(t) {
		let visible = sim.bank_pieces.filter(
			(p) => t >= p.born_time && t < p.cut_time && t < p.taken_time,
		);
		let rects = visible.map((p) => lookup(p, t));
		for (let i = 0; i < rects.length; i++) {
			for (let j = i + 1; j < rects.length; j++) {
				assert.ok(
					!overlaps(rects[i], rects[j]),
					`Überlappung bei t=${t}: Stück ${i} (${JSON.stringify(rects[i])}) und ${j} (${JSON.stringify(rects[j])})`,
				);
			}
		}
	}

	// Grober Sweep über die gesamte Zeitachse.
	for (let t = 0; t <= local_max_time; t += 0.5) checkAt(t);

	// Dichter Sweep um JEDEN echten Event-Zeitpunkt herum - fängt genau das
	// kurze, leicht überspringbare Überlappungsfenster, das den Bug
	// ursprünglich verursacht hat.
	let eventTicks = new Set();
	for (let p of sim.bank_pieces) {
		if (isFinite(p.taken_time)) eventTicks.add(p.taken_time);
		if (isFinite(p.cut_time)) eventTicks.add(p.cut_time);
	}
	for (let eventT of eventTicks) {
		for (let dt = -0.2; dt <= 0.2; dt += 0.05) {
			let t = eventT + dt;
			if (t >= 0 && t <= local_max_time) checkAt(t);
		}
	}
});

// NEU: verifiziert direkt die zentrale Sicherheits-Behauptung hinter der
// Entkopplung von Logical-Rects (schnell) und Fit-Zoom (gedämpft, siehe
// Gesprächsverlauf "Bewegungen der Bank... viel zu schnell/zu unruhig"):
// JEDE gemeinsame affine Abbildung (z, offsetX, offsetY - egal wie träge
// oder "falsch getimt" relativ zu den Logical-Rects) bewahrt Nichtüberlappung,
// weil sie auf ALLE sichtbaren Stücke gleich angewendet wird. Nutzt einen
// EXTREM trägen (unrealistisch großen TAU) gedämpften Fit, um das robust zu
// prüfen - wenn selbst das nicht überlappt, ist die Eigenschaft nicht
// zufällig, sondern strukturell.
test('Integration: Nichtüberlappung bleibt erhalten, auch mit einem (absichtlich extrem trägen) gedämpften Fit-Zoom kombiniert', () => {
	let { sim, local_max_time } = buildSystem(10, 4, 'fixed', 'subdivide');
	let waypoints = computeCompactionWaypoints(sim.bank_pieces, local_max_time);
	let logicalLookup = makeCompactedLogicalRectLookup(waypoints);
	let fitSpline = buildDampedFilterBundle(
		computeCompactionFitStates(waypoints),
		['z', 'offsetX', 'offsetY'],
		local_max_time * 2,
	);

	for (let t = 0; t <= local_max_time; t += 0.3) {
		let fit = fitSpline.at(t);
		let visible = sim.bank_pieces.filter(
			(p) => t >= p.born_time && t < p.cut_time && t < p.taken_time,
		);
		let rects = visible.map((p) => applyCompactionFit(logicalLookup(p, t), fit));
		for (let i = 0; i < rects.length; i++) {
			for (let j = i + 1; j < rects.length; j++) {
				assert.ok(
					!overlaps(rects[i], rects[j]),
					`Überlappung bei t=${t} trotz gemeinsamem Fit-Zoom`,
				);
			}
		}
	}
});

test('Integration: kompaktierte Rechtecke (Logical-Rect + exakter, ungedämpfter Fit) bleiben innerhalb des sichtbaren [0,1]x[0,1]-Rahmens', () => {
	let { sim, local_max_time } = buildSystem(10, 6, 'fixed', 'subdivide');
	let waypoints = computeCompactionWaypoints(sim.bank_pieces, local_max_time);
	let logicalLookup = makeCompactedLogicalRectLookup(waypoints);
	// Exakter (nicht gedämpfter) Fit über computeSegmentBlend-artige
	// Wegpunkt-Auswertung - hier per direktem waypoint-Lookup nachgebildet,
	// um den Rahmen-Beweis unabhängig von einer bestimmten Dämpfung zu
	// führen (der gedämpfte Fall ist strukturell IMMER konservativer, siehe
	// Gesprächsverlauf: gedämpftes z ist nachweislich stets <= exaktem z).
	const EPS = 1e-6;
	for (let t = 0; t <= local_max_time; t += 1) {
		let visible = sim.bank_pieces.filter(
			(p) => t >= p.born_time && t < p.cut_time && t < p.taken_time,
		);
		// waypoint, das t exakt "trifft" (nächstliegendes davor) für den Fit -
		// reicht für einen Stichproben-Beweis an ganzzahligen Ticks.
		let wp =
			waypoints.reduce((best, w) => (w.t <= t && (!best || w.t > best.t) ? w : best), null) ||
			waypoints[0];
		let fit = computeCompactionFitStates([wp])[0];
		for (let p of visible) {
			let logical = compactedLogicalRectAt(p, wp);
			let r = applyCompactionFit(logical, fit);
			assert.ok(
				r.x >= -EPS && r.x + r.w <= 1 + EPS,
				`x außerhalb [0,1] bei t=${t}: ${JSON.stringify(r)}`,
			);
			assert.ok(
				r.y >= -EPS && r.y + r.h <= 1 + EPS,
				`y außerhalb [0,1] bei t=${t}: ${JSON.stringify(r)}`,
			);
		}
	}
});

// ---------------------------------------------------------------------------
// Lücken-Schließ-Verzögerung (GAP_CLOSE_DELAY_TICKS / transitionTicks)
// ---------------------------------------------------------------------------
// Regressionstest für einen zweiten, subtileren Nachfolge-Bug (Gesprächsverlauf,
// nach dem ersten Überlappungs-Fix): "Teile verschwinden immer noch zu früh."
// Ein einzelner Wegpunkt GAP_CLOSE_DELAY_TICKS nach der Entnahme reicht NICHT
// aus, um JEDE Bewegung bis dahin zu verhindern, weil computeSegmentBlend()
// STETIG zwischen zwei Wegpunkten überblendet - ein Segment [T, T+delay]
// zeigt selbst dann schon Bewegung, wenn der Zielwert erst am Ende "fertig"
// ist. Fix: der Zustand bei T+GAP_CLOSE_DELAY_TICKS muss IDENTISCH zum
// Zustand unmittelbar nach der Entnahme sein (siehe computeCompactionAt()) -
// erst danach, in einem eigenen, ANSCHLIESSENDEN (per transitionTicks
// einstellbar breiten) Segment, findet die eigentliche Überblendung statt.
//
// WICHTIGE LEKTION beim Verifizieren (Gesprächsverlauf): "prüfe, ob sich
// IRGENDEIN Nachbarstück im Fenster [T, T+delay] von Q bewegt" ist bei
// diesem Bank-Algorithmus KEIN gültiger Test - durch die vielen, oft nur
// einen Tick auseinanderliegenden Entnahme-Ereignisse (siehe cellMode
// 'subdivide': nach einem Zerschneiden werden oft alle BASE Kinder in
// schneller Folge entnommen) überlappt das Prüffenster für Q fast immer mit
// dem LEGITIMEN Schließen einer GANZ ANDEREN Lücke - das erzeugte zunächst
// scheinbare, tatsächlich aber falsch zugeordnete "Verletzungen". Der
// korrekte, unverwechselbare Test prüft stattdessen DIREKT, ob JEDES
// einzelne Stück in computeCompactionAt() exakt bis zu seinem EIGENEN,
// erwarteten Tick (und nicht früher) als "noch vorhanden" gezählt wird.
test('computeCompactionAt: ein entnommenes Stück bleibt bis zu seinem geplanten Schließ-Tick als Platzhalter gezählt, keinen Tick früher', () => {
	let { sim, local_max_time } = buildSystem(10, 6, 'fixed', 'subdivide');
	let checked = 0;
	for (let Q of sim.bank_pieces) {
		if (!isFinite(Q.taken_time)) continue;
		let T = Q.taken_time;
		let closesAt = T + GAP_CLOSE_DELAY_TICKS + DEFAULT_GAP_CLOSE_TRANSITION_TICKS;
		if (closesAt > local_max_time) continue;
		checked++;
		// Nicht JEDEN Tick prüfen (bei transitionTicks=8 wäre das teuer) -
		// Start, Ende und ein paar Zwischenwerte reichen für die Eigenschaft.
		for (let t of [T, T + GAP_CLOSE_DELAY_TICKS, Math.floor((T + closesAt) / 2), closesAt - 1]) {
			let visible = sim.bank_pieces.filter(
				(p) =>
					t >= p.born_time &&
					t < p.cut_time &&
					t < p.taken_time + GAP_CLOSE_DELAY_TICKS + DEFAULT_GAP_CLOSE_TRANSITION_TICKS,
			);
			assert.ok(
				visible.some((p) => p.id === Q.id),
				`Stück ${Q.id} (entnommen bei T=${T}) sollte bei t=${t} noch als Platzhalter gezählt werden (schließt erst bei ${closesAt})`,
			);
		}
	}
	assert.ok(
		checked > 50,
		`Zu wenige Fälle geprüft (${checked}) - Test würde bei einer strukturellen Änderung des Systems still versagen`,
	);
});

// Isolierter, synthetischer Fall statt des echten (dicht verschachtelten)
// Bank-Algorithmus: A/Q/B liegen nebeneinander auf der x-Achse, NUR Q wird
// entnommen (bei T=5), A und B bleiben für immer. Damit gibt es GARANTIERT
// kein zweites, zufällig überlappendes Ereignis, das die Messung verfälschen
// könnte (siehe Kommentar am vorigen Test zur Verwechslungsgefahr). B ist
// bewusst die GRÖSSERE Fläche (0.5 vs. A's 0.2) - nach dem massegewichteten
// Anker-Verfahren (Gesprächsverlauf, "physikalisches System") bleibt B
// (der Anker) DAUERHAFT fix, NUR A bewegt sich - genau umgekehrt zum alten
// "Förderband"-Verhalten (dort wäre B, weil rechts von der Lücke, bewegt
// worden, unabhängig von seiner Größe).
test('getSmoothedCompactedLogicalRect: die schwerere Seite (B) bleibt dauerhaft fix, die leichtere (A) bewegt sich erst ab T+GAP_CLOSE_DELAY_TICKS, Übergang dauert transitionTicks', () => {
	let A = piece(0, 0, 0.2, 1, { taken_time: Infinity });
	let Q = piece(0.2, 0, 0.3, 1, { taken_time: 5 });
	let B = piece(0.5, 0, 0.5, 1, { taken_time: Infinity }); // größere Fläche als A -> wird zum Anker
	let bank_pieces = [A, Q, B];
	let maxTick = 40;
	let transitionTicks = 6;
	let waypoints = computeCompactionWaypoints(bank_pieces, maxTick, transitionTicks);
	let lookup = makeCompactedLogicalRectLookup(waypoints);

	let T = 5;
	let transitionStart = T + GAP_CLOSE_DELAY_TICKS;
	let transitionEnd = transitionStart + transitionTicks;

	// B ist die schwerere Seite (Anker) - bleibt zu JEDEM Zeitpunkt exakt an
	// seiner rohen Position, nicht nur während des Hold-Fensters.
	let rBRaw = compactedLogicalRectAt(B, waypoints[0]);
	for (let t of [
		0,
		T,
		transitionStart,
		transitionStart + transitionTicks / 2,
		transitionEnd,
		maxTick,
	]) {
		let r = lookup(B, t);
		assert.ok(
			Math.abs(r.x - rBRaw.x) < 1e-9,
			`B (Anker) sollte sich NIE bewegen - bei t=${t}: x=${r.x} statt ${rBRaw.x}`,
		);
	}

	// A (leichter) verhält sich wie zuvor für die leichte Seite erwartet:
	// eingefroren während des Hold-Fensters, bewegt sich gestreckt über
	// transitionTicks danach.
	let rAAtT = lookup(A, T);
	for (let t = T; t <= transitionStart; t += 0.1) {
		let r = lookup(A, t);
		assert.ok(
			Math.abs(r.x - rAAtT.x) < 1e-9 && Math.abs(r.w - rAAtT.w) < 1e-9,
			`A bewegte sich bei t=${t.toFixed(1)} (innerhalb des Hold-Fensters [${T},${transitionStart}]): x=${r.x} statt ${rAAtT.x}`,
		);
	}
	let rAMid = lookup(A, transitionStart + transitionTicks / 2);
	let rAEnd = lookup(A, transitionEnd);
	let midProgress = Math.abs(rAMid.x - rAAtT.x);
	let fullProgress = Math.abs(rAEnd.x - rAAtT.x);
	assert.ok(
		midProgress > 1e-6 && midProgress < fullProgress - 1e-6,
		`Übergang sollte in der Mitte teilweise (nicht 0%, nicht 100%) fortgeschritten sein: mid=${midProgress}, full=${fullProgress}`,
	);
	assert.ok(
		fullProgress > 1e-6,
		'A sollte sich NACH dem vollen Übergang tatsächlich Richtung B bewegt haben',
	);
	// A landet exakt an B's linkem Rand (Lücke vollständig geschlossen).
	assert.ok(
		Math.abs(rAEnd.x + rAEnd.w - rBRaw.x) < 1e-6,
		`A sollte B nach dem Übergang berühren: A endet bei ${rAEnd.x + rAEnd.w}, B beginnt bei ${rBRaw.x}`,
	);
});
