// Persistente Tests für TEIL 2 (Kompaktierung) aus bank-core.js - bisher
// ohne jede Testabdeckung (nur im Algorithmus-Spiel-Tool manuell geprüft).
// Siehe README Abschnitt 6.2 für die dort dokumentierten, hier verifizierten
// Eigenschaften.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createBankSimulation, buildSystem,
    buildCompactionMap, computeCompactionAt, computeCompactionWaypoints,
    compactedRectAt, getSmoothedCompactedRect, makeCompactedRectLookup,
} from './bank-core.js';

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

test('Integration (echter Bank-Algorithmus): kompaktierte, gleichzeitig sichtbare Stücke überlappen sich nie', () => {
    let sim = createBankSimulation(10, 6, 'fixed');
    let { local_max_time } = buildSystem(10, 6, 'fixed', 'subdivide');
    let waypoints = computeCompactionWaypoints(sim.bank_pieces, local_max_time);

    function overlaps(a, b) {
        const EPS = 1e-6;
        return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
    }

    // Stichprobenartig über die Zeitachse prüfen (jeder Tick + ein paar
    // Zwischenwerte fürs Scrubben) - bei lokal begrenzter lokaler Tiefe (6)
    // performant genug für einen Test.
    for (let t = 0; t <= local_max_time; t += 0.5) {
        let visible = sim.bank_pieces.filter(p => t >= p.born_time && t < p.cut_time && t < p.taken_time);
        let rects = visible.map(p => getSmoothedCompactedRect(p, waypoints, t));
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                assert.ok(!overlaps(rects[i], rects[j]),
                    `Überlappung bei t=${t}: Stück ${i} (${JSON.stringify(rects[i])}) und ${j} (${JSON.stringify(rects[j])})`);
            }
        }
    }
});

test('Integration: kompaktierte Rechtecke bleiben innerhalb des sichtbaren [0,1]x[0,1]-Rahmens', () => {
    let sim = createBankSimulation(10, 6, 'fixed');
    let { local_max_time } = buildSystem(10, 6, 'fixed', 'subdivide');
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

test('makeCompactedRectLookup: cacht wirklich - wiederholte Abfragen für dasselbe Stück bauen die Spline nicht neu', () => {
    let calls = 0;
    let bank_pieces = [piece(0, 0, 0.5, 0.5, { born_time: 0, cut_time: Infinity, taken_time: Infinity })];
    // Zählt indirekt: waypoints.map() im Ernstfall ruft compactedRectAt() pro
    // Waypoint auf - hier stattdessen ein Spy per Proxy um mapX zu zählen.
    let waypoints = computeCompactionWaypoints(bank_pieces, 10);
    let originalMapX = waypoints[0].mapX;
    waypoints[0].mapX = (x) => { calls++; return originalMapX(x); };

    let lookup = makeCompactedRectLookup(waypoints);
    lookup(bank_pieces[0], 1);
    let callsAfterFirst = calls;
    assert.ok(callsAfterFirst > 0, 'erster Aufruf sollte die Spline aufbauen (mapX benutzen)');

    lookup(bank_pieces[0], 2);
    lookup(bank_pieces[0], 5);
    lookup(bank_pieces[0], 9);
    assert.equal(calls, callsAfterFirst, 'Folgeaufrufe für dasselbe Stück dürfen mapX nicht erneut aufrufen (Cache-Treffer)');
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
