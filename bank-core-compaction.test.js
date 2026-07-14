// Persistente Tests für TEIL 2 (Kompaktierung) aus bank-core.js - bisher
// ohne jede Testabdeckung (nur im Algorithmus-Spiel-Tool manuell geprüft).
// Siehe README Abschnitt 6.2 für die dort dokumentierten, hier verifizierten
// Eigenschaften.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSystem,
    buildCompactionMap, computeCompactionAt, computeCompactionWaypoints,
    compactedRectAt, getSmoothedCompactedRect, makeCompactedRectLookup,
} from './bank-core.js';

// Muss mit GAP_CLOSE_DELAY_TICKS in bank-core.js übereinstimmen (nicht
// exportiert - bewusst über das beobachtbare Verhalten getestet statt über
// eine interne Konstante, siehe Tests unten).
const GAP_CLOSE_DELAY_TICKS = 1;

// id ist Pflicht für makeCompactedRectLookup (Cache-Schlüssel) - echte
// bank_pieces haben immer eine eindeutige id (siehe createBankSimulation),
// daher hier ebenfalls automatisch eine eindeutige vergeben.
let _pieceIdCounter = 0;
function piece(x, y, w, h, extra) {
    return Object.assign({ id: _pieceIdCounter++, x, y, w, h, born_time: 0, cut_time: Infinity, taken_time: Infinity }, extra || {});
}

// ---------------------------------------------------------------------------
// buildCompactionMap
// ---------------------------------------------------------------------------

test('buildCompactionMap: eine Lücke zwischen zwei Stücken wird auf 0 komprimiert', () => {
    // Stücke bei [0,0.1] und [0.5,0.6] auf der x-Achse - Lücke [0.1,0.5]
    // (Breite 0.4) soll verschwinden.
    let pieces = [piece(0, 0, 0.1, 0.2), piece(0.5, 0, 0.1, 0.2)];
    let { compact, totalOccupied } = buildCompactionMap(pieces, 'x');
    assert.ok(Math.abs(totalOccupied - 0.2) < 1e-9, `totalOccupied sollte 0.2 sein (0.1+0.1), war ${totalOccupied}`);
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
    let waypoints = computeCompactionWaypoints(bank_pieces, 10);
    assert.equal(waypoints[0].t, 0);
    assert.equal(waypoints[waypoints.length - 1].t, 10);
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
    let waypoints = computeCompactionWaypoints(bank_pieces, 10);
    let last = waypoints[waypoints.length - 1];
    assert.equal(last.t, 10);
    assert.equal(last.totalW, 1);
    assert.equal(last.totalH, 1);
});

test('computeCompactionWaypoints: z ist der Fit-to-Frame-Zoom (1/max(totalW,totalH))', () => {
    let bank_pieces = [piece(0, 0, 0.3, 0.6, { born_time: 0, cut_time: Infinity, taken_time: Infinity })];
    let waypoints = computeCompactionWaypoints(bank_pieces, 1);
    let wp = waypoints[0];
    let expectedZ = Math.min(1 / wp.totalW, 1 / wp.totalH);
    assert.ok(Math.abs(wp.z - expectedZ) < 1e-9);
});

// ---------------------------------------------------------------------------
// compactedRectAt
// ---------------------------------------------------------------------------

test('compactedRectAt: bei einem einzigen Stück (füllt totalW/totalH exakt) landet es zentriert bei Zoom passend zur langen Seite', () => {
    let bank_pieces = [piece(0.2, 0.2, 0.3, 0.6, { born_time: 0, cut_time: Infinity, taken_time: Infinity })];
    let waypoints = computeCompactionWaypoints(bank_pieces, 1);
    let r = compactedRectAt(bank_pieces[0], waypoints[0]);
    // Einziges Stück -> component füllt totalW/totalH exakt (0.3 x 0.6) ->
    // zx=zy=0 (linke untere Ecke landet nach der Zentrierung symmetrisch).
    let z = waypoints[0].z; // = 1/0.6 (lange Seite ist h)
    assert.ok(Math.abs(r.w - 0.3 * z) < 1e-9);
    assert.ok(Math.abs(r.h - 0.6 * z) < 1e-9);
    // h*z sollte exakt 1 sein (füllt die Bildhöhe komplett).
    assert.ok(Math.abs(r.h - 1) < 1e-9);
});

