// Persistente Tests für smoothing.js - laufen via `npm test` (node:test,
// keine zusätzliche Abhängigkeit nötig, siehe package.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonotoneSpline, buildMonotoneSplineBundle } from './smoothing.js';

const EPS = 1e-9;

test('trifft an jedem Stützpunkt exakt den vorgegebenen Wert (monoton wachsend)', () => {
    let pts = [{ t: 0, v: 0 }, { t: 1, v: 2 }, { t: 2.5, v: 2.5 }, { t: 5, v: 10 }, { t: 5.2, v: 10.01 }];
    let at = buildMonotoneSpline(pts);
    for (let p of pts) assert.ok(Math.abs(at(p.t) - p.v) < 1e-6, `at(${p.t}) sollte ${p.v} sein, war ${at(p.t)}`);
});

test('trifft an jedem Stützpunkt exakt den vorgegebenen Wert (nicht-monotone Werte)', () => {
    let pts = [{ t: 0, v: 3 }, { t: 1, v: -2 }, { t: 2, v: 5 }, { t: 3, v: 5 }, { t: 4, v: -1 }];
    let at = buildMonotoneSpline(pts);
    for (let p of pts) assert.ok(Math.abs(at(p.t) - p.v) < 1e-6);
});

test('C¹-stetig an jedem inneren Stützpunkt (linke = rechte Ableitung, per finiter Differenz)', () => {
    // h klein genug wählen, dass der Trunkierungsfehler der finiten Differenz
    // (skaliert linear mit h, empirisch verifiziert - siehe Gesprächsverlauf)
    // die Toleranz nicht dominiert, selbst an Stützpunkten mit starker
    // Krümmungsänderung (t=1.7 hier: Steigung springt von "fast flach" auf
    // "steil" im Nachbarsegment).
    let pts = [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 1.7, v: 1.05 }, { t: 3, v: 9 }, { t: 6, v: 9 }, { t: 8, v: 20 }];
    let at = buildMonotoneSpline(pts);
    const h = 1e-6;
    for (let i = 1; i < pts.length - 1; i++) {
        let t0 = pts[i].t;
        let leftDeriv = (at(t0) - at(t0 - h)) / h;
        let rightDeriv = (at(t0 + h) - at(t0)) / h;
        assert.ok(Math.abs(leftDeriv - rightDeriv) < 1e-3,
            `Ableitungssprung bei t=${t0}: links=${leftDeriv.toFixed(6)}, rechts=${rightDeriv.toFixed(6)}`);
    }
});

test('C¹-stetig an den Rändern (Naht zur konstanten Fortsetzung, keine Steigung)', () => {
    let pts = [{ t: 2, v: 5 }, { t: 4, v: 9 }, { t: 7, v: 9 }, { t: 10, v: 20 }];
    let at = buildMonotoneSpline(pts);
    const h = 1e-4;
    // links vom ersten Stützpunkt: außen konstant (Ableitung 0), innen sollte
    // die Ableitung ebenfalls gegen 0 gehen (Randtangente ist bewusst 0).
    let derivJustInside = (at(pts[0].t + h) - at(pts[0].t)) / h;
    assert.ok(Math.abs(derivJustInside) < 1e-2, `Randtangente am Start nicht ~0: ${derivJustInside}`);
    let derivJustOutside = (at(pts[0].t) - at(pts[0].t - h)) / h;
    assert.equal(derivJustOutside, 0, 'außerhalb der Stützpunkte muss die Fortsetzung exakt konstant sein');

    let last = pts[pts.length - 1].t;
    let derivJustInsideEnd = (at(last) - at(last - h)) / h;
    assert.ok(Math.abs(derivJustInsideEnd) < 1e-2, `Randtangente am Ende nicht ~0: ${derivJustInsideEnd}`);
    let derivJustOutsideEnd = (at(last + h) - at(last)) / h;
    assert.equal(derivJustOutsideEnd, 0);
});

