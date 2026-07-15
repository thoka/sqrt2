// Persistente Tests für smoothing.js - laufen via `pnpm test` (node:test,
// keine zusätzliche Abhängigkeit nötig, siehe package.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonotoneSpline, buildMonotoneSplineBundle, computeSegmentBlend, buildDampedFilter, buildDampedFilterBundle } from './smoothing.js';

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

// ---------------------------------------------------------------------------
// computeSegmentBlend
// ---------------------------------------------------------------------------

test('computeSegmentBlend: s=0 exakt an jedem Stützpunkt (Pass-Through wie buildMonotoneSpline)', () => {
    let times = [0, 2, 5, 5.5, 10];
    for (let t of times) {
        let { lo, hi, s } = computeSegmentBlend(times, t);
        assert.equal(s, 0, `s bei t=${t} sollte 0 sein (exakt an Stützpunkt), war ${s}`);
        assert.equal(times[lo] === t || times[hi] === t, true);
    }
});

test('computeSegmentBlend: Nullsteigung an BEIDEN Segmenträndern (kein Übergreifen ins Nachbarsegment)', () => {
    let times = [0, 1, 3, 7, 10];
    const h = 1e-6;
    for (let i = 1; i < times.length - 1; i++) {
        let t0 = times[i];
        // s selbst hat an den Segmenträndern Steigung 0 (klassisches
        // Smoothstep) - numerisch über eine finite Differenz direkt VOR und
        // NACH dem Stützpunkt geprüft.
        let sBefore = computeSegmentBlend(times, t0 - h).s;
        let sAfter = computeSegmentBlend(times, t0 + h).s;
        // sBefore ist s im VORHERIGEN Segment kurz vor Erreichen von 1,
        // sAfter ist s im NÄCHSTEN Segment kurz nach dem Start bei 0 -
        // beide Änderungsraten (ds/dt) müssen nahe 0 sein.
        let dsBefore = (1 - sBefore) / h; // wie schnell nähert sich s von unten der 1
        let dsAfter = sAfter / h; // wie schnell wächst s von 0 weg
        assert.ok(dsBefore < 0.01, `Steigung vor Stützpunkt ${t0} zu groß: ${dsBefore}`);
        assert.ok(dsAfter < 0.01, `Steigung nach Stützpunkt ${t0} zu groß: ${dsAfter}`);
    }
});

test('computeSegmentBlend: kein Vorauseilen - für t knapp VOR einem Stützpunkt bleibt s praktisch 0', () => {
    // Kernanforderung aus dem Kompaktierungs-Bug: ein Wert darf sich NICHT
    // schon Richtung des nächsten Stützpunkts bewegen, bevor dessen Segment
    // überhaupt beginnt (hätte bei buildMonotoneSpline durch Tangenten mit
    // "Schwung" aus dem Vorsegment passieren können).
    let times = [0, 1, 1.001, 5]; // sehr kurzes Segment [1, 1.001], dann langes [1.001, 5]
    let { s } = computeSegmentBlend(times, 1.0005); // Mitte des kurzen Segments
    assert.ok(s > 0.4 && s < 0.6, `Mitte des kurzen Segments sollte s~0.5 sein, war ${s}`);
    // Kurz VOR t=1 (im Segment [0,1]) darf s (für DIESES Segment) noch
    // nicht nennenswert auf das kommende kurze Segment reagieren.
    let justBefore = computeSegmentBlend(times, 0.9999);
    assert.ok(justBefore.hi === 1); // gehört noch zu Segment [0,1]
    assert.ok(justBefore.s > 0.99, `s direkt vor dem Stützpunkt sollte nahe 1 sein (Ende SEINES EIGENEN Segments), war ${justBefore.s}`);
});

test('computeSegmentBlend: geteiltes Gewicht erhält Ordnungsbeziehungen zwischen zwei unabhängigen Werte-Reihen (Kern der Überlappungs-Sicherheit)', () => {
    // a bleibt an beiden Stützpunkten links von b (a_rechts <= b_links) -
    // die Behauptung: das gilt dann automatisch für JEDEN Zeitpunkt
    // dazwischen, weil beide mit demselben s geblendet werden.
    let times = [0, 10];
    let aRight = [0.4, 0.9]; // a's rechter Rand wandert nach rechts
    let bLeft = [0.5, 0.9]; // b's linker Rand wandert auch, bleibt aber immer >= a
    for (let t = 0; t <= 10; t += 0.1) {
        let { lo, hi, s } = computeSegmentBlend(times, t);
        let aR = aRight[lo] * (1 - s) + aRight[hi] * s;
        let bL = bLeft[lo] * (1 - s) + bLeft[hi] * s;
        assert.ok(aR <= bL + 1e-9, `Ordnung verletzt bei t=${t}: a_rechts=${aR} > b_links=${bL}`);
    }
});

test('computeSegmentBlend: Randfälle (0/1 Stützpunkte, Zeit außerhalb des Bereichs)', () => {
    assert.equal(computeSegmentBlend([], 5), null);
    assert.deepEqual(computeSegmentBlend([3], 5), { lo: 0, hi: 0, s: 0 });
    assert.deepEqual(computeSegmentBlend([3, 7], -100), { lo: 0, hi: 0, s: 0 });
    assert.deepEqual(computeSegmentBlend([3, 7], 100), { lo: 1, hi: 1, s: 0 });
});