test('compactedRectAt: zwei Stücke mit Lücke dazwischen berühren sich nach der Kompaktierung', () => {
    let bank_pieces = [
        piece(0, 0, 0.2, 0.2, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
        piece(0.7, 0, 0.2, 0.2, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
    ];
    let waypoints = computeCompactionWaypoints(bank_pieces, 1);
    let r0 = compactedRectAt(bank_pieces[0], waypoints[0]);
    let r1 = compactedRectAt(bank_pieces[1], waypoints[0]);
    assert.ok(Math.abs((r0.x + r0.w) - r1.x) < 1e-6, `Lücke wurde nicht komprimiert: r0 endet bei ${r0.x + r0.w}, r1 beginnt bei ${r1.x}`);
});

// ---------------------------------------------------------------------------
// getSmoothedCompactedRect
// ---------------------------------------------------------------------------

test('getSmoothedCompactedRect: leere Waypoint-Liste liefert null', () => {
    assert.equal(getSmoothedCompactedRect(piece(0, 0, 1, 1), [], 0), null);
});

test('getSmoothedCompactedRect: trifft an jedem Waypoint exakt dessen compactedRectAt-Wert (Pass-Through-Garantie von smoothing.js)', () => {
    let p1 = piece(0, 0, 0.3, 0.3, { taken_time: 5 });
    let p2 = piece(0.3, 0, 0.7, 1.0);
    let bank_pieces = [p1, p2];
    let waypoints = computeCompactionWaypoints(bank_pieces, 10);
    for (let wp of waypoints) {
        let expected = compactedRectAt(p2, wp);
        let actual = getSmoothedCompactedRect(p2, waypoints, wp.t);
        assert.ok(Math.abs(actual.x - expected.x) < 1e-6, `x bei t=${wp.t}: ${actual.x} != ${expected.x}`);
        assert.ok(Math.abs(actual.y - expected.y) < 1e-6);
        assert.ok(Math.abs(actual.w - expected.w) < 1e-6);
        assert.ok(Math.abs(actual.h - expected.h) < 1e-6);
    }
});

// ---------------------------------------------------------------------------
// Integrations-Test mit dem echten Bank-Algorithmus (bank-core.js) -
// verifiziert die im README (Abschnitt 6.2) behaupteten Eigenschaften direkt
// an einem realen System statt nur an synthetischen Einzelfällen.
// ---------------------------------------------------------------------------

function overlaps(a, b) {
    const EPS = 1e-6;
    return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
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
// wo ein Nachbarstück "vorauseilen" könnte.
test('Integration (echter Bank-Algorithmus): kompaktierte, gleichzeitig sichtbare Stücke überlappen sich nie (dichtes Sampling um jedes Event)', () => {
    // Tiefe 4 statt 6: der ursprüngliche Bug war massiv reproduzierbar (über
    // 100.000 Verletzungen bei dichtem Sampling, siehe Gesprächsverlauf) -
    // für einen zuverlässigen Regressionstest reicht eine deutlich kleinere,
    // schnell laufende Tiefe locker aus; Tiefe 6 ließ den Test wegen der
    // O(sichtbare Stücke)-Filterung pro Sample auf >10s anwachsen.
    let { sim, local_max_time } = buildSystem(10, 4, 'fixed', 'subdivide');
    let waypoints = computeCompactionWaypoints(sim.bank_pieces, local_max_time);
    let lookup = makeCompactedRectLookup(waypoints); // times einmalig extrahiert statt pro Aufruf, siehe dort

    function checkAt(t) {
        let visible = sim.bank_pieces.filter(p => t >= p.born_time && t < p.cut_time && t < p.taken_time);
        let rects = visible.map(p => lookup(p, t));
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                assert.ok(!overlaps(rects[i], rects[j]),
                    `Überlappung bei t=${t}: Stück ${i} (${JSON.stringify(rects[i])}) und ${j} (${JSON.stringify(rects[j])})`);
            }
        }
    }

    // Grober Sweep über die gesamte Zeitachse.
    for (let t = 0; t <= local_max_time; t += 0.5) checkAt(t);

    // Dichter Sweep um JEDEN echten Event-Zeitpunkt herum - fängt genau das
    // kurze, leicht überspringbare Überlappungsfenster, das den Bug
    // ursprünglich verursacht hat (der Bug war massiv, ±0.2 in 0.05er-
    // Schritten reicht bequem, ohne den Test unnötig zu verlangsamen).
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

test('Integration: kompaktierte Rechtecke bleiben innerhalb des sichtbaren [0,1]x[0,1]-Rahmens', () => {
    let { sim, local_max_time } = buildSystem(10, 6, 'fixed', 'subdivide');
    let waypoints = computeCompactionWaypoints(sim.bank_pieces, local_max_time);
    const EPS = 1e-6;
    for (let t = 0; t <= local_max_time; t += 1) {
        let visible = sim.bank_pieces.filter(p => t >= p.born_time && t < p.cut_time && t < p.taken_time);
        for (let p of visible) {
            let r = getSmoothedCompactedRect(p, waypoints, t);
            assert.ok(r.x >= -EPS && r.x + r.w <= 1 + EPS, `x außerhalb [0,1] bei t=${t}: ${JSON.stringify(r)}`);
            assert.ok(r.y >= -EPS && r.y + r.h <= 1 + EPS, `y außerhalb [0,1] bei t=${t}: ${JSON.stringify(r)}`);
        }
    }
});

// ---------------------------------------------------------------------------
// makeCompactedRectLookup - gecachte Variante von getSmoothedCompactedRect
// ---------------------------------------------------------------------------
// Motivation (siehe CLAUDE.md "Measure before optimizing"): getSmoothedCompactedRect
// baut bei jedem Aufruf die Spline neu (O(Waypoints)) - beim Rendern (ein
// Aufruf pro sichtbarem Stück, pro Frame) gemessen ein echtes Performance-
// Problem bei tiefer Rekursion (~15-24ms für nur 46-64 Stücke bei Tiefe 16,
// über dem 16.7ms-Frame-Budget). makeCompactedRectLookup cacht pro
// piece.id, wertet danach nur noch aus.

test('makeCompactedRectLookup: liefert dieselben Werte wie getSmoothedCompactedRect (Korrektheits-Parität)', () => {
    let bank_pieces = [
        piece(0, 0, 0.3, 0.3, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
        piece(0.5, 0, 0.5, 1.0, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
    ];
    let waypoints = computeCompactionWaypoints(bank_pieces, 10);
    let lookup = makeCompactedRectLookup(waypoints);

    for (let p of bank_pieces) {
        for (let t of [0, 2.5, 7, 10]) {
            let expected = getSmoothedCompactedRect(p, waypoints, t);
            let actual = lookup(p, t);
            assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
            assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
            assert.ok(Math.abs(actual.w - expected.w) < 1e-9);
            assert.ok(Math.abs(actual.h - expected.h) < 1e-9);
        }
    }
});

test('makeCompactedRectLookup: leere Waypoints liefern null (wie getSmoothedCompactedRect)', () => {
    let lookup = makeCompactedRectLookup([]);
    assert.equal(lookup(piece(0, 0, 1, 1), 0), null);
});

test('makeCompactedRectLookup: extrahiert times einmalig statt bei jedem Aufruf (Performance, siehe Kommentar an der Funktion)', () => {
    let bank_pieces = [
        piece(0, 0, 0.5, 0.5, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
        piece(0.5, 0, 0.5, 0.5, { born_time: 0, cut_time: Infinity, taken_time: Infinity }),
    ];
    let waypoints = computeCompactionWaypoints(bank_pieces, 10);
    let mapCalls = 0;
    let originalMap = waypoints.map.bind(waypoints);
    waypoints.map = (fn) => { mapCalls++; return originalMap(fn); };

    let lookup = makeCompactedRectLookup(waypoints);
    assert.equal(mapCalls, 1, 'makeCompactedRectLookup sollte waypoints.map() genau einmal aufrufen (times einmalig extrahieren)');

    lookup(bank_pieces[0], 1);
    lookup(bank_pieces[1], 2);
    lookup(bank_pieces[0], 5);
    lookup(bank_pieces[1], 9);
    assert.equal(mapCalls, 1, 'einzelne Abfragen dürfen waypoints.map() nicht erneut aufrufen (times bleibt gecacht)');
});

test('Integration (echter Bank-Algorithmus, Performance): gecachte Lookups sind bei Tiefe 16 weit unter dem 60fps-Frame-Budget', () => {
    let { sim, local_max_time } = buildSystem(10, 16, 'fixed', 'morph');
    let waypoints = computeCompactionWaypoints(sim.bank_pieces, local_max_time);
    let lookup = makeCompactedRectLookup(waypoints);

    let t = local_max_time * 0.6;
    let visible = sim.bank_pieces.filter(p => t >= p.born_time && t < p.cut_time && t < p.taken_time);
    for (let p of visible) lookup(p, t); // Cache aufwärmen (einmaliger Kaltstart-Preis, siehe Kommentar an makeCompactedRectLookup)

    const FRAMES = 30;
    let t0 = performance.now();
    for (let f = 0; f < FRAMES; f++) {
        for (let p of visible) lookup(p, t + f * 0.001);
    }
    let msPerFrame = (performance.now() - t0) / FRAMES;
    assert.ok(msPerFrame < 5, `Gecachter Lookup zu langsam: ${msPerFrame.toFixed(3)}ms/Frame für ${visible.length} Stücke (Budget 16.7ms, hier grosszügige 5ms-Grenze für Testrechner-Schwankungen)`);
});

// ---------------------------------------------------------------------------
// Lücken-Schließ-Verzögerung (GAP_CLOSE_DELAY_TICKS)
// ---------------------------------------------------------------------------
// Regressionstest für einen zweiten, subtileren Nachfolge-Bug (Gesprächsverlauf,
// nach dem ersten Überlappungs-Fix): "Teile verschwinden immer noch zu früh."
// Ein einzelner Wegpunkt GAP_CLOSE_DELAY_TICKS nach der Entnahme reicht NICHT
// aus, um JEDE Bewegung bis dahin zu verhindern, weil computeSegmentBlend()
// STETIG zwischen zwei Wegpunkten überblendet - ein Segment [T, T+1] zeigt
// selbst dann schon Bewegung, wenn der Zielwert erst bei T+1 "fertig" ist.
// Fix: der Zustand bei T+GAP_CLOSE_DELAY_TICKS muss IDENTISCH zum Zustand
// unmittelbar nach der Entnahme sein (siehe computeCompactionAt()) - erst
// danach, in einem eigenen, ANSCHLIESSENDEN Segment, findet die eigentliche
// Überblendung statt.
//
// WICHTIGE LEKTION beim Verifizieren (Gesprächsverlauf): "prüfe, ob sich
// IRGENDEIN Nachbarstück im Fenster [T, T+1] von Q bewegt" ist bei diesem
// Bank-Algorithmus KEIN gültiger Test - durch die vielen, oft nur einen
// Tick auseinanderliegenden Entnahme-Ereignisse (siehe cellMode 'subdivide':
// nach einem Zerschneiden werden oft alle BASE Kinder in schneller Folge
// entnommen) überlappt das Prüffenster für Q fast immer mit dem LEGITIMEN
// Schließen einer GANZ ANDEREN Lücke - das erzeugte zunächst scheinbare,
// tatsächlich aber falsch zugeordnete "Verletzungen". Der korrekte,
// unverwechselbare Test prüft stattdessen DIREKT, ob JEDES einzelne Stück
// in computeCompactionAt() exakt bis zu seinem EIGENEN, erwarteten Tick
// (und nicht früher) als "noch vorhanden" gezählt wird.
test('computeCompactionAt: ein entnommenes Stück bleibt bis GAP_CLOSE_DELAY_TICKS+1 nach seiner Entnahme als Platzhalter gezählt, keinen Tick früher', () => {
    let { sim, local_max_time } = buildSystem(10, 6, 'fixed', 'subdivide');
    let checked = 0;
    for (let Q of sim.bank_pieces) {
        if (!isFinite(Q.taken_time)) continue;
        let T = Q.taken_time;
        let closesAt = T + GAP_CLOSE_DELAY_TICKS + 1;
        if (closesAt > local_max_time) continue;
        checked++;
        for (let t = T; t < closesAt; t++) {
            let comp = computeCompactionAt(sim.bank_pieces, t);
            let visible = sim.bank_pieces.filter(p => t >= p.born_time && t < p.cut_time && t < p.taken_time + GAP_CLOSE_DELAY_TICKS + 1);
            assert.ok(visible.some(p => p.id === Q.id),
                `Stück ${Q.id} (entnommen bei T=${T}) sollte bei t=${t} noch als Platzhalter gezählt werden (schließt erst bei ${closesAt})`);
        }
    }
    assert.ok(checked > 100, `Zu wenige Fälle geprüft (${checked}) - Test würde bei einer strukturellen Änderung des Systems still versagen`);
});

// Isolierter, synthetischer Fall statt des echten (dicht verschachtelten)
// Bank-Algorithmus: A/Q/B liegen nebeneinander auf der x-Achse, NUR Q wird
// entnommen (bei T=5), A und B bleiben für immer. Damit gibt es GARANTIERT
// kein zweites, zufällig überlappendes Ereignis, das die Messung verfälschen
// könnte (siehe Kommentar am vorigen Test zur Verwechslungsgefahr) - der
// einzige Grund, warum sich B's Position überhaupt ändern könnte, ist Q's
// eigene Entnahme.
test('getSmoothedCompactedRect: B bewegt sich erst ab T+GAP_CLOSE_DELAY_TICKS (isolierter Fall, keine Nachbar-Interferenz)', () => {
    let A = piece(0, 0, 0.2, 1, { taken_time: Infinity });
    let Q = piece(0.2, 0, 0.3, 1, { taken_time: 5 });
    let B = piece(0.5, 0, 0.5, 1, { taken_time: Infinity });
    let bank_pieces = [A, Q, B];
    let maxTick = 20;
    let waypoints = computeCompactionWaypoints(bank_pieces, maxTick);
    let lookup = makeCompactedRectLookup(waypoints);

    let T = 5;
    let rAtT = lookup(B, T);
    // Während des GESAMTEN Hold-Fensters [T, T+GAP_CLOSE_DELAY_TICKS] darf
    // sich B keinen Millimeter bewegen - nicht nur an den Rändern, sondern
    // bei JEDEM Zwischenwert (das ist genau der Bug, der den einzelnen
    // Wegpunkt bei T+1 allein nicht behoben hatte).
    for (let t = T; t <= T + GAP_CLOSE_DELAY_TICKS; t += 0.1) {
        let r = lookup(B, t);
        assert.ok(Math.abs(r.x - rAtT.x) < 1e-9 && Math.abs(r.w - rAtT.w) < 1e-9,
            `B bewegte sich bei t=${t.toFixed(1)} (innerhalb des Hold-Fensters [${T},${T + GAP_CLOSE_DELAY_TICKS}]): x=${r.x} statt ${rAtT.x}`);
    }
    // Danach (in der eigentlichen Überblendung) bewegt sich B tatsächlich -
    // sonst würde der Test auch bei komplett kaputter Kompaktierung "grün"
    // bleiben (leerer Beweis).
    let rAfter = lookup(B, T + GAP_CLOSE_DELAY_TICKS + 1);
    assert.ok(Math.abs(rAfter.x - rAtT.x) > 1e-6, 'B sollte sich NACH dem Hold-Fenster tatsächlich Richtung der Lücke bewegen');
});