test('kein Überschwingen/Unterschwingen innerhalb eines monoton steigenden Segments', () => {
    let pts = [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 1.1, v: 1.05 }, { t: 3, v: 50 }, { t: 3.05, v: 50.001 }, { t: 10, v: 51 }];
    let at = buildMonotoneSpline(pts);
    for (let i = 0; i < pts.length - 1; i++) {
        let [tA, tB] = [pts[i].t, pts[i + 1].t];
        let [vLo, vHi] = [Math.min(pts[i].v, pts[i + 1].v), Math.max(pts[i].v, pts[i + 1].v)];
        for (let s = 0; s <= 1; s += 0.02) {
            let val = at(tA + s * (tB - tA));
            assert.ok(val >= vLo - 1e-6 && val <= vHi + 1e-6,
                `Überschwinger in Segment [${tA},${tB}] bei s=${s}: ${val} außerhalb [${vLo},${vHi}]`);
        }
    }
});

test('globale Monotonie bleibt über die gesamte Kurve erhalten (nicht nur an Stützpunkten)', () => {
    // Realistisches Muster wie GLOBAL_AUTO_ZOOM_CHECKPOINTS: viele Stützpunkte
    // mit demselben Wert in Folge (mehrere Schalen pro Ziffer), unregelmäßige
    // Abstände.
    let pts = [];
    let tCursor = 0, v = 0;
    for (let i = 0; i < 60; i++) {
        tCursor += 0.3 + (i % 5) * 0.4;
        if (i % 4 === 0) v += 1;
        pts.push({ t: tCursor, v });
    }
    let at = buildMonotoneSpline(pts);
    let prev = -Infinity;
    for (let t = pts[0].t - 2; t <= pts[pts.length - 1].t + 2; t += 0.01) {
        let val = at(t);
        assert.ok(val >= prev - 1e-9, `Monotonie verletzt bei t=${t.toFixed(2)}: ${val} < vorheriger Wert ${prev}`);
        prev = val;
    }
});

test('konstante Fortsetzung vor dem ersten und nach dem letzten Stützpunkt', () => {
    let pts = [{ t: 5, v: 3 }, { t: 8, v: 7 }, { t: 12, v: 7 }];
    let at = buildMonotoneSpline(pts);
    assert.equal(at(-100), 3);
    assert.equal(at(0), 3);
    assert.equal(at(4.999), 3);
    assert.equal(at(12.001), 7);
    assert.equal(at(1000), 7);
});

test('keine Verzögerung: der Zielwert eines neuen Stützpunkts ist GENAU an dessen Zeitpunkt erreicht (kein Nachhinken wie beim alten Exponentialkern)', () => {
    // Direkter Regressionstest für den Auto-Zoom-Bug aus sqrt2.html: ein neu
    // erreichter Exponent (hier: 3) musste beim alten kausalen Filter erst
    // eine Zeitkonstante lang "aufholen" - mit der Spline gilt der Zielwert
    // ab der exakten Stützpunkt-Zeit ohne jede Verzögerung.
    let checkpoints = [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 2, v: 2 }, { t: 3, v: 3 }, { t: 4, v: 4 }];
    let at = buildMonotoneSpline(checkpoints);
    assert.equal(at(3), 3, 'Wert muss GENAU am Stützpunkt erreicht sein, keine Verzögerung');
    // und bleibt ab da nie mehr darunter (Kern der Sichtbarkeits-Garantie):
    for (let t = 3; t <= 4; t += 0.05) assert.ok(at(t) >= 3 - 1e-9);
});

test('Sonderfall zwei Stützpunkte entspricht der klassischen Smoothstep-Funktion (Randtangenten 0)', () => {
    let at = buildMonotoneSpline([{ t: 0, v: 0 }, { t: 1, v: 1 }]);
    for (let s = 0; s <= 1; s += 0.1) {
        let expected = 3 * s * s - 2 * s * s * s; // klassisches smoothstep
        assert.ok(Math.abs(at(s) - expected) < 1e-9, `at(${s})=${at(s)} != smoothstep ${expected}`);
    }
});