// ---------------------------------------------------------------------------
// buildDampedFilter
// ---------------------------------------------------------------------------

test('buildDampedFilter: konstant vor dem ersten Stützpunkt, nähert sich danach asymptotisch dem letzten Wert an', () => {
    let pts = [{ t: 0, v: 1 }, { t: 5, v: 10 }];
    let at = buildDampedFilter(pts, 1);
    assert.equal(at(-10), 1);
    assert.equal(at(0), 1);
    // weit nach dem letzten Stützpunkt (viele Zeitkonstanten später) sehr
    // nah am Zielwert, aber (bewusst, asymptotisch) nie exakt.
    let farAfter = at(5 + 20);
    assert.ok(Math.abs(farAfter - 10) < 1e-6);
    assert.notEqual(farAfter, 10);
});

test('buildDampedFilter: C¹-stetig an jedem Stützpunkt (keine Ableitungssprünge, per finiter Differenz)', () => {
    let pts = [{ t: 0, v: 0 }, { t: 2, v: 5 }, { t: 5, v: 5 }, { t: 9, v: -3 }];
    let at = buildDampedFilter(pts, 1.5);
    const h = 1e-6;
    for (let p of pts) {
        let left = (at(p.t) - at(p.t - h)) / h;
        let right = (at(p.t + h) - at(p.t)) / h;
        assert.ok(Math.abs(left - right) < 1e-3, `Ableitungssprung bei t=${p.t}: links=${left.toFixed(6)}, rechts=${right.toFixed(6)}`);
    }
});

test('buildDampedFilter: bleibt für jedes TAU innerhalb der konvexen Hülle der Stützwerte (Sicherheits-Eigenschaft für Konvexkombinations-Beweise)', () => {
    let pts = [{ t: 0, v: 2 }, { t: 3, v: 8 }, { t: 6, v: 1 }, { t: 10, v: 5 }];
    let vMin = Math.min(...pts.map(p => p.v)), vMax = Math.max(...pts.map(p => p.v));
    for (let tau of [0.1, 1, 5, 20]) {
        let at = buildDampedFilter(pts, tau);
        for (let t = -5; t <= 30; t += 0.5) {
            let v = at(t);
            assert.ok(v >= vMin - 1e-9 && v <= vMax + 1e-9, `TAU=${tau}: Wert ${v} bei t=${t} außerhalb [${vMin},${vMax}]`);
        }
    }
});

test('buildDampedFilter: größeres TAU bedeutet trägere (langsamere) Reaktion', () => {
    let pts = [{ t: 0, v: 0 }, { t: 5, v: 10 }];
    let atFast = buildDampedFilter(pts, 0.5);
    let atSlow = buildDampedFilter(pts, 5);
    // kurz nach dem Sprung sollte der "schnelle" Filter bereits weiter beim
    // Zielwert sein als der "langsame".
    assert.ok(atFast(6) > atSlow(6), `bei TAU klein sollte der Wert schneller aufholen: fast=${atFast(6)}, slow=${atSlow(6)}`);
});

test('buildDampedFilter: reagiert auf viele dicht aufeinanderfolgende Stützpunkte spürbar träger als buildMonotoneSpline (Kern des Bank-Zoom-Fixes)', () => {
    // Simuliert das reale Muster: viele kleine, dicht getaktete Stützpunkte
    // (ein Wegpunkt pro Bank-Entnahme, oft nur 1 Zeiteinheit auseinander).
    let pts = [];
    for (let i = 0; i <= 50; i++) pts.push({ t: i, v: i * 0.1 });
    let dampedAt = buildDampedFilter(pts, 3);
    let exactAt = buildMonotoneSpline(pts);
    // Mitten in der Sequenz: der gedämpfte Filter hinkt spürbar hinter dem
    // exakten Wert her (das IST die gewünschte "trägere" Bewegung).
    let t = 25;
    let lag = exactAt(t) - dampedAt(t);
    assert.ok(lag > 0.3, `gedämpfter Filter sollte bei t=${t} spürbar hinter dem exakten Wert liegen, Differenz war nur ${lag.toFixed(3)}`);
});

test('buildDampedFilter: Sonderfälle (0/1 Stützpunkte)', () => {
    assert.equal(buildDampedFilter([], 1)(5), 0);
    let at1 = buildDampedFilter([{ t: 3, v: 42 }], 1);
    assert.equal(at1(-10), 42);
    assert.equal(at1(100), 42);
});

test('buildDampedFilterBundle: interpoliert mehrere Felder unabhängig, alle mit derselben Zeitkonstante', () => {
    let points = [
        { t: 0, z: 1, offsetX: 0 },
        { t: 2, z: 2, offsetX: -0.5 },
        { t: 4, z: 4, offsetX: -0.5 },
    ];
    let bundle = buildDampedFilterBundle(points, ['z', 'offsetX'], 1);
    assert.equal(bundle.at(-5).z, 1);
    assert.equal(bundle.at(-5).offsetX, 0);
    let far = bundle.at(100);
    assert.ok(Math.abs(far.z - 4) < 1e-6);
    assert.ok(Math.abs(far.offsetX - (-0.5)) < 1e-6);
});