test('Sonderfälle: 0 und 1 Stützpunkte stürzen nicht ab und liefern sinnvolle Werte', () => {
    assert.equal(buildMonotoneSpline([])(5), 0);
    let at1 = buildMonotoneSpline([{ t: 3, v: 42 }]);
    assert.equal(at1(-10), 42);
    assert.equal(at1(3), 42);
    assert.equal(at1(999), 42);
});

test('doppelte/nicht wachsende t-Werte werden defensiv dedupliziert statt NaN zu erzeugen', () => {
    let at = buildMonotoneSpline([{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 1, v: 1 }, { t: 1 + 1e-12, v: 1 }, { t: 3, v: 4 }]);
    for (let t = -1; t <= 4; t += 0.1) assert.ok(Number.isFinite(at(t)), `NaN/Infinity bei t=${t}`);
});

test('buildMonotoneSplineBundle interpoliert mehrere Felder unabhängig über dieselbe Zeitachse', () => {
    let points = [
        { t: 0, z: 1, offsetX: 0, area: 1 },
        { t: 1, z: 2, offsetX: -0.5, area: 0.5 },
        { t: 2, z: 4, offsetX: -0.5, area: 0.2 },
    ];
    let bundle = buildMonotoneSplineBundle(points, ['z', 'offsetX', 'area']);
    for (let p of points) {
        let r = bundle.at(p.t);
        assert.ok(Math.abs(r.z - p.z) < 1e-6);
        assert.ok(Math.abs(r.offsetX - p.offsetX) < 1e-6);
        assert.ok(Math.abs(r.area - p.area) < 1e-6);
    }
    // z ist monoton wachsend über alle Stützpunkte - Bundle-Auswertung muss
    // das pro Feld unabhängig erhalten (kein Übersprechen zwischen Feldern).
    let prevZ = -Infinity;
    for (let t = 0; t <= 2; t += 0.05) {
        let z = bundle.at(t).z;
        assert.ok(z >= prevZ - 1e-9);
        prevZ = z;
    }
});

test('ohne onlyChanges: Wertwiederholungen erzwingen "weiche Stufen" (Nulltangente an jedem Wiederholungspunkt)', () => {
    // Typisches Muster wie GLOBAL_AUTO_ZOOM_CHECKPOINTS: derselbe Wert
    // wiederholt sich über mehrere Stützpunkte, bevor er wechselt.
    let pts = [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 2, v: 1 }, { t: 3, v: 1 }, { t: 4, v: 2 }, { t: 5, v: 2 }, { t: 6, v: 2 }, { t: 7, v: 3 }];
    let at = buildMonotoneSpline(pts);
    const h = 1e-4;
    // An JEDEM Wiederholungspunkt (t=2, t=5 - innerhalb eines Plateaus) ist
    // die Steigung exakt 0 (Plateau ist ja flach) UND bleibt es auch beim
    // Verlassen des Plateaus bis zum letzten Wiederholungspunkt (t=3, t=6) -
    // die Rampe zum nächsten Wert ist dadurch auf das letzte Segment
    // [3,4]/[6,7] zusammengequetscht, mit Nulltangente an t=3 und t=6.
    assert.equal((at(3 + h) - at(3 - h)) / (2 * h) < 0.05, true, 'Tangente kurz vor dem Wertwechsel sollte ~0 sein (Stufen-Effekt)');
});

test('mit onlyChanges: Wertwiederholungen werden verworfen, Übergang fließt statt zu stufen', () => {
    let pts = [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 2, v: 1 }, { t: 3, v: 1 }, { t: 4, v: 2 }, { t: 5, v: 2 }, { t: 6, v: 2 }, { t: 7, v: 3 }];
    let at = buildMonotoneSpline(pts, { onlyChanges: true });

    // Exakte Werte an den Stützpunkten bleiben erhalten - auch an den NICHT
    // mehr explizit gehaltenen Wiederholungs-Zeitpunkten (t=2,3,5,6), weil
    // dort ja ohnehin noch derselbe Wert wie beim letzten echten Wechsel gilt.
    assert.ok(Math.abs(at(1) - 1) < 1e-6);
    assert.ok(Math.abs(at(4) - 2) < 1e-6);
    assert.ok(Math.abs(at(7) - 3) < 1e-6);

    // Die Steigung mitten im alten Plateau (t=3, direkt vor dem Wertwechsel)
    // ist jetzt NICHT mehr null - die Kurve "fließt" bereits Richtung des
    // nächsten Werts, statt bis zuletzt flach zu bleiben und dann abrupt
    // (wenn auch C¹) zu rampen.
    const h = 1e-4;
    let derivAt3 = (at(3 + h) - at(3 - h)) / (2 * h);
    assert.ok(derivAt3 > 0.05, `Steigung bei t=3 sollte spürbar > 0 sein (fließender Übergang), war ${derivAt3}`);

    // Monotonie bleibt trotzdem gewahrt.
    let prev = -Infinity;
    for (let t = -1; t <= 8; t += 0.05) {
        let v = at(t);
        assert.ok(v >= prev - 1e-9);
        prev = v;
    }
});

test('onlyChanges: Sichtbarkeits-Kern-Garantie bleibt erhalten (Wert an jedem ECHTEN Wertwechsel exakt getroffen, nie danach unterschritten)', () => {
    // Realistischeres Muster: unregelmäßige Plateau-Längen, wie axes[S].exp
    // in bank-core.js (siehe auto-zoom-visibility.test.js).
    let checkpoints = [];
    let t = 0, v = 0;
    let pattern = [1, 4, 1, 4, 2, 1, 3, 5, 6, 2, 3];
    for (let runLen of pattern) {
        for (let i = 0; i < runLen; i++) { checkpoints.push({ t, v }); t += 0.7; }
        v++;
    }
    let at = buildMonotoneSpline(checkpoints, { onlyChanges: true });

    // An jedem ECHTEN Wertwechsel (erster Punkt eines neuen Plateaus) muss
    // der exakte Wert getroffen werden, und danach nie mehr unterschritten.
    let prevValue = -Infinity;
    let seen = new Set();
    for (let cp of checkpoints) {
        if (seen.has(cp.v)) continue;
        seen.add(cp.v);
        assert.ok(Math.abs(at(cp.t) - cp.v) < 1e-6, `at(${cp.t}) sollte ${cp.v} sein, war ${at(cp.t)}`);
    }
    for (let tt = 0; tt <= t; tt += 0.05) {
        let val = at(tt);
        assert.ok(val >= prevValue - 1e-9);
        prevValue = val;
    }
});

test('buildMonotoneSplineBundle: onlyChanges wird pro Feld unabhängig angewendet', () => {
    let points = [
        { t: 0, changing: 0, constant: 5 },
        { t: 1, changing: 0, constant: 5 },
        { t: 2, changing: 1, constant: 5 },
        { t: 3, changing: 1, constant: 5 },
        { t: 4, changing: 2, constant: 5 },
    ];
    let bundle = buildMonotoneSplineBundle(points, ['changing', 'constant'], { onlyChanges: true });
    // 'constant' hat gar keine Wertwechsel - onlyChanges reduziert es auf
    // einen einzigen Stützpunkt, muss aber weiterhin überall exakt 5 liefern.
    for (let t = -5; t <= 10; t += 1) assert.equal(bundle.at(t).constant, 5);
    // 'changing' bekommt trotzdem seine eigene, unabhängige Deduplizierung.
    assert.ok(Math.abs(bundle.at(0).changing - 0) < 1e-6);
    assert.ok(Math.abs(bundle.at(4).changing - 2) < 1e-6);
});
